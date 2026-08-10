/**
 * Lo que pasa cuando Meta nos golpea la puerta. Lo comparten las DOS rutas del
 * webhook de la Cloud API (la vieja sin slug y la nueva por agencia).
 *
 * ─────────────────────────────────────────────────────────────
 * POR QUÉ HAY DOS RUTAS
 *
 * El GET de verificación de Meta manda tres cosas y ninguna dice de quién es:
 * hub.mode, hub.verify_token y hub.challenge. Mientras las credenciales fueron
 * una env global eso daba igual (había un solo verify token en todo el deploy);
 * con un verify token por agencia, la única forma de saber a qué tenant le está
 * hablando Meta es que la agencia venga en la URL. De ahí el slug opaco de 128
 * bits: /api/wa/cloud/webhook/{webhook_slug}.
 *
 * La ruta vieja (sin slug) queda viva porque ya está configurada en Meta en las
 * cuentas que se conectaron antes de esto. Apagarla sería dejar de recibir
 * consultas sin que nadie se entere hasta que un cliente reclame. Resuelve el
 * tenant como puede (por el phone_number_id del payload) y en el GET pregunta si
 * ALGUNA agencia tiene ese verify token.
 *
 * ─────────────────────────────────────────────────────────────
 * LA INVERSIÓN DEL ORDEN DE VALIDACIÓN (leer antes de tocar el POST)
 *
 * Antes la firma se validaba primero y recién después se miraba el payload: el
 * App Secret era una env, así que se sabía sin consultar nada. Ahora el App
 * Secret es de la agencia, y para saber CUÁL usar hay que saber de quién es el
 * mensaje — que solo lo dice el propio mensaje. El orden se invierte por
 * necesidad, y sigue siendo seguro porque lo único que se hace antes de validar
 * es LEER:
 *
 *   1. Se lee el body crudo con request.text(). Nunca request.json(): el HMAC es
 *      sobre los bytes exactos que mandó Meta y cualquier re-serialización
 *      (espacios, orden de claves, unicode) lo rompe para siempre. Ese mismo
 *      string es el que se firma y el que después se parsea.
 *   2. Con slug no se toca el payload: el tenant sale de la URL, que es secreta.
 *      Sin slug se parsea y se leen los metadata.phone_number_id para buscar los
 *      canales. Esa es la única consulta permitida antes de la firma: SELECTs
 *      parametrizados por identificadores públicos de Meta, sin efectos.
 *   3. CERO escrituras antes de que la firma valide. Nada de contactos, leads,
 *      mensajes ni respuestas automáticas (que las paga la agencia).
 *   4. La firma se valida con el App Secret del tenant, en tiempo constante, y
 *      recién ahí se recorren las entries DE ESE tenant.
 *
 * ─────────────────────────────────────────────────────────────
 * LA RUTA VIEJA RESUELVE UN TENANT POR ENTRY (y exige App Secret propio)
 *
 * Sin slug, quien manda el pedido elige a qué tenant apunta: el direccionamiento
 * sale de metadata.phone_number_id, que es un dato del payload. Eso obliga a dos
 * cosas:
 *
 *   · Un payload puede traer entries de VARIAS agencias (misma app de Meta,
 *     varios números). Se agrupan por phone_number_id y para cada número se
 *     resuelven sus credenciales, se valida la firma del body crudo contra SU
 *     App Secret y recién si valida se procesan SUS entries. Así no se descarta
 *     en silencio lo que viene después de la primera entry, y ninguna entry se
 *     escribe con credenciales ajenas.
 *   · El App Secret tiene que ser PROPIO de la agencia (salido del Vault, no del
 *     fallback a WA_CLOUD_APP_SECRET). Si el secreto fuera el global del deploy,
 *     cualquiera que lo tenga podría firmar un payload apuntando al
 *     phone_number_id de OTRA agencia y escribirle contactos, leads y mensajes:
 *     la firma probaría que el remitente conoce el secreto compartido, no que el
 *     mensaje es de ese tenant. Con un App Secret por agencia, la firma sí
 *     prueba de quién es el lote, y ahí el peor caso de un pedido inventado es
 *     hacernos hacer un SELECT y comerse un 401 sin escribir nada.
 *
 * En la ruta CON slug nada de esto hace falta: el tenant sale de la URL secreta
 * y no del payload, así que el App Secret del fallback sigue sirviendo y las
 * entries de otro número simplemente se saltean.
 *
 * ─────────────────────────────────────────────────────────────
 * QUÉ SE CONTESTA (importa: un 200 es irreversible)
 *
 * Con un 200 Meta da el lote por entregado y NO lo reintenta nunca más. Un 200
 * mal puesto es una consulta de un cliente perdida para siempre.
 *
 *   200 → lo que había para procesar quedó guardado, o directamente no había
 *         nada que procesar (evento que no es de mensajería, número que no es de
 *         ninguna agencia). No hay nada escrito ni pendiente.
 *   400 → el body no es JSON.
 *   401 → seco e indistinguible: hay tenant resuelto y la firma no valida, falta
 *         el header, o el slug no existe. No se explica cuál de las tres.
 *   500 → al menos un mensaje entrante falló. Se pide el reintento a propósito:
 *         handleInboundMessage deduplica por wa_message_id, así que reprocesar
 *         el lote no duplica nada ni vuelve a contestar el automático.
 *   503 → falta SUPABASE_SERVICE_ROLE_KEY. Mismo motivo que el 500: que Meta
 *         vuelva cuando el deploy esté sano.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import {
  getCloudCredsByPhoneNumberId,
  getCloudCredsBySlug,
  verifyTokenMatches,
  type ResolvedCloudCreds,
} from "@/lib/wa/cloud-credentials";
import {
  applyReaction,
  handleInboundMessage,
  type InboundMediaSource,
} from "@/lib/wa/inbound";
import { getCloudMedia } from "@/lib/wa/cloud";
import type { Enums, TablesUpdate } from "@/lib/types";

type Admin = ReturnType<typeof createAdminClient>;

/* ───────────────────────── payload de Meta ───────────────────────── */

/**
 * Un adjunto, como lo manda Meta. Todos comparten la misma forma: un `id` para
 * pedir la URL, el MIME, y algunos campos propios de cada tipo. Desde hace poco
 * el webhook trae además la `url` directa, lo que ahorra un viaje — pero
 * igual hay que bajarla con el token.
 */
type CloudMediaPart = {
  id?: string;
  mime_type?: string;
  url?: string;
  caption?: string;
  filename?: string;
  /** sticker: la ÚNICA forma de saber si está animado (el MIME es webp siempre) */
  animated?: boolean;
  /** audio: grabado con el micrófono de WhatsApp vs archivo adjunto */
  voice?: boolean;
};

type CloudMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: CloudMediaPart;
  video?: CloudMediaPart;
  audio?: CloudMediaPart;
  document?: CloudMediaPart;
  sticker?: CloudMediaPart;
  /**
   * Toque de un botón de PLANTILLA. `payload` es el dato que mandamos nosotros al
   * enviar (las difusiones meten ahí el destinatario), `text` es lo que leyó la
   * persona. Ojo: los botones de un mensaje libre son otra cosa
   * (`type: "interactive"`), acá no llegan.
   */
  button?: { text?: string; payload?: string };
  /** reacción a otro mensaje: sin `emoji` = la sacaron */
  reaction?: { message_id?: string; emoji?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  /** tarjetas de contacto compartidas (NO el perfil del remitente) */
  contacts?: {
    name?: { formatted_name?: string };
    phones?: { phone?: string; wa_id?: string }[];
  }[];
  referral?: { source_id?: string; headline?: string; source_type?: string };
  /**
   * `id` es el wamid del mensaje al que le está contestando. Cuando alguien toca
   * el botón de una difusión, ese wamid es el de la difusión: es la prueba dura
   * de que esta respuesta salió de ahí (la escribe Meta, no el cliente).
   */
  context?: { referred_product?: unknown; id?: string };
};

type CloudPayload = {
  entry?: {
    /** WABA ID. Solo se usa para el log cuando no se pudo resolver el tenant. */
    id?: string;
    changes?: {
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { profile?: { name?: string }; wa_id?: string }[];
        messages?: CloudMessage[];
        statuses?: { id?: string; status?: string; errors?: { title?: string }[] }[];
      };
    }[];
  }[];
};

const KIND_BY_TYPE: Record<string, Enums<"message_kind">> = {
  text: "texto",
  image: "imagen",
  video: "video",
  audio: "audio",
  document: "documento",
  sticker: "imagen",
};

/** Qué se ve en la bandeja cuando el mensaje no tiene texto propio. */
const LABEL_BY_TYPE: Record<string, string> = {
  image: "Foto",
  video: "Video",
  audio: "Mensaje de voz",
  document: "Documento",
  sticker: "Figurita",
};

/** El adjunto de un mensaje, sea del tipo que sea. */
function mediaPartOf(message: CloudMessage): CloudMediaPart | null {
  return (
    message.image ?? message.video ?? message.audio ?? message.document ?? message.sticker ?? null
  );
}

/**
 * Ubicación y contactos no tienen dónde guardarse como tales, pero tampoco
 * pueden entrar como una burbuja vacía: el vendedor tiene que ver QUÉ le
 * mandaron. Se convierten en texto legible, que además es lo que va al preview
 * de la bandeja y al aviso que le llega al operador.
 */
function describeMessage(message: CloudMessage): string {
  if (message.location) {
    const { name, address, latitude, longitude } = message.location;
    const donde = [name, address].filter(Boolean).join(" · ");
    const coords =
      latitude != null && longitude != null
        ? `https://maps.google.com/?q=${latitude},${longitude}`
        : null;
    return ["Ubicación", donde || null, coords].filter(Boolean).join("\n");
  }
  if (message.contacts?.length) {
    const tarjetas = message.contacts.map((c) => {
      const nombre = c.name?.formatted_name ?? "Contacto";
      const tel = c.phones?.[0]?.phone;
      return tel ? `${nombre} · ${tel}` : nombre;
    });
    return [`Contacto${tarjetas.length > 1 ? "s" : ""} compartido`, ...tarjetas].join("\n");
  }
  return "";
}

/* ───────────────────────── helpers ───────────────────────── */

/**
 * Comparación de secretos en tiempo constante. La diferencia de largo sí se
 * filtra (timingSafeEqual explota si los buffers no miden igual), y está bien:
 * saber cuántos caracteres tiene un token no ayuda a adivinarlo.
 */
function sameSecret(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Firma del body con el App Secret de la agencia. Sin secreto no se acepta nada:
 * /api/wa es público en el proxy y este handler escribe con service role, así que
 * confiar en el payload sin firma dejaría a cualquiera creando contactos, leads y
 * mensajes falsos (y gastando la respuesta automática paga de Meta) con solo
 * adivinar un phone_number_id.
 */
function validMetaSignature(raw: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(raw).digest("hex");
  return sameSecret(expected, header.slice("sha256=".length));
}

/** Nada que venga de afuera y sin firmar entra crudo al log. */
function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "?";
}

function parsePayload(raw: string): CloudPayload | null {
  try {
    return JSON.parse(raw) as CloudPayload;
  } catch {
    return null;
  }
}

/**
 * Lo MÍNIMO del payload para saber a quiénes les hablan: los phone_number_id
 * distintos que aparecen, en orden de aparición. Nada más se toca acá.
 */
function collectPhoneNumberIds(payload: CloudPayload): string[] {
  const seen: string[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const pnid = change.value?.metadata?.phone_number_id;
      if (pnid && !seen.includes(pnid)) seen.push(pnid);
    }
  }
  return seen;
}

/** 401 seco: no se explica si faltó el tenant, el secreto o la firma. */
function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false }, { status: 401 });
}

function forbidden(): NextResponse {
  return new NextResponse("Forbidden", { status: 403 });
}

function badRequest(): NextResponse {
  return NextResponse.json({ ok: false }, { status: 400 });
}

/**
 * La respuesta después de procesar. Con al menos un mensaje entrante fallado se
 * contesta 500 A PROPÓSITO: es la única forma de que Meta reintente y esa
 * consulta no se pierda. El reintento es seguro porque handleInboundMessage
 * deduplica por wa_message_id (los mensajes que sí entraron no se duplican ni
 * disparan de nuevo el automático).
 */
function processed(failed: number): NextResponse {
  if (failed > 0) {
    console.error(`[wa/cloud] ${failed} mensaje(s) sin guardar: se contesta 500 para que reintente`);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/* ───────────────────────── GET: handshake ───────────────────────── */

/**
 * Verificación del webhook. Meta pega un GET con hub.challenge y espera ese
 * mismo valor en texto plano.
 *
 * Con slug se compara contra el verify token de ESA agencia. Sin slug hay que
 * preguntarle a la base si el token es de alguien (verifyTokenMatches), porque
 * el GET no trae nada que identifique al tenant.
 */
export async function verifyCloudWebhook(
  request: Request,
  slug: string | null,
): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";

  if (mode !== "subscribe" || !token) return forbidden();

  const ok = slug ? await slugTokenMatches(slug, token) : await verifyTokenMatches(token);
  if (!ok) return forbidden();

  return new NextResponse(challenge, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function slugTokenMatches(slug: string, token: string): Promise<boolean> {
  const creds = await resolveBySlug(slug);
  if (!creds?.verifyToken) return false;
  return sameSecret(creds.verifyToken, token);
}

/**
 * El slug es opaco (32 hex). Filtrar la forma antes de ir a la base evita una
 * consulta por cada escaneo de bots; la RPC va parametrizada igual.
 */
function looksLikeSlug(slug: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(slug);
}

async function resolveBySlug(slug: string): Promise<ResolvedCloudCreds | null> {
  if (!looksLikeSlug(slug)) return null;
  return await getCloudCredsBySlug(slug);
}

/* ───────────────────────── POST: mensajes ───────────────────────── */

export async function handleCloudWebhook(
  request: Request,
  slug: string | null,
): Promise<Response> {
  // RAW y no request.json(): el HMAC es sobre estos bytes exactos.
  const raw = await request.text();

  if (!hasAdminClient()) {
    // 503 y no 200: con un 200 Meta da el mensaje por entregado y no reintenta,
    // así que la consulta se perdería para siempre. Acá todavía no procesamos
    // nada del payload y handleInboundMessage deduplica por wa_message_id, así
    // que el reintento no duplica ni contesta dos veces.
    console.error("[wa/cloud] falta SUPABASE_SERVICE_ROLE_KEY");
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const signature = request.headers.get("x-hub-signature-256");

  return slug
    ? await handleBySlug(raw, signature, slug)
    : await handleByPhoneNumberId(raw, signature);
}

/**
 * El camino bueno: el tenant sale de la URL y no hace falta creerle nada al
 * payload. Un slug que no existe se contesta igual que una firma que no valida
 * (401 seco), para que no se puedan descubrir agencias probando URLs.
 */
async function handleBySlug(
  raw: string,
  signature: string | null,
  slug: string,
): Promise<Response> {
  const creds = await resolveBySlug(slug);
  // Acá el App Secret del fallback (env) es aceptable: el slug es secreto y ya
  // prueba de qué agencia se trata. Lo que no se acepta es no tener ninguno.
  if (!creds?.appSecret) return unauthorized();
  if (!validMetaSignature(raw, signature, creds.appSecret)) return unauthorized();

  // Firma válida: recién ahora se puede mirar el payload entero.
  const payload = parsePayload(raw);
  if (!payload) return badRequest();

  // Las entries de otro número se saltean: la firma prueba de qué app viene el
  // lote, no autoriza a escribir en la cuenta de otra agencia. (Si el canal
  // todavía no eligió número no hay contra qué comparar, y el slug + la firma
  // alcanzan como prueba de propiedad.)
  return processed(await processPayload(payload, creds, creds.phoneNumberId));
}

/**
 * La ruta vieja: el tenant sale del payload, así que se resuelve UNO POR
 * NÚMERO y cada grupo de entries se valida contra el App Secret propio de su
 * agencia. Ver la cabecera del archivo para el porqué.
 */
async function handleByPhoneNumberId(raw: string, signature: string | null): Promise<Response> {
  const payload = parsePayload(raw);
  if (!payload) return badRequest();

  const phoneNumberIds = collectPhoneNumberIds(payload);
  if (phoneNumberIds.length === 0) {
    // Los eventos que no son de mensajería (plantilla aprobada, alertas de la
    // cuenta) no traen número: no hay tenant que resolver ni nada que guardar.
    // 200 y no 401: un 401 acá hace que Meta reintente durante días y termine
    // deshabilitando la suscripción del webhook, y como no se escribe nada
    // tampoco hay costo de seguridad en contestar bien.
    const wabaId = payload.entry?.[0]?.id;
    console.warn(
      `[wa/cloud] payload sin phone_number_id (waba ${wabaId ? safeId(wabaId) : "?"}): nada que procesar`,
    );
    return NextResponse.json({ ok: true });
  }

  let resolved = 0; // números que sí son de una agencia nuestra
  let authenticated = 0; // …y que además firmaron bien con su App Secret propio
  let failed = 0;

  for (const phoneNumberId of phoneNumberIds) {
    // ÚNICA lectura permitida antes de validar la firma.
    const creds = await getCloudCredsByPhoneNumberId(phoneNumberId);
    if (!creds) {
      console.warn(`[wa/cloud] phone_number_id sin canal: ${safeId(phoneNumberId)}`);
      continue;
    }
    resolved++;

    // Sin App Secret propio de la agencia, la firma no prueba de quién es el
    // lote y el direccionamiento por phone_number_id lo elige quien manda el
    // pedido: no alcanza para escribirle a este tenant.
    if (!creds.appSecret || !creds.appSecretIsOwn) {
      console.warn(
        `[wa/cloud] ${safeId(phoneNumberId)} sin App Secret propio: la ruta sin slug no lo procesa`,
      );
      continue;
    }
    if (!validMetaSignature(raw, signature, creds.appSecret)) {
      console.warn(`[wa/cloud] firma inválida para ${safeId(phoneNumberId)}`);
      continue;
    }

    authenticated++;
    failed += await processPayload(payload, creds, phoneNumberId);
  }

  // Ningún grupo autenticado: si el número era de alguien, esto es un problema
  // de firma → 401 seco. Si no era de nadie, no había nada que procesar y no se
  // escribió una fila → 200, así Meta no reintenta para siempre.
  if (authenticated === 0) {
    return resolved > 0 ? unauthorized() : NextResponse.json({ ok: true });
  }

  return processed(failed);
}

/**
 * Recorre el payload ya autenticado y devuelve CUÁNTOS MENSAJES ENTRANTES
 * fallaron. Ese número es lo que decide si se contesta 200 o 500: un mensaje que
 * no se pudo guardar tiene que volver, no alcanza con dejarlo en el log.
 *
 * @param onlyPhoneNumberId Si viene, solo se procesan las entries de ESE número
 *   (todo lo demás se saltea). Con slug es el número del canal resuelto; sin
 *   slug es el número del grupo que firmó, y ahí es obligatorio para que una
 *   entry no se escriba nunca con las credenciales de otra agencia.
 */
async function processPayload(
  payload: CloudPayload,
  creds: ResolvedCloudCreds,
  onlyPhoneNumberId: string | null,
): Promise<number> {
  const supabase = createAdminClient();
  let failed = 0;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      const phoneNumberId = value.metadata?.phone_number_id ?? null;
      // Cambios que no son de mensajería (plantillas aprobadas, alertas de la
      // cuenta) no traen número: no hay nada que guardar acá.
      if (!phoneNumberId) continue;

      if (onlyPhoneNumberId && phoneNumberId !== onlyPhoneNumberId) {
        console.warn(`[wa/cloud] entry de otro número: ${safeId(phoneNumberId)} (se saltea)`);
        continue;
      }

      /* estados de entrega de lo que mandamos */
      for (const status of value.statuses ?? []) {
        if (!status.id) continue;
        const mapped: Enums<"message_status"> | null =
          status.status === "sent"
            ? "enviado"
            : status.status === "delivered"
              ? "entregado"
              : status.status === "read"
                ? "leido"
                : status.status === "failed"
                  ? "fallido"
                  : null;
        if (!mapped) continue;
        const detalle = status.errors?.[0]?.title ?? null;
        const { error } = await supabase
          .from("messages")
          .update({ status: mapped, error_detail: detalle })
          .eq("wa_message_id", status.id)
          // Con service role no hay RLS que ponga el límite: el agency_id lo
          // pone acá. Un wa_message_id ajeno no puede pisar la fila de otro.
          .eq("agency_id", creds.agencyId);
        // Un estado de entrega que no se pudo escribir no justifica pedir el
        // reintento del lote (volvería a procesar mensajes por un tilde de
        // "leído"): queda en el log y sigue.
        if (error) console.warn(`[wa/cloud] estado no actualizado: ${error.message}`);

        // El mismo estado, pero del lado de la difusión: es de donde salen el
        // embudo y la tasa de apertura. Que falle no puede voltear el lote.
        await syncBroadcastRecipient(supabase, creds.agencyId, {
          waMessageId: status.id,
          status: mapped,
          detalle,
        });
      }

      /* mensajes entrantes */
      for (const message of value.messages ?? []) {
        if (!message.from) continue;
        const profileName = value.contacts?.[0]?.profile?.name ?? null;

        /* Una reacción NO es un mensaje: se pega al mensaje al que apunta. Si
           entrara como mensaje, el hilo se llenaría de burbujas con un pulgar y
           la bandeja mostraría "👍" en vez de lo último que dijo el cliente. */
        if (message.type === "reaction") {
          if (message.reaction?.message_id) {
            await applyReaction(supabase, creds.agencyId, {
              messageId: message.reaction.message_id,
              // Sin `emoji` significa que la sacaron: Meta no manda ningún flag
              // de borrado, la ausencia del campo ES la señal.
              emoji: message.reaction.emoji ?? null,
              direction: "in",
            });
          }
          continue;
        }

        const part = mediaPartOf(message);
        const text =
          message.text?.body ??
          part?.caption ??
          message.button?.text ??
          (describeMessage(message) ||
            (message.type ? (LABEL_BY_TYPE[message.type] ?? "") : ""));

        /* El archivo hay que bajarlo YA: la URL de Meta vive cinco minutos y el
           id, siete días. El webhook resuelve de dónde bajarlo y el inbound lo
           guarda, que es donde ya se sabe a qué conversación pertenece. */
        let media: InboundMediaSource | null = null;
        if (part) {
          // El webhook ya trae la URL; el GET por id queda como respaldo para
          // las cuentas donde Meta todavía no la manda.
          let url = part.url ?? null;
          let mime = part.mime_type ?? null;
          if (!url && part.id) {
            const resolved = await getCloudMedia(creds, part.id);
            if (resolved.ok) {
              url = resolved.data.url;
              mime = mime ?? resolved.data.mime;
            } else {
              console.warn(`[wa/cloud] archivo sin resolver: ${resolved.error}`);
            }
          }
          if (url) {
            media = {
              url,
              token: creds.token,
              mime,
              name: part.filename ?? null,
              extra: {
                voice: part.voice === true,
                sticker: message.type === "sticker",
                animated: part.animated === true,
              },
            };
          }
        }

        const result = await handleInboundMessage(
          {
            // El canal sale de las credenciales resueltas, no de una segunda
            // búsqueda por phone_number_id: es el mismo tenant que firmó.
            channelId: creds.channelId,
            from: message.from,
            text,
            kind: KIND_BY_TYPE[message.type ?? "text"] ?? "texto",
            waMessageId: message.id ?? null,
            pushName: profileName,
            timestamp: message.timestamp ? Number(message.timestamp) * 1000 : Date.now(),
            // anuncios click-to-WhatsApp: Meta manda el referral del aviso
            campaign: message.referral?.headline ?? message.referral?.source_id ?? null,
            media,
            /* Las dos pistas con las que se sabe si esto contesta a una
               difusión. Van crudas: quién las lee y con qué prioridad es
               decisión de `lib/wa/broadcast-reply`, no del webhook. */
            contextMessageId: message.context?.id ?? null,
            buttonPayload: message.button?.payload ?? null,
          },
          // Las credenciales ya resueltas: con estas sale la respuesta automática.
          creds,
        );
        if (!result.ok) {
          // Se cuenta y se sigue: los mensajes que vienen atrás en el lote
          // también tienen que entrar. El 500 se decide al final.
          failed++;
          console.error(
            `[wa/cloud] mensaje ${safeId(message.id ?? "?")} sin procesar: ${result.error}`,
          );
        }
      }
    }
  }

  return failed;
}

/* ───────────────────────── difusiones ───────────────────────── */

/**
 * Qué tan lejos llegó un destinatario. Sirve para no retroceder: un "entregado"
 * que llega tarde no puede borrar un "leído", y mucho menos un "respondido".
 */
const AVANCE: Record<Enums<"broadcast_recipient_status">, number> = {
  pendiente: 0,
  omitido: 0,
  fallido: 1,
  enviado: 2,
  entregado: 3,
  leido: 4,
  respondido: 5,
};

/**
 * El estado de entrega, aplicado al destinatario de la difusión.
 *
 * Es lo que hace que el embudo (enviados → entregados → leídos → respondidos)
 * diga la verdad. Se busca por `wa_message_id` + `agency_id`: el wamid es único,
 * pero con service role no hay RLS y la agencia la pone el caller.
 *
 * Nunca tira: la enorme mayoría de los wamid son de mensajes sueltos del chat y
 * no encuentran nada, y un problema acá no puede voltear un lote entero de
 * mensajes entrantes por un tilde de "leído".
 */
async function syncBroadcastRecipient(
  supabase: Admin,
  agencyId: string,
  input: {
    waMessageId: string;
    status: Enums<"message_status">;
    detalle: string | null;
  },
): Promise<void> {
  const { data: destinatario, error: readError } = await supabase
    .from("broadcast_recipients")
    .select("id, status, delivered_at, read_at, replied_at")
    .eq("wa_message_id", input.waMessageId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (readError) {
    console.warn(`[wa/cloud] destinatario de difusión no leído: ${readError.message}`);
    return;
  }
  // Lo normal: este wamid no es de ninguna difusión.
  if (!destinatario) return;

  const ahora = new Date().toISOString();
  const patch: TablesUpdate<"broadcast_recipients"> = {};

  if (input.status === "fallido") {
    patch.error_detail = input.detalle;
    /* Un fallo que llega después de que la persona contestó es un estado viejo
       de Meta: se guarda el motivo, pero la respuesta no se pisa. */
    if (!destinatario.replied_at) patch.status = "fallido";
  } else {
    // Meta a veces saltea el "delivered" y manda el "read" solo: si lo leyó,
    // le llegó.
    if (
      (input.status === "entregado" || input.status === "leido") &&
      !destinatario.delivered_at
    ) {
      patch.delivered_at = ahora;
    }
    if (input.status === "leido" && !destinatario.read_at) patch.read_at = ahora;

    const proximo: Enums<"broadcast_recipient_status"> =
      input.status === "leido" ? "leido" : input.status === "entregado" ? "entregado" : "enviado";
    if (AVANCE[proximo] > AVANCE[destinatario.status]) patch.status = proximo;
  }

  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase
    .from("broadcast_recipients")
    .update(patch)
    .eq("id", destinatario.id);
  if (error) console.warn(`[wa/cloud] destinatario de difusión sin actualizar: ${error.message}`);
}
