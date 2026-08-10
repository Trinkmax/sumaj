"use server";

/**
 * DIFUSIONES: armar, probar la audiencia y disparar.
 *
 * Es la única parte del sistema donde un click le escribe a mil personas a la
 * vez, así que el criterio acá es distinto al del resto: nada sale sin estar
 * completamente validado ANTES. Una plantilla que Meta no aprobó, un número
 * madre a medio conectar o una variable sin valor no fallan de a uno: fallan
 * los mil mensajes juntos, se pagan igual y se le baja la calidad al número.
 *
 * Reparto de responsabilidades:
 *   · quién entra en la audiencia          → `public.broadcast_audience` (SQL)
 *   · con qué texto sale                   → la foto que se congela al lanzar
 *   · cuándo y a qué ritmo sale cada tanda → el despachador (/api/wa/broadcasts/run)
 *
 * Escribir una difusión es cosa de admin (así lo dice también la RLS de la
 * migración 0027). Dar de baja a alguien NO: si un cliente le pide por chat a
 * un vendedor que no le escriban más, eso se respeta en el momento y no cuando
 * aparezca un admin.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction, succeed, fail, logActivity, type ActionResult } from "@/lib/actions/core";
import {
  buildRecipientVars,
  toAudienceRow,
  BROADCAST_VAR_KEYS,
  type AudienceRow,
  type AudienceRpcRow,
} from "@/lib/broadcasts/audience";
import { normalizePhone } from "@/lib/format";
import type { Json } from "@/lib/database.types";
import type { BroadcastAudience, TablesInsert } from "@/lib/types";

const ADMIN_ONLY = "Las difusiones las maneja un admin de la agencia.";
const SIN_MADRE =
  "Todavía no hay número madre. Crealo y conectalo en Configuración → WhatsApp: las difusiones salen solo por ahí.";
const MADRE_DESCONECTADA =
  "El número madre no está conectado. Terminá la conexión en Configuración → WhatsApp y volvé a intentar.";

/** Cuántos nombres se muestran en la vista previa de la audiencia. */
const MUESTRA = 12;
/** Los destinatarios se insertan de a lotes: 5.000 filas en un solo INSERT se cortan. */
const LOTE = 500;

const LEAD_STAGES = [
  "nuevo",
  "contactado",
  "presupuestado",
  "negociacion",
  "ganado",
  "perdido",
] as const;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Los filtros de la audiencia. Tienen que espejar exactamente las claves que
 * lee `public.broadcast_audience`: una clave de más acá arriba es un filtro que
 * la pantalla promete y la base no aplica.
 */
const audienceSchema = z.object({
  tags: z.array(z.uuid()).max(30).optional(),
  tags_mode: z.enum(["any", "all"]).optional(),
  stages: z.array(z.enum(LEAD_STAGES)).max(6).optional(),
  clients: z.enum(["todos", "clientes", "no_clientes"]).optional(),
  branch_id: z.uuid().nullable().optional(),
  assigned_to: z.uuid().nullable().optional(),
  destination: z.string().trim().max(120).nullable().optional(),
  created_from: z.string().regex(FECHA).nullable().optional(),
  created_to: z.string().regex(FECHA).nullable().optional(),
  birthday_month: z.number().int().min(1).max(12).nullable().optional(),
  quiet_days: z.number().int().min(0).max(3650).nullable().optional(),
  no_broadcast_days: z.number().int().min(0).max(365).optional(),
  skip_active: z.boolean().optional(),
});

/**
 * Los filtros como los quiere la función de base.
 *
 * Las claves vacías se van: `{"stages": null}` hace que el SQL intente sacarle
 * elementos a un escalar y la consulta explota entera. `false` y `0` se
 * conservan, que son elecciones y no ausencias.
 */
function toFilters(audience: BroadcastAudience): Json {
  const limpio: Record<string, Json> = {};
  for (const [clave, valor] of Object.entries(audience)) {
    if (valor === null || valor === undefined) continue;
    if (Array.isArray(valor) && valor.length === 0) continue;
    if (typeof valor === "string" && valor.trim() === "") continue;
    limpio[clave] = valor as Json;
  }
  return limpio;
}

/** Las {{variables}} del cuerpo, en orden y sin repetir. */
function variablesDelCuerpo(body: string): string[] {
  const encontradas: string[] = [];
  for (const m of body.matchAll(/\{\{(\w+)\}\}/g)) {
    if (!encontradas.includes(m[1])) encontradas.push(m[1]);
  }
  return encontradas;
}

/**
 * La lista de destinatarios que devuelve la RPC con estos filtros.
 *
 * Viene PAGINADA a propósito. PostgREST tiene un tope de filas por respuesta
 * (`max-rows`, 1.000 por defecto en Supabase) y sin paginar era invisible: una
 * agencia con 3.000 alcanzables veía "1.000 personas", confirmaba con ese número
 * a la vista y `launchBroadcast` materializaba exactamente mil, sin un solo
 * aviso. Un corte silencioso en la acción más cara del sistema.
 */
const PAGINA = 1_000;
/** Techo de sanidad: 50.000 destinatarios es muchísimo más que cualquier agencia. */
const MAX_AUDIENCIA = 50 * PAGINA;

async function cargarAudiencia(
  supabase: Awaited<ReturnType<typeof requireAction>>["supabase"],
  agencyId: string,
  audience: BroadcastAudience,
): Promise<{ ok: true; rows: AudienceRow[] } | { ok: false; error: string }> {
  const filtros = toFilters(audience);
  const rows: AudienceRow[] = [];

  /* Se avanza por lo que DEVOLVIÓ cada página, no por lo que se pidió: si el
     tope del servidor fuera menor que PAGINA, cortar por "vino corta" dejaría
     gente afuera en silencio, que es justo lo que se está arreglando. La vuelta
     final devuelve cero filas y termina el bucle. */
  let desde = 0;
  while (desde < MAX_AUDIENCIA) {
    const { data, error } = await supabase
      .rpc("broadcast_audience", { p_agency: agencyId, p_filters: filtros })
      .range(desde, desde + PAGINA - 1);
    if (error) return { ok: false, error: "No se pudo calcular la audiencia. Probá de nuevo." };

    const pagina = (data ?? []) as AudienceRpcRow[];
    if (pagina.length === 0) break;
    for (const row of pagina) rows.push(toAudienceRow(row));
    desde += pagina.length;
  }

  return { ok: true, rows };
}

/* ═══════════════════════════════════════════════════════════
   Vista previa: a cuántos les llega y quiénes son algunos
   ═══════════════════════════════════════════════════════════ */

/**
 * El contador que se mueve mientras el vendedor toca filtros.
 *
 * La RPC devuelve todas las filas (es una sola pasada indexada, más barata que
 * dos viajes por el count y la muestra): acá se cuenta y se corta en doce, que
 * es lo único que la pantalla llega a mostrar.
 */
export async function previewAudience(input: {
  audience: BroadcastAudience;
}): Promise<ActionResult<{ total: number; sample: AudienceRow[] }>> {
  const parsed = audienceSchema.safeParse(input?.audience ?? {});
  if (!parsed.success) return fail("Revisá los filtros: alguno quedó mal cargado.");

  const { supabase, agency } = await requireAction();

  const res = await cargarAudiencia(supabase, agency.id, parsed.data);
  if (!res.ok) return fail(res.error);

  return succeed({ total: res.rows.length, sample: res.rows.slice(0, MUESTRA) });
}

/* ═══════════════════════════════════════════════════════════
   Guardar el borrador
   ═══════════════════════════════════════════════════════════ */

const saveSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Ponele un nombre").max(80),
  templateId: z.uuid(),
  audience: audienceSchema,
  branchId: z.uuid().nullable().optional(),
  scheduledAt: z.string().nullable().optional(),
  throttlePerRun: z.number().int().min(1).max(500).optional(),
});

export async function saveBroadcast(
  input: z.infer<typeof saveSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return fail("Revisá los datos: falta el nombre o la plantilla.");
  const { supabase, agency, member, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);
  const d = parsed.data;

  if (d.scheduledAt && isNaN(new Date(d.scheduledAt).getTime())) {
    return fail("La fecha de envío no es válida.");
  }

  const { data: template } = await supabase
    .from("wa_templates")
    .select("id, body, header_text, footer_text, buttons, meta_name, language")
    .eq("id", d.templateId)
    // La RLS de wa_templates cubre `my_agency_ids()`, que es PLURAL, y la sesión
    // resuelve UNA agencia: sin este filtro alguien activo en dos podría difundir
    // la plantilla de la otra con las credenciales de esta.
    .eq("agency_id", agency.id)
    .maybeSingle();
  if (!template) return fail("No encontramos la plantilla. Elegí otra y guardá de nuevo.");

  /* El borrador ya guarda la foto del mensaje: `body_snapshot` no admite nulos
     y, si la plantilla desaparece antes de lanzar, la difusión tiene que seguir
     siendo legible. Al lanzar se vuelve a congelar con lo último de la
     plantilla, que es la versión que de verdad va a salir. */
  const campos = {
    agency_id: agency.id,
    name: d.name,
    template_id: template.id,
    body_snapshot: template.body,
    header_snapshot: template.header_text,
    footer_snapshot: template.footer_text,
    buttons_snapshot: template.buttons,
    template_name_snapshot: template.meta_name,
    language_snapshot: template.language,
    audience: toFilters(d.audience),
    branch_id: d.branchId ?? null,
    scheduled_at: d.scheduledAt ? new Date(d.scheduledAt).toISOString() : null,
    throttle_per_run: d.throttlePerRun ?? 60,
  };

  if (d.id) {
    const { data: actual } = await supabase
      .from("broadcasts")
      .select("id, status")
      .eq("id", d.id)
      .eq("agency_id", agency.id)
      .maybeSingle();
    if (!actual) return fail("No encontramos la difusión.");
    if (actual.status !== "borrador") {
      return fail("Esta difusión ya está en marcha. Cancelala si querés cambiarla.");
    }

    const { error } = await supabase.from("broadcasts").update(campos).eq("id", d.id);
    if (error) return fail("No se pudo guardar la difusión. Probá de nuevo.");

    revalidatePath("/difusiones");
    revalidatePath(`/difusiones/${d.id}`);
    return succeed({ id: d.id });
  }

  const { data: creada, error } = await supabase
    .from("broadcasts")
    .insert({ ...campos, created_by: member.id })
    .select("id")
    .single();
  if (error || !creada) return fail("No se pudo crear la difusión. Probá de nuevo.");

  revalidatePath("/difusiones");
  return succeed({ id: creada.id });
}

/* ═══════════════════════════════════════════════════════════
   Lanzar: la acción peligrosa
   ═══════════════════════════════════════════════════════════ */

const launchSchema = z.object({
  id: z.uuid(),
  scheduledAt: z.string().nullable().optional(),
});

/**
 * Materializa los destinatarios y deja la difusión lista para salir.
 *
 * Todo lo que puede fallar se chequea ANTES de escribir una sola fila: la
 * plantilla aprobada por Meta, el número madre conectado, que la audiencia no
 * esté vacía, que ninguna variable quede sin valor. Recién después se crean los
 * destinatarios (uno por persona, con su teléfono y sus variables congeladas) y
 * al final se mueve el estado. Ese orden hace que un error deje la difusión en
 * borrador y no a medio salir.
 */
export async function launchBroadcast(
  input: z.infer<typeof launchSchema>,
): Promise<ActionResult<{ total: number; scheduled: boolean }>> {
  const parsed = launchSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, agency, member, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);
  const { id } = parsed.data;

  const cuando = parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null;
  if (cuando && isNaN(cuando.getTime())) return fail("La fecha de envío no es válida.");
  // un minuto de gracia: entre que se elige la hora y se aprieta el botón pasa tiempo
  if (cuando && cuando.getTime() < Date.now() - 60_000) {
    return fail("Esa fecha ya pasó. Elegí una hora futura o mandala ahora.");
  }

  const { data: difusion } = await supabase
    .from("broadcasts")
    .select("id, name, status, template_id, audience")
    .eq("id", id)
    .eq("agency_id", agency.id)
    .maybeSingle();
  if (!difusion) return fail("No encontramos la difusión.");

  if (difusion.status === "enviando" || difusion.status === "enviada") {
    return fail("Esta difusión ya salió. Mirá los resultados o armá una nueva.");
  }
  if (difusion.status === "cancelada") {
    return fail("Esta difusión está cancelada. Armá una nueva si querés volver a mandarla.");
  }

  /* 1. la plantilla, tal como la ve Meta hoy */
  if (!difusion.template_id) {
    return fail("La difusión no tiene plantilla. Elegí una, guardá y volvé a intentar.");
  }
  const { data: template } = await supabase
    .from("wa_templates")
    .select(
      "id, name, body, header_text, footer_text, buttons, meta_name, language, meta_status, rejected_reason",
    )
    .eq("id", difusion.template_id)
    .eq("agency_id", agency.id)
    .maybeSingle();
  if (!template) return fail("La plantilla ya no existe. Elegí otra y guardá.");

  if (template.meta_status !== "APPROVED") {
    if (template.meta_status === "REJECTED") {
      return fail(
        template.rejected_reason
          ? `Meta rechazó esta plantilla: ${template.rejected_reason}. Corregila y volvé a mandarla a aprobar.`
          : "Meta rechazó esta plantilla. Corregila y volvé a mandarla a aprobar.",
      );
    }
    if (template.meta_status === "PENDING") {
      return fail("Meta todavía está revisando la plantilla. Suele tardar unos minutos.");
    }
    return fail(
      "La plantilla no está aprobada por Meta. Mandala a aprobar desde Configuración → Plantillas.",
    );
  }

  /* 2. el número madre: sin phone_number_id no hay envío posible */
  const { data: madre } = await supabase
    .from("wa_channels")
    .select("id, phone_number_id, status")
    .eq("agency_id", agency.id)
    .eq("is_mother", true)
    .maybeSingle();
  if (!madre) return fail(SIN_MADRE);
  if (!madre.phone_number_id || madre.status !== "conectado") return fail(MADRE_DESCONECTADA);

  /* 3. las variables: con una sola sin valor, Meta rechaza los mil mensajes */
  const variables = variablesDelCuerpo(template.body);
  if (/\{\{\w+\}\}/.test(template.header_text ?? "")) {
    return fail(
      "El encabezado de la plantilla usa variables y la difusión todavía no las puede completar. Dejá el encabezado con texto fijo.",
    );
  }
  const prueba = buildRecipientVars({
    variables,
    fullName: null,
    lastDestination: null,
    agencyName: agency.name,
    sellerName: member.display_name,
  });
  if (prueba.missing.length > 0) {
    const faltan = prueba.missing.map((v) => `{{${v}}}`).join(", ");
    const validas = BROADCAST_VAR_KEYS.map((v) => `{{${v}}}`).join(", ");
    return fail(
      `La plantilla usa ${faltan} y la difusión no tiene con qué completarlo. Las variables que puede llenar son ${validas}.`,
    );
  }

  /* 4. la gente */
  const audiencia = audienceSchema.safeParse(difusion.audience ?? {});
  if (!audiencia.success) {
    return fail("Los filtros de la audiencia quedaron mal guardados. Volvé a armarla.");
  }

  const res = await cargarAudiencia(supabase, agency.id, audiencia.data);
  if (!res.ok) return fail(res.error);

  const destinatarios: TablesInsert<"broadcast_recipients">[] = [];
  for (const row of res.rows) {
    const phone = normalizePhone(row.phone);
    // La RPC ya descarta a los que no tienen teléfono usable; esto atrapa el
    // caso raro del número que se rompe al normalizar.
    if (phone.replace(/\D/g, "").length < 8) continue;
    const { vars } = buildRecipientVars({
      variables,
      fullName: row.fullName,
      lastDestination: row.lastDestination,
      agencyName: agency.name,
      sellerName: member.display_name,
    });
    destinatarios.push({
      agency_id: agency.id,
      broadcast_id: id,
      contact_id: row.contactId,
      phone,
      vars: vars as Json,
    });
  }

  if (destinatarios.length === 0) {
    return fail("No hay nadie que reciba esta difusión. Aflojá los filtros y probá de nuevo.");
  }

  /* 5. materializar. El upsert ignorando duplicados hace que reintentar sea
     inofensivo: la restricción (broadcast_id, contact_id) garantiza que nadie
     reciba el mismo mensaje dos veces. */
  for (let i = 0; i < destinatarios.length; i += LOTE) {
    const { error } = await supabase
      .from("broadcast_recipients")
      .upsert(destinatarios.slice(i, i + LOTE), {
        onConflict: "broadcast_id,contact_id",
        ignoreDuplicates: true,
      });
    if (error) {
      return fail("No se pudo armar la lista de destinatarios. Probá de nuevo.");
    }
  }

  // El total es lo que quedó de verdad en la base, no lo que devolvió la RPC:
  // si esta difusión ya tenía gente cargada, el número tiene que incluirla.
  const { count } = await supabase
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", id);
  const total = count ?? destinatarios.length;

  /* 6. recién ahora se mueve el estado: de acá en adelante la maneja el despachador */
  const programada = !!cuando;
  const { error: errorEstado } = await supabase
    .from("broadcasts")
    .update({
      status: programada ? "programada" : "enviando",
      scheduled_at: cuando ? cuando.toISOString() : null,
      started_at: programada ? null : new Date().toISOString(),
      finished_at: null,
      channel_id: madre.id,
      body_snapshot: template.body,
      header_snapshot: template.header_text,
      footer_snapshot: template.footer_text,
      buttons_snapshot: template.buttons,
      template_name_snapshot: template.meta_name,
      language_snapshot: template.language,
      total_recipients: total,
    })
    .eq("id", id);
  if (errorEstado) {
    return fail("Los destinatarios quedaron cargados pero la difusión no arrancó. Probá de nuevo.");
  }

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    type: "sistema",
    body: programada
      ? `Difusión "${difusion.name}" programada para ${total} personas`
      : `Difusión "${difusion.name}" enviándose a ${total} personas`,
    metadata: { broadcast_id: id, total },
  });

  revalidatePath("/difusiones");
  revalidatePath(`/difusiones/${id}`);
  return succeed({ total, scheduled: programada });
}

/* ═══════════════════════════════════════════════════════════
   Cancelar
   ═══════════════════════════════════════════════════════════ */

export async function cancelBroadcast(input: { id: string }): Promise<ActionResult<null>> {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, agency, member, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);
  const { id } = parsed.data;

  const { data: difusion } = await supabase
    .from("broadcasts")
    .select("id, name, status")
    .eq("id", id)
    .eq("agency_id", agency.id)
    .maybeSingle();
  if (!difusion) return fail("No encontramos la difusión.");
  if (difusion.status === "cancelada") return succeed(null);
  if (difusion.status === "enviada") {
    return fail("Esta difusión ya salió entera: no hay nada que frenar.");
  }

  const { error } = await supabase
    .from("broadcasts")
    .update({ status: "cancelada", finished_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return fail("No se pudo cancelar la difusión. Probá de nuevo.");

  /* Los que todavía no salieron pasan a "omitido" y no quedan pendientes para
     siempre: omitido es "decidimos no mandarlo", que es exactamente lo que
     acaba de pasar. El despachador ya no los mira, pero los números de la
     difusión tienen que contar la verdad. */
  const { error: errorPendientes } = await supabase
    .from("broadcast_recipients")
    .update({ status: "omitido" })
    .eq("broadcast_id", id)
    .eq("status", "pendiente");
  if (errorPendientes) {
    return fail("La difusión se frenó, pero quedaron destinatarios en pendiente. Actualizá la página.");
  }

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    type: "sistema",
    body: `Difusión "${difusion.name}" cancelada`,
    metadata: { broadcast_id: id },
  });

  revalidatePath("/difusiones");
  revalidatePath(`/difusiones/${id}`);
  return succeed(null);
}

/* ═══════════════════════════════════════════════════════════
   La baja del cliente
   ═══════════════════════════════════════════════════════════ */

const optOutSchema = z.object({
  contactId: z.uuid(),
  reason: z.string().trim().max(200).optional(),
});

/**
 * "No me manden más promociones."
 *
 * Lo puede hacer CUALQUIERA del equipo, a propósito: el pedido llega por chat
 * al vendedor que atiende, y hacerlo esperar a que aparezca un admin es la
 * forma más rápida de que la persona termine bloqueando el número. Cada bloqueo
 * le baja la calidad al número madre y con eso el límite de envío diario de
 * toda la agencia.
 *
 * La baja frena las DIFUSIONES, no la conversación: al que está hablando con un
 * vendedor se le sigue contestando igual.
 */
export async function optOutContact(
  input: z.infer<typeof optOutSchema>,
): Promise<ActionResult<null>> {
  const parsed = optOutSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, agency, member } = await requireAction();
  const { contactId, reason } = parsed.data;

  const { data: contacto } = await supabase
    .from("contacts")
    .select("id, full_name, wa_opt_out_at")
    .eq("id", contactId)
    .eq("agency_id", agency.id)
    .maybeSingle();
  if (!contacto) return fail("No encontramos el contacto.");
  if (contacto.wa_opt_out_at) return succeed(null);

  const { error } = await supabase
    .from("contacts")
    .update({
      wa_opt_out_at: new Date().toISOString(),
      wa_opt_out_reason: reason || "Lo pidió por chat",
    })
    .eq("id", contactId);
  if (error) return fail("No se pudo dar de baja. Probá de nuevo.");

  /* No hace falta tocar los destinatarios ya armados: el despachador vuelve a
     mirar la baja justo antes de mandar y los deja en "omitido". Además,
     escribir en broadcast_recipients es admin-only por RLS y esta action la usa
     todo el equipo. */

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    contactId,
    type: "sistema",
    body: reason ? `Se dio de baja de las difusiones — ${reason}` : "Se dio de baja de las difusiones",
  });

  revalidatePath("/crm");
  revalidatePath(`/clientes/${contactId}`);
  revalidatePath("/difusiones");
  return succeed(null);
}

/** Deshacer la baja: se tildó por error, o la persona volvió a pedir novedades. */
export async function undoOptOut(input: { contactId: string }): Promise<ActionResult<null>> {
  const parsed = z.object({ contactId: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, agency, member } = await requireAction();
  const { contactId } = parsed.data;

  const { error } = await supabase
    .from("contacts")
    .update({ wa_opt_out_at: null, wa_opt_out_reason: null })
    .eq("id", contactId);
  if (error) return fail("No se pudo reactivar el contacto. Probá de nuevo.");

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    contactId,
    type: "sistema",
    body: "Vuelve a recibir difusiones",
  });

  revalidatePath("/crm");
  revalidatePath(`/clientes/${contactId}`);
  revalidatePath("/difusiones");
  return succeed(null);
}
