import { NextResponse } from "next/server";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { sendCloudTemplateMessage, type CloudTemplateButton } from "@/lib/wa/cloud";
import { getCloudCreds, type ResolvedCloudCreds } from "@/lib/wa/cloud-credentials";
import { broadcastButtonPayload } from "@/lib/wa/broadcast-reply";
import { fillTemplate } from "@/lib/domain";
import type { TemplateButton } from "@/lib/types";

/**
 * Despacha las difusiones que están saliendo (el cron las golpea cada 5 minutos).
 *
 * Hermano del runner de seguimientos, con una diferencia de fondo: acá la
 * agencia ARRANCA la conversación con mucha gente a la vez, así que todo el
 * archivo está escrito alrededor de no quemar el número.
 *
 * ─────────────────────────────────────────────
 * LOS TRES FRENOS (y por qué son tres)
 *
 *   · `throttle_per_run` — lo elige la agencia por difusión. Es el ritmo.
 *   · El tope diario por agencia (`settings.broadcast_daily_cap`, 250 por
 *     defecto) — es el límite REAL de Meta: el tier arranca en 250 destinatarios
 *     únicos cada 24 hs y sube por calidad. Pasarse no manda más mensajes, manda
 *     errores y baja la calificación del número. Llegar al tope NO es un error:
 *     la difusión queda como está y sigue mañana.
 *   · El tope de mensajes por corrida — es del deploy, no del negocio. Los
 *     envíos van uno atrás del otro (mandarlos en paralelo es exactamente lo que
 *     Meta lee como spam) y el request tiene que terminar antes del timeout del
 *     hosting.
 *
 * ─────────────────────────────────────────────
 * NADIE ESPERA POR OTRO TENANT
 *
 * El lote es de toda la base y mezcla agencias. Tomar "las 3 más viejas" a secas
 * hacía que tres difusiones trabadas de una agencia (token vencido, tope diario
 * cumplido) frenaran para siempre a todas las demás: eran las más viejas, así
 * que ganaban la consulta en cada corrida y nadie más salía nunca.
 *
 * Por eso: se miran MUCHAS candidatas, se rotan por agencia (una de cada una
 * antes de repetir), lo que se saltea NO consume el cupo de difusiones
 * atendidas, y ninguna agencia puede comerse sola el presupuesto de mensajes de
 * la corrida.
 *
 * ─────────────────────────────────────────────
 * NUNCA SE MANDA DOS VECES, NUNCA SE MARCA COMO ENVIADO LO QUE NO SALIÓ
 *
 * El cron es fire-and-forget: la corrida de las 09:05 arranca aunque la de las
 * 09:00 siga mandando. Por eso el lote se RECLAMA antes de mandarlo
 * (`claimed_at`, migración 0028): el despachador se apropia de las filas con un
 * UPDATE condicionado y manda solo lo que ese UPDATE le devolvió. La segunda
 * corrida se queda sin nada que hacer con esas personas.
 *
 * `sent_at` se escribe solo con la confirmación de Meta en la mano, y el mensaje
 * queda en el hilo con el resultado real (enviado o fallido con el motivo). De eso
 * dependen el embudo de la difusión, el tope diario de mañana y el filtro de
 * fatiga: un enviado mentido los rompe a los tres.
 *
 * `omitido` y `fallido` no son lo mismo: omitido lo decidimos nosotros (se dio de
 * baja entre el armado y el envío) y no hay nada que arreglar; fallido lo rechazó
 * Meta y alguien tiene que mirarlo.
 *
 * Las credenciales se resuelven POR AGENCIA y se memoizan a mano en un Map local
 * al request. El `cache()` de React no sirve acá (memoiza dentro del render y en
 * un route handler no hay dispatcher), y una sola resolución para todo el lote
 * haría que una agencia mande con el token de otra.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Admin = ReturnType<typeof createAdminClient>;

/** Cuántas difusiones alcanzan a MANDAR por corrida. Con más, ninguna avanza rápido. */
const DIFUSIONES_POR_CORRIDA = 3;

/**
 * Cuántas se miran para encontrar esas tres. Es más alto a propósito: las que se
 * saltean (sin credenciales, sin cupo, sin pendientes) no gastan lugar, así que
 * una agencia trabada no puede tapar a las que sí pueden mandar.
 */
const CANDIDATAS_POR_CORRIDA = 30;

/** Techo de mensajes de toda la corrida: es el que cuida el timeout del request. */
const MENSAJES_POR_CORRIDA = 120;

/** Techo por agencia dentro de una misma corrida: que una no se coma el lote. */
const MENSAJES_POR_AGENCIA = 60;

/** El tier inicial de Meta: 250 destinatarios únicos cada 24 hs. */
const TOPE_DIARIO_DEFAULT = 250;

/**
 * Cada cuántos envíos se vuelve a mirar si la difusión sigue viva.
 *
 * "Frenar" no puede esperar a que termine la tanda: son hasta 120 mensajes que
 * ya no había que mandar. Una consulta cada 20 envíos es barata y acota el daño
 * a lo que de verdad estaba en el aire.
 */
const CHEQUEO_CANCELACION_CADA = 20;

/**
 * Cuánto vale un reclamo. Si un request muere a mitad de lote, esas filas
 * quedarían reclamadas para siempre y esa gente no recibiría nunca el mensaje.
 */
const CLAIM_VENCE_MS = 15 * 60_000;

const HORAS_24 = 24 * 3_600_000;

/** Lo que hace falta saber de cada destinatario para mandarle el mensaje. */
type Destinatario = {
  id: string;
  contact_id: string;
  phone: string;
  vars: unknown;
  attempts: number;
  contact: { wa_opt_out_at: string | null } | null;
};

export async function POST(request: Request) {
  const secret = process.env.WA_CRON_SECRET;
  if (!secret || request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  if (!hasAdminClient()) {
    return NextResponse.json({ ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }

  const supabase = createAdminClient();

  /* Credenciales de Meta memoizadas para este lote, UNA ENTRADA POR AGENCIA.
     `null` (no hay token) también se cachea para no reintentar el descifrado del
     Vault una vez por difusión. */
  const credsPorAgencia = new Map<string, ResolvedCloudCreds | null>();
  async function credsDe(agencyId: string): Promise<ResolvedCloudCreds | null> {
    const memo = credsPorAgencia.get(agencyId);
    if (memo !== undefined) return memo;
    const creds = await getCloudCreds(agencyId);
    credsPorAgencia.set(agencyId, creds);
    return creds;
  }

  /** Cuánto le queda a cada agencia del tope de las últimas 24 hs. */
  const cupoPorAgencia = new Map<string, number>();
  async function cupoDe(agencyId: string): Promise<number> {
    const memo = cupoPorAgencia.get(agencyId);
    if (memo !== undefined) return memo;
    const restante = await cupoDiario(supabase, agencyId);
    cupoPorAgencia.set(agencyId, restante);
    return restante;
  }

  /** Cuánto le queda a cada agencia del presupuesto de ESTA corrida. */
  const presupuestoPorAgencia = new Map<string, number>();
  function presupuestoDe(agencyId: string): number {
    return presupuestoPorAgencia.get(agencyId) ?? MENSAJES_POR_AGENCIA;
  }

  // Las programadas cuya hora ya llegó arrancan ahora.
  await arrancarProgramadas(supabase);

  const { data: candidatas, error } = await supabase
    .from("broadcasts")
    .select(
      `id, agency_id, name, branch_id, body_snapshot, buttons_snapshot,
       template_name_snapshot, language_snapshot, throttle_per_run`,
    )
    .eq("status", "enviando")
    // La que arrancó primero termina primero: una difusión a medias es peor que
    // dos esperando.
    .order("started_at", { ascending: true, nullsFirst: true })
    .limit(CANDIDATAS_POR_CORRIDA);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const difusiones = rotarPorAgencia(candidatas ?? []);

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let atendidas = 0;
  let presupuesto = MENSAJES_POR_CORRIDA;

  for (const difusion of difusiones) {
    if (presupuesto <= 0 || atendidas >= DIFUSIONES_POR_CORRIDA) break;

    /* Si esta agencia no tiene Meta conectado, la difusión espera: marcar a toda
       la lista como fallida por una credencial que el admin puede cargar en cinco
       minutos sería quemar la audiencia por nada. Saltearla NO gasta el cupo de
       difusiones de la corrida: si lo gastara, tres difusiones trabadas de una
       agencia dejarían al resto sin mandar un solo mensaje. */
    const creds = await credsDe(difusion.agency_id);
    if (!creds?.phoneNumberId) {
      console.warn(`[wa/broadcasts] "${difusion.name}": el número madre no está conectado`);
      continue;
    }
    if (!difusion.template_name_snapshot) {
      console.warn(`[wa/broadcasts] "${difusion.name}": la difusión no tiene plantilla de Meta`);
      continue;
    }

    let cupo = await cupoDe(difusion.agency_id);
    if (cupo <= 0) {
      // No es un error: es el sistema cuidando el número. Sigue mañana.
      console.info(`[wa/broadcasts] "${difusion.name}": la agencia llegó al tope diario`);
      continue;
    }

    let presupuestoAgencia = presupuestoDe(difusion.agency_id);
    if (presupuestoAgencia <= 0) continue;

    const limite = Math.min(
      difusion.throttle_per_run,
      cupo,
      presupuesto,
      presupuestoAgencia,
    );

    /* El lote se RECLAMA antes de mandarlo: solo se manda lo que este UPDATE
       devolvió. Una corrida que se solapa con esta se queda sin esas filas y no
       hay forma de que la misma persona reciba el mensaje dos veces. */
    const pendientes = await reclamarLote(supabase, difusion.id, limite);
    if (pendientes === null) continue; // el error ya quedó en el log
    if (pendientes.length === 0) {
      // Puede ser que no quede nadie (se cierra) o que otra corrida tenga el
      // lote reclamado (se espera a la próxima).
      if (await sinPendientes(supabase, difusion.id)) await cerrar(supabase, difusion.id);
      continue;
    }

    atendidas += 1;

    /* El hilo se abre en el canal que EFECTIVAMENTE manda —el dueño de estas
       credenciales— y no en `broadcasts.channel_id`. Cuando la persona conteste,
       el webhook va a buscar la conversación por ese mismo canal: si no fuera el
       mismo, la difusión y la respuesta quedarían en dos hilos distintos. */
    const canalId = creds.channelId;
    const variables = variablesDe(difusion.body_snapshot);
    const indices = quickReplyIndices(difusion.buttons_snapshot);

    let desdeElChequeo = 0;

    for (const destinatario of pendientes) {
      /* "Frenar" tiene que frenar de verdad. El estado se relee cada tantos
         envíos: la difusión pudo cancelarse hace treinta segundos y el resto de
         esta tanda ya no hay que mandarlo. */
      if (desdeElChequeo >= CHEQUEO_CANCELACION_CADA) {
        desdeElChequeo = 0;
        if (!(await sigueViva(supabase, difusion.id))) {
          console.info(`[wa/broadcasts] "${difusion.name}": la frenaron, se corta la tanda`);
          break;
        }
      }

      const attempts = destinatario.attempts + 1;
      const phone = destinatario.phone.replace(/\D/g, "");

      /* La baja pudo llegar entre el armado de la lista y el envío. Es la única
         señal que protege el número: se respeta aunque ya esté todo listo. */
      if (destinatario.contact?.wa_opt_out_at) {
        await marcar(supabase, destinatario.id, {
          status: "omitido",
          error_detail: "Se dio de baja de las difusiones.",
          attempts,
        });
        skipped += 1;
        continue;
      }
      if (phone.length < 8) {
        await marcar(supabase, destinatario.id, {
          status: "omitido",
          error_detail: "El contacto no tiene un teléfono válido.",
          attempts,
        });
        skipped += 1;
        continue;
      }

      /* Meta rechaza la plantilla entera si falta una variable, y con un error
         que no dice cuál. Se corta acá y con el nombre adentro: así el admin ve
         en la pantalla de resultados qué dato le falta a esa ficha. */
      const valores: Record<string, string> = {};
      const vars = (destinatario.vars ?? {}) as Record<string, unknown>;
      let faltante: string | null = null;
      for (const nombre of variables) {
        const valor = String(vars[nombre] ?? "").trim();
        if (!valor) {
          faltante = nombre;
          break;
        }
        valores[nombre] = valor;
      }
      if (faltante) {
        await marcar(supabase, destinatario.id, {
          status: "fallido",
          error_detail: `Falta el dato "${faltante}" para armar el mensaje.`,
          attempts,
        });
        failed += 1;
        presupuesto -= 1;
        presupuestoAgencia -= 1;
        continue;
      }

      const botones: CloudTemplateButton[] = indices.map((index) => ({
        index,
        payload: broadcastButtonPayload(destinatario.id, index),
      }));

      const resultado = await sendCloudTemplateMessage(creds, phone, {
        name: difusion.template_name_snapshot,
        language: difusion.language_snapshot,
        bodyParams: valores,
        buttons: botones,
      });
      presupuesto -= 1;
      presupuestoAgencia -= 1;
      desdeElChequeo += 1;

      /* El texto que se guarda en el hilo es el que efectivamente le llegó: la
         plantilla ya interpolada. El vendedor abre el chat y lee lo mismo que
         está leyendo el cliente. */
      const texto = fillTemplate(difusion.body_snapshot, valores);
      const conversationId = await asegurarConversacion(supabase, {
        agencyId: difusion.agency_id,
        contactId: destinatario.contact_id,
        channelId: canalId,
        branchId: difusion.branch_id,
        phone,
      });

      let messageId: string | null = null;
      if (conversationId) {
        const { data: message, error: messageError } = await supabase
          .from("messages")
          .insert({
            agency_id: difusion.agency_id,
            conversation_id: conversationId,
            direction: "out",
            kind: "plantilla",
            body: texto,
            template_name: difusion.template_name_snapshot,
            is_automated: true,
            status: resultado.ok ? "enviado" : "fallido",
            wa_message_id: resultado.ok ? resultado.waMessageId : null,
            error_detail: resultado.ok ? null : resultado.error,
            metadata: { broadcast_id: difusion.id, recipient_id: destinatario.id },
          })
          .select("id")
          .single();
        if (messageError) {
          console.warn(`[wa/broadcasts] mensaje sin registrar: ${messageError.message}`);
        }
        messageId = message?.id ?? null;
      }

      const { error: marcarError } = await supabase
        .from("broadcast_recipients")
        .update({
          status: resultado.ok ? "enviado" : "fallido",
          // Solo con la confirmación de Meta en la mano.
          sent_at: resultado.ok ? new Date().toISOString() : null,
          wa_message_id: resultado.ok ? resultado.waMessageId : null,
          message_id: messageId,
          conversation_id: conversationId,
          error_detail: resultado.ok ? null : resultado.error,
          attempts,
        })
        .eq("id", destinatario.id);
      if (marcarError) {
        console.error(`[wa/broadcasts] destinatario ${destinatario.id}: ${marcarError.message}`);
      }

      if (resultado.ok) {
        sent += 1;
        cupo -= 1;
      } else {
        failed += 1;
      }

      if (presupuesto <= 0 || presupuestoAgencia <= 0) break;
    }

    cupoPorAgencia.set(difusion.agency_id, Math.max(0, cupo));
    presupuestoPorAgencia.set(difusion.agency_id, Math.max(0, presupuestoAgencia));

    // Se cierra cuando de verdad no queda nadie: contar el lote no alcanza,
    // porque otra corrida puede tener filas reclamadas todavía sin mandar.
    if (await sinPendientes(supabase, difusion.id)) await cerrar(supabase, difusion.id);
  }

  return NextResponse.json({ ok: true, sent, failed, skipped });
}

/* ───────────────────────── piezas ───────────────────────── */

/**
 * Una difusión de cada agencia antes de repetir agencia.
 *
 * Adentro de cada agencia se respeta el orden que trajo la consulta (la que
 * arrancó primero, primero). Entre agencias, la rueda gira: la agencia B nunca
 * espera a que la agencia A termine sus tres.
 */
function rotarPorAgencia<T extends { agency_id: string }>(filas: T[]): T[] {
  const porAgencia = new Map<string, T[]>();
  for (const fila of filas) {
    const cola = porAgencia.get(fila.agency_id);
    if (cola) cola.push(fila);
    else porAgencia.set(fila.agency_id, [fila]);
  }

  const rotadas: T[] = [];
  const colas = [...porAgencia.values()];
  let quedan = true;
  for (let vuelta = 0; quedan; vuelta += 1) {
    quedan = false;
    for (const cola of colas) {
      const fila = cola[vuelta];
      if (fila) {
        rotadas.push(fila);
        quedan = true;
      }
    }
  }
  return rotadas;
}

/**
 * Se apropia de hasta `limite` pendientes y devuelve SOLO los que quedaron a su
 * nombre.
 *
 * El UPDATE repite la condición del SELECT (`pendiente` y sin reclamo vigente),
 * y ahí está toda la gracia: bajo READ COMMITTED, la corrida que llega segunda
 * espera al commit de la primera, vuelve a evaluar la condición sobre la fila ya
 * escrita y no se lleva nada. Es el lock que no tenemos, hecho con una columna.
 *
 * Devuelve `null` si la base falló: no es lo mismo que "no hay nadie".
 */
async function reclamarLote(
  supabase: Admin,
  broadcastId: string,
  limite: number,
): Promise<Destinatario[] | null> {
  if (limite <= 0) return [];
  const vencido = new Date(Date.now() - CLAIM_VENCE_MS).toISOString();
  const libre = `claimed_at.is.null,claimed_at.lt.${vencido}`;

  const { data: candidatos, error: errorLectura } = await supabase
    .from("broadcast_recipients")
    .select("id")
    .eq("broadcast_id", broadcastId)
    .eq("status", "pendiente")
    .or(libre)
    .order("created_at", { ascending: true })
    .limit(limite);
  if (errorLectura) {
    console.error(`[wa/broadcasts] ${broadcastId}: ${errorLectura.message}`);
    return null;
  }
  if (!candidatos || candidatos.length === 0) return [];

  const { data: reclamados, error: errorReclamo } = await supabase
    .from("broadcast_recipients")
    .update({ claimed_at: new Date().toISOString() })
    .in(
      "id",
      candidatos.map((c) => c.id),
    )
    .eq("status", "pendiente")
    .or(libre)
    .select("id, contact_id, phone, vars, attempts, contact:contacts(wa_opt_out_at)");
  if (errorReclamo) {
    console.error(`[wa/broadcasts] ${broadcastId} sin reclamar: ${errorReclamo.message}`);
    return null;
  }
  return (reclamados ?? []) as Destinatario[];
}

/** ¿Queda alguien sin mandar en esta difusión? */
async function sinPendientes(supabase: Admin, broadcastId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcastId)
    .eq("status", "pendiente");
  // Ante la duda no se cierra: cerrar de más deja gente sin su mensaje.
  if (error) return false;
  return (count ?? 0) === 0;
}

/** ¿La difusión sigue en marcha, o la frenaron mientras mandábamos? */
async function sigueViva(supabase: Admin, broadcastId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("broadcasts")
    .select("status")
    .eq("id", broadcastId)
    .maybeSingle();
  // Si no se pudo preguntar, se sigue: cortar una difusión sana por un error de
  // red sería peor que mandar unos mensajes de más.
  if (error) return true;
  return data?.status === "enviando";
}

/**
 * Las difusiones programadas cuya hora ya pasó entran en circulación.
 *
 * El UPDATE repite la condición de estado para no revivir una que el admin
 * canceló entre la lectura y la escritura.
 */
async function arrancarProgramadas(supabase: Admin): Promise<void> {
  const ahora = new Date().toISOString();
  const { data, error } = await supabase
    .from("broadcasts")
    .select("id, started_at")
    .eq("status", "programada")
    .or(`scheduled_at.is.null,scheduled_at.lte.${ahora}`)
    .limit(20);
  if (error) {
    console.warn(`[wa/broadcasts] no se pudieron levantar las programadas: ${error.message}`);
    return;
  }

  for (const difusion of data ?? []) {
    const { error: updateError } = await supabase
      .from("broadcasts")
      .update({ status: "enviando", started_at: difusion.started_at ?? ahora })
      .eq("id", difusion.id)
      .eq("status", "programada");
    if (updateError) {
      console.warn(`[wa/broadcasts] ${difusion.id} no arrancó: ${updateError.message}`);
    }
  }
}

/** Se terminó: sin pendientes, la difusión queda cerrada con su hora. */
async function cerrar(supabase: Admin, broadcastId: string): Promise<void> {
  const { error } = await supabase
    .from("broadcasts")
    .update({ status: "enviada", finished_at: new Date().toISOString() })
    .eq("id", broadcastId)
    .eq("status", "enviando");
  if (error) console.warn(`[wa/broadcasts] ${broadcastId} sin cerrar: ${error.message}`);
}

/**
 * Cuántos mensajes más puede mandar esta agencia hoy.
 *
 * Se cuentan los `sent_at` de las últimas 24 hs —lo que de verdad salió— y no
 * los destinatarios armados: una difusión de 800 personas programada para el
 * lunes no tiene por qué frenar la de 40 que sale hoy.
 */
async function cupoDiario(supabase: Admin, agencyId: string): Promise<number> {
  const { data: agency } = await supabase
    .from("agencies")
    .select("settings")
    .eq("id", agencyId)
    .maybeSingle();

  const settings = (agency?.settings ?? {}) as { broadcast_daily_cap?: unknown };
  const configurado = Number(settings.broadcast_daily_cap);
  const tope =
    Number.isFinite(configurado) && configurado > 0 ? Math.floor(configurado) : TOPE_DIARIO_DEFAULT;

  const desde = new Date(Date.now() - HORAS_24).toISOString();
  const { count, error } = await supabase
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("agency_id", agencyId)
    .gte("sent_at", desde);

  // Sin poder contar no se manda: pasarse del tier de Meta le baja la
  // calificación al número, y eso no se arregla esperando.
  if (error) {
    console.warn(`[wa/broadcasts] no se pudo contar el tope diario: ${error.message}`);
    return 0;
  }
  return Math.max(0, tope - (count ?? 0));
}

/**
 * El hilo del número madre con esta persona. Se crea si es la primera vez, igual
 * que hace el runner de seguimientos: la difusión tiene que quedar en el chat, o
 * cuando el cliente conteste el vendedor no va a saber a qué le está contestando.
 */
async function asegurarConversacion(
  supabase: Admin,
  input: {
    agencyId: string;
    contactId: string;
    channelId: string;
    branchId: string | null;
    phone: string;
  },
): Promise<string | null> {
  const { data: existente } = await supabase
    .from("conversations")
    .select("id")
    .eq("agency_id", input.agencyId)
    .eq("contact_id", input.contactId)
    .eq("channel", "whatsapp")
    .eq("channel_id", input.channelId)
    .maybeSingle();
  if (existente) return existente.id;

  const { data: creada, error } = await supabase
    .from("conversations")
    .insert({
      agency_id: input.agencyId,
      contact_id: input.contactId,
      channel: "whatsapp",
      channel_id: input.channelId,
      branch_id: input.branchId,
      wa_id: input.phone,
    })
    .select("id")
    .single();
  if (error) {
    console.warn(`[wa/broadcasts] conversación sin abrir: ${error.message}`);
    return null;
  }
  return creada?.id ?? null;
}

/** Deja al destinatario fuera del envío con el motivo a la vista. */
async function marcar(
  supabase: Admin,
  recipientId: string,
  patch: { status: "omitido" | "fallido"; error_detail: string; attempts: number },
): Promise<void> {
  const { error } = await supabase.from("broadcast_recipients").update(patch).eq("id", recipientId);
  if (error) console.warn(`[wa/broadcasts] destinatario ${recipientId}: ${error.message}`);
}

/** Las {{variables}} del cuerpo congelado, en orden y sin repetir. */
function variablesDe(body: string): string[] {
  const nombres: string[] = [];
  for (const match of body.matchAll(/\{\{(\w+)\}\}/g)) {
    if (!nombres.includes(match[1])) nombres.push(match[1]);
  }
  return nombres;
}

/**
 * Las posiciones de los botones de respuesta rápida en la foto de la plantilla.
 *
 * El índice es el del array completo —no el de los quick reply solos— porque es
 * el que Meta usa al enviar y el que devuelve cuando alguien toca. Los botones de
 * link no llevan payload: se van de WhatsApp y no vuelven con nada que leer.
 */
function quickReplyIndices(snapshot: unknown): number[] {
  const botones = Array.isArray(snapshot) ? (snapshot as TemplateButton[]) : [];
  const indices: number[] = [];
  botones.forEach((boton, index) => {
    if (boton?.type === "quick_reply") indices.push(index);
  });
  return indices;
}
