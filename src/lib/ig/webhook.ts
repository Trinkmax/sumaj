/**
 * Lo que pasa cuando Meta nos golpea la puerta con un DM de Instagram.
 * Lo comparten las dos rutas del webhook (la de la agencia y la genérica).
 *
 * ─────────────────────────────────────────────
 * UNA APP DE META POR AGENCIA. NO HAY OTRA FORMA SEGURA.
 *
 * En WhatsApp la URL del webhook se configura por cuenta desde la API
 * (`override_callback_uri`), así que el sistema puede dejar todo listo solo. En
 * Instagram ESO NO EXISTE: la documentación es explícita — "Account level
 * webhooks customization is not supported" — y la callback URL es una sola, a
 * nivel app, que se carga a mano en el panel de Meta.
 *
 * De ahí sale la única arquitectura que cierra: **cada agencia trae SU app**, y
 * pega en su propio panel la URL con SU slug. El tenant sale de la URL, que es
 * secreta, el GET de verificación se puede resolver, y el App Secret contra el
 * que se valida la firma es de esa agencia y de nadie más.
 *
 * Hubo una ruta sin slug (`/api/ig/webhook`) pensada para varias agencias sobre
 * una misma app, resolviendo el tenant por `entry[].id`. Se borró: en ese
 * escenario el App Secret ES COMPARTIDO, así que la firma deja de probar de
 * quién es el mensaje y prueba solo que quien lo mandó conoce el secreto — el
 * admin de una agencia podría inyectarle contactos, leads y mensajes a otra con
 * solo apuntar al id de su cuenta. Es exactamente el agujero que en WhatsApp
 * tapa `appSecretIsOwn`, y acá no hay forma de taparlo, porque el secreto propio
 * no existe. Además el escenario nunca funcionó del todo: con una sola callback
 * URL por app, dos agencias no pueden tener cada una la suya.
 *
 * Si alguna vez hay que soportarlo, la respuesta NO es reponer esa ruta.
 *
 * ─────────────────────────────────────────────
 * EL ORDEN DE VALIDACIÓN
 *
 *   1. Se lee el body CRUDO con request.text(). Nunca request.json(): el HMAC es
 *      sobre los bytes exactos que mandó Meta y cualquier re-serialización lo
 *      rompe. (Meta además firma sobre una versión con el unicode escapado, otra
 *      razón para no tocar nunca esos bytes.)
 *   2. Se resuelve el tenant por el slug de la URL, sin mirar el payload.
 *   3. CERO escrituras antes de que la firma valide.
 *   4. Recién con la firma OK se recorren los eventos de ESE tenant.
 *
 * ─────────────────────────────────────────────
 * LOS DOS APP SECRETS
 *
 * La firma se prueba contra los dos secretos que puede tener la app (el de Meta
 * y el de Instagram) porque la documentación no dice cuál usa en el flujo de
 * Instagram Login. El detalle está en la migración 0025; acá alcanza con saber
 * que los dos se comparan siempre, en tiempo constante, y que basta con que uno
 * dé para aceptar el lote.
 *
 * ─────────────────────────────────────────────
 * QUÉ SE CONTESTA
 *
 * Con un 200 Meta da el lote por entregado. Además, si el webhook falla una hora
 * seguida, Meta DESUSCRIBE la cuenta y hay que volver a suscribirla a mano: acá
 * un 500 mal puesto es más caro que en WhatsApp.
 *
 *   200 → se procesó, o no había nada que procesar.
 *   400 → el body no es JSON.
 *   401 → hay tenant y la firma no valida, falta el header, o el slug no existe.
 *   500 → al menos un mensaje entrante falló. Se pide el reintento a propósito:
 *         handleIgInbound deduplica por mid.
 *   503 → falta SUPABASE_SERVICE_ROLE_KEY.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { getIgCredsBySlug, type ResolvedIgCreds } from "@/lib/ig/credentials";
import { handleIgInbound, type IgInboundMessage } from "@/lib/ig/inbound";
import type { Enums } from "@/lib/types";

/* ───────────────────────── payload de Meta ───────────────────────── */

type IgAttachment = {
  type?: string;
  payload?: { url?: string; title?: string };
};

type IgMessaging = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  /** self-test de Meta: la cuenta escribiéndose a sí misma */
  is_self?: boolean;
  message?: {
    mid?: string;
    text?: string;
    attachments?: IgAttachment[];
    is_echo?: boolean;
    is_deleted?: boolean;
    is_self?: boolean;
    is_unsupported?: boolean;
    quick_reply?: { payload?: string };
    referral?: {
      ref?: string;
      ad_id?: string;
      source?: string;
      ads_context_data?: { ad_title?: string };
    };
    reply_to?: { mid?: string; story?: { id?: string; url?: string } };
  };
  postback?: { mid?: string; title?: string; payload?: string };
  /** messaging_seen: la persona leyó lo que le mandamos */
  read?: { mid?: string };
  reaction?: { mid?: string; action?: string };
};

type IgEntry = {
  /** id de la cuenta profesional que recibió el evento */
  id?: string;
  time?: number;
  messaging?: IgMessaging[];
  /** comentarios y menciones: otro formato, no se procesa acá */
  changes?: unknown[];
};

type IgPayload = { object?: string; entry?: IgEntry[] };

/**
 * Meta manda a veces el objeto suelto y a veces envuelto en un array (la propia
 * documentación muestra las dos formas sin explicar cuándo usa cada una).
 */
function normalizePayload(parsed: unknown): IgPayload | null {
  if (Array.isArray(parsed)) {
    const entries = parsed.flatMap((p) => (p as IgPayload)?.entry ?? []);
    return { object: (parsed[0] as IgPayload)?.object, entry: entries };
  }
  if (parsed && typeof parsed === "object") return parsed as IgPayload;
  return null;
}

/* ───────────────────────── adjuntos ───────────────────────── */

const KIND_BY_ATTACHMENT: Record<string, Enums<"message_kind">> = {
  image: "imagen",
  media: "imagen",
  share: "imagen",
  ig_post: "imagen",
  story: "imagen",
  ig_story: "imagen",
  story_mention: "imagen",
  video: "video",
  reel: "video",
  ig_reel: "video",
  audio: "audio",
  file: "documento",
};

/**
 * Cómo se nombra en el hilo lo que no es texto. `texto` dice "Adjunto" porque
 * ahí caen los tipos que Meta agrega y todavía no mapeamos (una ubicación, un
 * formato nuevo): "Mensaje" no le dice nada a nadie y encima se propaga al
 * `initial_message` del lead y al aviso que le llega al operador.
 */
const LABEL_BY_KIND: Record<Enums<"message_kind">, string> = {
  imagen: "Imagen",
  video: "Video",
  audio: "Audio",
  documento: "Archivo",
  texto: "Adjunto",
  plantilla: "Plantilla",
  nota_interna: "Nota",
};

/* ───────────────────────── helpers ───────────────────────── */

function sameSecret(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * ¿La firma es de alguno de los secretos de esta app?
 *
 * Se evalúan LOS DOS siempre (nada de cortar en el primero que da): la
 * comparación es en tiempo constante y así no filtra por timing cuál de los dos
 * secretos está cargado.
 */
function validIgSignature(
  raw: string,
  header: string | null,
  secrets: (string | null)[],
): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const received = header.slice("sha256=".length);
  let ok = false;
  for (const secret of secrets) {
    if (!secret) continue;
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    if (sameSecret(expected, received)) ok = true;
  }
  return ok;
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "?";
}

/**
 * Instagram manda el timestamp en MILISEGUNDOS (WhatsApp, en segundos). El
 * chequeo es una red: un valor en segundos interpretado como milisegundos deja
 * el mensaje fechado en 1970, y eso no se ve como un error — se ve como un hilo
 * desordenado que nadie entiende.
 */
function toMillis(timestamp: unknown): number {
  // `Number()` y no confiar en el tipo: el payload viene de afuera y el tipo de
  // TypeScript no valida nada en runtime. Un timestamp que llegue como string
  // haría `new Date(...)` inválido y el `.toISOString()` del insert TIRA — y una
  // excepción ahí se lleva puesto el resto del lote.
  const n = Number(timestamp);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  return n < 1e12 ? n * 1000 : n;
}

function parseRaw(raw: string): IgPayload | null {
  try {
    return normalizePayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false }, { status: 401 });
}
function forbidden(): NextResponse {
  return new NextResponse("Forbidden", { status: 403 });
}
function badRequest(): NextResponse {
  return NextResponse.json({ ok: false }, { status: 400 });
}

function processed(failed: number): NextResponse {
  if (failed > 0) {
    console.error(`[ig] ${failed} mensaje(s) sin guardar: se contesta 500 para que reintente`);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** El slug es opaco: filtrar la forma evita una consulta por cada bot que escanea. */
function looksLikeSlug(slug: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(slug);
}

async function resolveBySlug(slug: string): Promise<ResolvedIgCreds | null> {
  if (!looksLikeSlug(slug)) return null;
  return await getIgCredsBySlug(slug);
}

/* ───────────────────────── GET: handshake ───────────────────────── */

export async function verifyIgWebhook(request: Request, slug: string): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";

  if (mode !== "subscribe" || !token) return forbidden();
  if (!(await slugTokenMatches(slug, token))) return forbidden();

  // Meta espera el challenge crudo, en texto plano y sin comillas.
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

/* ───────────────────────── POST: eventos ───────────────────────── */

export async function handleIgWebhook(request: Request, slug: string): Promise<Response> {
  // RAW y no request.json(): el HMAC es sobre estos bytes exactos.
  const raw = await request.text();

  if (!hasAdminClient()) {
    console.error("[ig] falta SUPABASE_SERVICE_ROLE_KEY");
    return NextResponse.json({ ok: false }, { status: 503 });
  }

  const creds = await resolveBySlug(slug);
  // Un slug que no existe se contesta igual que una firma que no valida, para
  // que no se puedan descubrir agencias probando URLs.
  if (!creds) return unauthorized();

  const signature = request.headers.get("x-hub-signature-256");
  if (!validIgSignature(raw, signature, [creds.appSecret, creds.igAppSecret])) {
    return unauthorized();
  }

  const payload = parseRaw(raw);
  if (!payload) return badRequest();

  // Las entries de OTRA cuenta se saltean: la firma prueba de qué app viene el
  // lote, no autoriza a escribir en la cuenta de otra agencia.
  return processed(await processEntries(payload, creds, creds.igUserId));
}

/* ───────────────────────── el recorrido ───────────────────────── */

/**
 * Recorre el payload ya autenticado y devuelve CUÁNTOS MENSAJES ENTRANTES
 * fallaron: ese número es lo que decide si se contesta 200 o 500.
 *
 * @param onlyAccountId Si viene, solo se procesan las entries de ESA cuenta.
 *   Una entry SIN id también se saltea: dejarla pasar sería procesar con las
 *   credenciales de este tenant algo que no dice ser suyo.
 */
async function processEntries(
  payload: IgPayload,
  creds: ResolvedIgCreds,
  onlyAccountId: string | null,
): Promise<number> {
  let failed = 0;

  for (const entry of payload.entry ?? []) {
    if (onlyAccountId && entry.id !== onlyAccountId) {
      console.warn(`[ig] entry de otra cuenta: ${safeId(entry.id ?? "?")} (se saltea)`);
      continue;
    }

    for (const event of entry.messaging ?? []) {
      /* la persona leyó lo que le mandamos */
      if (event.read?.mid) {
        await markRead(creds.agencyId, event.read.mid);
        continue;
      }

      /* borró un mensaje ("unsend"): en Instagram desaparece de los dos lados y
         acá tiene que pasar lo mismo. No es un detalle estético — la gente borra
         justo lo que no quería mandar (un número de tarjeta, un documento). */
      if (event.message?.is_deleted && event.message.mid) {
        await markDeleted(creds.agencyId, event.message.mid);
        continue;
      }
      // Las reacciones no se guardan: no son mensajes y ensuciarían el hilo.
      if (event.reaction) continue;

      const inbound = toInbound(event, creds);
      if (!inbound) continue;

      const res = await handleIgInbound(inbound, creds);
      if (!res.ok) {
        failed++;
        console.error(
          `[ig] mensaje ${safeId(inbound.messageId ?? "?")} sin procesar: ${res.error}`,
        );
      }
    }
  }

  return failed;
}

/**
 * El aviso de leído de Instagram trae el mid del último mensaje leído. Se marca
 * ese y no todo el hilo: es lo que Meta afirma, y afirmar de más en los ticks es
 * exactamente lo que hace que el vendedor deje de creerles.
 */
async function markRead(agencyId: string, mid: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("messages")
    .update({ status: "leido" })
    .eq("wa_message_id", mid)
    // Con service role no hay RLS que ponga el límite: el agency_id lo pone acá.
    .eq("agency_id", agencyId);
  if (error) console.warn(`[ig] estado no actualizado: ${error.message}`);
}

/**
 * Un mensaje que la persona borró. Se vacía el contenido y queda la marca: el
 * hilo tiene que mostrar que ahí hubo algo, sin mostrar qué.
 */
async function markDeleted(agencyId: string, mid: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("messages")
    .update({ body: "Se eliminó este mensaje", media_url: null, kind: "texto" })
    .eq("wa_message_id", mid)
    .eq("agency_id", agencyId);
  if (error) console.warn(`[ig] mensaje borrado no actualizado: ${error.message}`);
}

/** Un evento de Meta traducido a lo que entiende `handleIgInbound`, o null. */
function toInbound(event: IgMessaging, creds: ResolvedIgCreds): IgInboundMessage | null {
  const message = event.message;
  const postback = event.postback;
  if (!message && !postback) return null;

  // Mensajes borrados y self-tests: no son una consulta de nadie.
  if (message?.is_deleted) return null;
  if (event.is_self || message?.is_self) return null;

  const isEcho = !!message?.is_echo;
  // Cuando el negocio manda, Meta invierte remitente y destinatario: la persona
  // con la que hablamos es el recipient.
  const igsid = (isEcho ? event.recipient?.id : event.sender?.id) ?? null;
  if (!igsid) return null;

  const attachment = message?.attachments?.[0];
  const kind: Enums<"message_kind"> = attachment
    ? (KIND_BY_ATTACHMENT[attachment.type ?? ""] ?? "texto")
    : "texto";

  const text =
    message?.text?.trim() ||
    postback?.title?.trim() ||
    (attachment ? LABEL_BY_KIND[kind] : "") ||
    "";

  // Botón "compartir mi teléfono": Instagram manda el número en el payload del
  // quick reply. Es consentimiento explícito de la persona, no una lectura
  // nuestra del texto.
  const quickPayload = message?.quick_reply?.payload ?? null;
  const sharedPhone = quickPayload && /^\+?\d[\d\s.\-()]{7,}$/.test(quickPayload)
    ? quickPayload
    : null;

  const referral = message?.referral;
  const campaign =
    referral?.ads_context_data?.ad_title ?? referral?.ref ?? referral?.ad_id ?? null;

  return {
    channelId: creds.channelId,
    igsid,
    direction: isEcho ? "out" : "in",
    text,
    kind,
    messageId: message?.mid ?? postback?.mid ?? null,
    mediaUrl: attachment?.payload?.url ?? null,
    timestamp: toMillis(event.timestamp),
    campaign,
    sharedPhone,
    postbackTitle: postback?.title ?? null,
    storyReply: !!message?.reply_to?.story,
  };
}
