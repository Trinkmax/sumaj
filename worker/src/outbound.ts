import {
  generateMessageIDV2,
  type AnyMessageContent,
  type MiscMessageGenerationOptions,
  type WAMessage,
  type WASocket,
  type proto,
} from "@whiskeysockets/baileys";
import { config } from "./config.js";
import {
  BAILEYS_MAX_BYTES,
  BAILEYS_SYNC_TYPES,
  type BaileysQuoted,
  type BaileysSendContent,
  type BaileysSendErrorCode,
  type BaileysSendRequest,
  type BaileysSendResponse,
  type WorkerEvent,
} from "./contract.js";
import { baseMime, mimeAllowed, withTimeout, type OutboundMediaType } from "./media.js";
import { notifyApp } from "./notify.js";
import { getSession, toJid, type Session } from "./session.js";
import { deleteState, listState, writeState } from "./supabase.js";

/**
 * Envíos app → WhatsApp por el número de la sucursal.
 *
 * Dos velocidades, y no es capricho: un texto, una reacción, una ubicación o
 * un contacto salen en la misma request (200). Un adjunto no: Baileys lo baja
 * de nuestro Storage, lo cifra a disco, lo sube a WhatsApp y recién ahí manda
 * el mensaje — un PDF de 20 MB desde Railway puede tardar más que el timeout
 * de la app. Por eso la media se ACEPTA (202, `pending: true`) con un id de
 * mensaje pre-generado y se termina en background; el resultado real llega a
 * la app como evento `send_result`.
 *
 * Una cola por sesión: cinco vendedores mandando cinco fotos a la vez no
 * abren cinco uploads en paralelo (WhatsApp lo castiga y Railway se queda sin
 * memoria). Presupuesto total por envío: 5 minutos contados desde el 202.
 *
 * Lo aceptado con 202 NO vive solo en memoria: antes de contestar se anota en
 * wa_session_state como "pending-<messageId>", y se borra al terminar. Si el
 * worker se reinicia en el medio (un deploy, un OOM), la fila de la app
 * quedaría en "pendiente" para siempre; al arrancar, `failOrphanedSends` lee
 * lo que quedó y le avisa a la app que no salió.
 */

/**
 * El camino síncrono contesta timeout a los 15 s porque la app corta a los 20:
 * si el worker esperara más, la app abortaría primero y el vendedor vería
 * "no supimos si salió" sin que nadie haya decidido nada. Ojo: un timeout NO
 * cancela nada en Baileys (ver el contrato): sendMessage sigue, y el mensaje
 * puede llegar igual.
 */
const SYNC_TIMEOUT_MS = 15_000;
/**
 * Cuándo arrancó ESTE proceso. failOrphanedSends corre después de bootSessions,
 * y para entonces un canal ya puede haber aceptado un envío (202): esa fila
 * `pending-` es de esta corrida, no huérfana, y no hay que darla por muerta.
 */
const BOOT_AT = Date.now();
const SEND_BUDGET_MS = 5 * 60_000;
const MEDIA_UPLOAD_TIMEOUT_MS: Record<OutboundMediaType, number> = {
  image: 120_000,
  sticker: 60_000,
  audio: 120_000,
  video: 180_000,
  document: 180_000,
};
/** onWhatsApp cuesta un round-trip a WhatsApp; el resultado no cambia de un mensaje al otro. */
const EXISTS_TTL_MS = 24 * 60 * 60_000;
/** Un "no tiene WhatsApp" se recuerda menos: la persona puede instalarlo hoy. */
const NOT_EXISTS_TTL_MS = 60 * 60_000;

type SendError = { ok: false; error: string; code: BaileysSendErrorCode };

function fail(code: BaileysSendErrorCode, error: string): SendError {
  return { ok: false, error, code };
}

/* ═══════════════════════════════════════════════════════════
   Parseo del body
   ═══════════════════════════════════════════════════════════ */

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function optStr(v: unknown): string | null | undefined {
  return v == null ? (v as null | undefined) : typeof v === "string" ? v : undefined;
}
function optNum(v: unknown): number | null | undefined {
  return v == null ? (v as null | undefined) : typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function optBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/**
 * Valida el body a mano (el worker no trae zod). Acepta también el body viejo
 * `{ to, text }` como `content: { type: "text" }` hasta que la app migre.
 */
export function parseSendRequest(
  body: unknown,
): { ok: true; req: BaileysSendRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Body inválido" };
  const b = body as Record<string, unknown>;

  const rawTo = str(b.to) ?? "";
  // Una app vieja mandaba el wa_id de un hilo por LID ("lid:2462…") como si
  // fuera teléfono; con los dígitos pelados pasaría por un número válido.
  const toIsLid = /^lid:/i.test(rawTo);
  const to = toIsLid ? "" : rawTo.replace(/\D/g, "");
  const toLid = (str(b.toLid) ?? (toIsLid ? rawTo : "")).replace(/\D/g, "");
  // Con LID alcanza: es el chat que nos escribió sin compartir el número.
  if (!toLid && (to.length < 8 || to.length > 15)) {
    return { ok: false, error: "Falta `to` o no es un número válido" };
  }
  if (to && (to.length < 8 || to.length > 15)) return { ok: false, error: "`to` no es un número válido" };
  if (toLid && (toLid.length < 5 || toLid.length > 20)) return { ok: false, error: "`toLid` no es un LID válido" };

  let raw = b.content;
  if (!raw && typeof b.text === "string") raw = { type: "text", text: b.text };
  if (!raw || typeof raw !== "object") return { ok: false, error: "Falta `content`" };
  const c = raw as Record<string, unknown>;

  let quoted: BaileysQuoted | undefined;
  if (b.quoted != null) {
    const q = b.quoted as Record<string, unknown>;
    const id = str(q?.id);
    if (!id) return { ok: false, error: "`quoted.id` inválido" };
    quoted = { id, fromMe: q.fromMe === true, text: str(q.text) };
  }
  const clientRef = str(b.clientRef) ?? undefined;
  const done = (content: BaileysSendContent) => ({
    ok: true as const,
    req: {
      to,
      content,
      ...(toLid ? { toLid } : {}),
      ...(quoted ? { quoted } : {}),
      ...(clientRef ? { clientRef } : {}),
    },
  });

  const mediaBase = () => {
    const url = str(c.url);
    if (!url) return null;
    return { url, size: optNum(c.size) };
  };

  switch (c.type) {
    case "text": {
      const text = str(c.text);
      if (!text) return { ok: false, error: "Falta `content.text`" };
      return done({ type: "text", text });
    }
    case "image": {
      const m = mediaBase();
      const mime = str(c.mime);
      if (!m || !mime) return { ok: false, error: "Faltan `content.url` o `content.mime`" };
      return done({ type: "image", ...m, mime, caption: optStr(c.caption) });
    }
    case "video": {
      const m = mediaBase();
      const mime = str(c.mime);
      if (!m || !mime) return { ok: false, error: "Faltan `content.url` o `content.mime`" };
      return done({ type: "video", ...m, mime, caption: optStr(c.caption), gif: optBool(c.gif) });
    }
    case "audio": {
      const m = mediaBase();
      const mime = str(c.mime);
      if (!m || !mime) return { ok: false, error: "Faltan `content.url` o `content.mime`" };
      return done({ type: "audio", ...m, mime, voice: c.voice === true, seconds: optNum(c.seconds) });
    }
    case "document": {
      const m = mediaBase();
      const mime = str(c.mime);
      const fileName = str(c.fileName);
      if (!m || !mime || !fileName) return { ok: false, error: "Faltan `content.url`, `content.mime` o `content.fileName`" };
      return done({ type: "document", ...m, mime, fileName, caption: optStr(c.caption) });
    }
    case "sticker": {
      const url = str(c.url);
      if (!url) return { ok: false, error: "Falta `content.url`" };
      return done({ type: "sticker", url, animated: optBool(c.animated) });
    }
    case "location": {
      const latitude = optNum(c.latitude);
      const longitude = optNum(c.longitude);
      if (latitude == null || longitude == null) return { ok: false, error: "Faltan `latitude`/`longitude`" };
      return done({ type: "location", latitude, longitude, name: optStr(c.name), address: optStr(c.address) });
    }
    case "contact": {
      const displayName = str(c.displayName);
      const vcard = str(c.vcard);
      if (!displayName || !vcard) return { ok: false, error: "Faltan `displayName` o `vcard`" };
      return done({ type: "contact", displayName, vcard });
    }
    case "reaction": {
      const messageId = str(c.messageId);
      if (!messageId) return { ok: false, error: "Falta `messageId`" };
      return done({ type: "reaction", messageId, fromMe: c.fromMe === true, emoji: str(c.emoji) });
    }
    default:
      return { ok: false, error: `Tipo de contenido desconocido: ${String(c.type)}` };
  }
}

/* ═══════════════════════════════════════════════════════════
   Validaciones de media
   ═══════════════════════════════════════════════════════════ */

type MediaContent = Extract<BaileysSendContent, { url: string }>;

function isMedia(content: BaileysSendContent): content is MediaContent {
  return "url" in content;
}

/**
 * Solo bajamos de NUESTRO Storage. La URL viene de la app, pero el bearer del
 * worker es un secreto compartido: si se filtra, sin este chequeo el worker es
 * un proxy que baja lo que le pidan desde la red interna del hosting (SSRF).
 */
function sameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === new URL(config.supabaseUrl).origin;
  } catch {
    return false;
  }
}

/** Tamaño real cuando la app no lo mandó: un HEAD a nuestro propio Storage. */
async function probeSize(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5_000) });
    const len = Number(res.headers.get("content-length"));
    return res.ok && Number.isFinite(len) && len > 0 ? len : null;
  } catch {
    return null;
  }
}

async function validateMedia(content: MediaContent): Promise<SendError | null> {
  if (!sameOrigin(content.url)) {
    return fail("bad_request", "El archivo tiene que venir del Storage de la app.");
  }
  const type = content.type;
  const mime = content.type === "sticker" ? "image/webp" : content.mime;
  if (!mimeAllowed(type, mime)) {
    return fail("invalid_media", `WhatsApp no acepta ${baseMime(mime) || "ese formato"} como ${type}.`);
  }
  const size = "size" in content && content.size != null ? content.size : await probeSize(content.url);
  const max = BAILEYS_MAX_BYTES[type];
  if (size != null && size > max) {
    return fail("too_large", `El archivo pesa ${mb(size)} y WhatsApp acepta hasta ${mb(max)} para ${type}.`);
  }
  return null;
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

/* ═══════════════════════════════════════════════════════════
   Mapeo a AnyMessageContent (lib/Types/Message.d.ts de 6.7.23)
   ═══════════════════════════════════════════════════════════ */

function toBaileysContent(content: BaileysSendContent, jid: string): AnyMessageContent {
  switch (content.type) {
    case "text":
      return { text: content.text };
    case "image":
      return { image: { url: content.url }, mimetype: content.mime, caption: content.caption ?? undefined };
    case "video":
      return {
        video: { url: content.url },
        mimetype: "video/mp4",
        caption: content.caption ?? undefined,
        gifPlayback: content.gif === true,
      };
    case "audio":
      return content.voice
        ? {
            audio: { url: content.url },
            ptt: true,
            // WhatsApp solo dibuja la onda y el "play" de nota de voz con opus
            mimetype: "audio/ogg; codecs=opus",
            seconds: content.seconds ?? undefined,
          }
        : { audio: { url: content.url }, ptt: false, mimetype: content.mime };
    case "document":
      return {
        document: { url: content.url },
        mimetype: content.mime,
        fileName: content.fileName,
        caption: content.caption ?? undefined,
      };
    case "sticker":
      return { sticker: { url: content.url }, isAnimated: content.animated === true };
    case "location":
      return {
        location: {
          degreesLatitude: content.latitude,
          degreesLongitude: content.longitude,
          name: content.name ?? undefined,
          address: content.address ?? undefined,
        },
      };
    case "contact":
      return {
        contacts: {
          displayName: content.displayName,
          contacts: [{ displayName: content.displayName, vcard: content.vcard }],
        },
      };
    case "reaction":
      return {
        react: {
          text: content.emoji ?? "",
          key: { remoteJid: jid, fromMe: content.fromMe, id: content.messageId },
        },
      };
  }
}

/** Baileys solo lee key + un contenido del citado (lib/Utils/messages.js:486-510). */
function toQuoted(quoted: BaileysQuoted | undefined, jid: string): WAMessage | undefined {
  if (!quoted) return undefined;
  return {
    key: { remoteJid: jid, fromMe: quoted.fromMe, id: quoted.id },
    message: { conversation: quoted.text ?? "" },
  };
}

/* ═══════════════════════════════════════════════════════════
   ¿Tiene WhatsApp?
   ═══════════════════════════════════════════════════════════ */

const existsCache = new Map<string, { jid: string | null; until: number }>();

/**
 * En 6.7.23 `onWhatsApp` devuelve `[]` para un número inexistente (filtra por
 * `contact`), no `{ exists: false }`. Y devuelve `undefined` SIN tirar cuando
 * la consulta USync no trajo resultado (lib/Socket/chats.js: `if (results)`):
 * eso no es "no tiene WhatsApp", es "no se pudo saber". En los dos casos de
 * duda (undefined, timeout, sesión a medio abrir) NO se bloquea el envío: se
 * manda al jid derivado del número y no se cachea nada — un corte de 2 s no
 * puede convertirse en "no tiene WhatsApp" por una hora.
 */
async function resolveJid(
  session: Session,
  sock: WASocket,
  to: string,
  /* tope para la verificación: en el camino síncrono comparte presupuesto con
     el envío, así el total nunca pasa de SYNC_TIMEOUT_MS y la app (que aborta
     a los 20 s) siempre recibe una respuesta antes */
  timeoutMs = 15_000,
): Promise<{ jid: string } | SendError> {
  const cached = existsCache.get(to);
  if (cached && cached.until > Date.now()) {
    return cached.jid ? { jid: cached.jid } : fail("no_whatsapp", "Ese número no tiene WhatsApp.");
  }
  let result: Awaited<ReturnType<WASocket["onWhatsApp"]>>;
  try {
    result = await withTimeout(sock.onWhatsApp(toJid(to)), timeoutMs, "onWhatsApp tardó demasiado");
  } catch (error) {
    console.warn(`[send ${session.channelId}] no se pudo verificar ${to}:`, error instanceof Error ? error.message : error);
    return { jid: toJid(to) };
  }
  if (!result) {
    console.warn(`[send ${session.channelId}] onWhatsApp no contestó para ${to}: se manda igual`);
    return { jid: toJid(to) };
  }
  const first = result[0];
  if (result.length === 0 || !first?.exists) {
    existsCache.set(to, { jid: null, until: Date.now() + NOT_EXISTS_TTL_MS });
    return fail("no_whatsapp", "Ese número no tiene WhatsApp.");
  }
  const jid = typeof first.jid === "string" && first.jid ? first.jid : toJid(to);
  existsCache.set(to, { jid, until: Date.now() + EXISTS_TTL_MS });
  // onWhatsApp también devuelve el LID: es la forma más barata de poblar el mapa
  if (typeof first.lid === "string") await session.lids.remember(first.lid, to);
  return { jid };
}

/* ═══════════════════════════════════════════════════════════
   Envío
   ═══════════════════════════════════════════════════════════ */

function remember(session: Session, sent: proto.WebMessageInfo | undefined): void {
  if (sent?.key?.id && sent.message) session.sentCache.set(sent.key.id, sent.message);
}

/**
 * De la excepción de Baileys al código del contrato. `generic` es el que va
 * cuando no se reconoce nada: `send_failed` en el camino síncrono (ahí no hubo
 * ninguna subida que pudiera fallar) y `upload_failed` en la media.
 */
function classify(
  error: unknown,
  generic: Extract<BaileysSendErrorCode, "send_failed" | "upload_failed">,
): { code: BaileysSendErrorCode; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === "TimeoutError") return { code: "timeout", error: message };
  if (/rate|overlimit|429/i.test(message)) return { code: "rate_limited", error: message };
  return { code: generic, error: message };
}

/**
 * Manda un mensaje por el número de la sucursal. Devuelve la respuesta del
 * contrato; el código HTTP lo decide index.ts a partir de `code`/`pending`.
 */
export async function sendContent(channelId: string, req: BaileysSendRequest): Promise<BaileysSendResponse> {
  const session = getSession(channelId);
  const sock = session?.sock;
  if (!session?.connected || !sock?.user) {
    return fail("not_connected", "El número de la sucursal no está conectado.");
  }

  const { content } = req;
  if (isMedia(content)) {
    const invalid = await validateMedia(content);
    if (invalid) return invalid;
  }
  /* Presupuesto del camino síncrono: verificación del número + envío tienen
     que caber juntos en SYNC_TIMEOUT_MS, porque la app aborta a los 20 s y un
     timeout que llegue después de eso es un toast rojo por un mensaje que
     salió. La media no lo necesita: se acepta con 202 y sigue en background. */
  const deadline = Date.now() + SYNC_TIMEOUT_MS;

  /* Un chat que entró por LID se contesta por el mismo LID (el contrato dice
     que `toLid` manda, con o sin `to`): Baileys 6.7.23 lo entrega a
     "<lid>@lid" (messages-send.js: isLid → jidEncode(user, 'lid')), y una
     reacción necesita el remoteJid del chat tal como llegó. onWhatsApp no
     aplica —consulta por teléfono— y no hace falta: si nos escribió, existe. */
  let jid: string;
  if (req.toLid) {
    jid = `${req.toLid}@lid`;
  } else if (req.to) {
    const target = await resolveJid(
      session,
      sock,
      req.to,
      BAILEYS_SYNC_TYPES.has(content.type) ? Math.max(3_000, Math.min(8_000, deadline - Date.now())) : 15_000,
    );
    if ("ok" in target) return target;
    jid = target.jid;
  } else {
    return fail("bad_request", "Falta el destinatario (`to` o `toLid`).");
  }

  const options: MiscMessageGenerationOptions = {};
  // Una reacción no cita nada: Baileys le pegaría un contextInfo al reactionMessage
  if (content.type !== "reaction") options.quoted = toQuoted(req.quoted, jid);

  // El id se genera acá y no adentro de Baileys para conocerlo ANTES de mandar:
  // el eco del propio envío (messages.upsert fromMe) puede llegar antes de que
  // sendMessage resuelva, y session.ts lo reconoce por este id.
  const messageId = generateMessageIDV2(sock.user.id);

  if (BAILEYS_SYNC_TYPES.has(content.type)) {
    session.inflight.add(messageId);
    try {
      // lo que ya se gastó verificando el número se descuenta del envío
      const restante = Math.max(2_000, deadline - Date.now());
      const sent = await withTimeout(
        sock.sendMessage(jid, toBaileysContent(content, jid), { ...options, messageId }),
        restante,
        `WhatsApp no confirmó el envío en ${Math.round(SYNC_TIMEOUT_MS / 1000)} s`,
      );
      remember(session, sent);
      const waMessageId = sent?.key?.id ?? messageId;
      return { ok: true, waMessageId, pending: false };
    } catch (error) {
      const { code, error: detail } = classify(error, "send_failed");
      console.error(`[send ${channelId}] ${content.type} a ${jid}:`, detail);
      return fail(code, detail);
    } finally {
      session.inflight.delete(messageId);
    }
  }

  /* media: se acepta ya y se termina en la cola de la sesión */
  const acceptedAt = Date.now();
  const mediaType = content.type as OutboundMediaType;
  const sendOptions: MiscMessageGenerationOptions = {
    ...options,
    messageId,
    mediaUploadTimeoutMs: MEDIA_UPLOAD_TIMEOUT_MS[mediaType],
  };

  // Anotado ANTES del 202: si el proceso muere entre el 202 y el send_result,
  // el próximo arranque lo encuentra y le avisa a la app. Si no se pudo anotar
  // se acepta igual —es un hipo de la base, no del envío— y se pierde solo la
  // red de seguridad, que es lo que había antes.
  const pending: PendingRow = { channelId, acceptedAt, ...(req.clientRef ? { clientRef: req.clientRef } : {}) };
  const noted = await writeState(channelId, `${PENDING_PREFIX}${messageId}`, pending);
  if (!noted) console.warn(`[send ${channelId}] no se pudo anotar el envío pendiente ${messageId}`);

  session.inflight.add(messageId);
  session.sendChain = session.sendChain
    .then(() => runMediaSend(session, jid, content, sendOptions, messageId, pending))
    .catch(() => {})
    .finally(() => session.inflight.delete(messageId));

  return { ok: true, waMessageId: messageId, pending: true };
}

/* ═══════════════════════════════════════════════════════════
   Envíos pendientes que sobreviven a un reinicio
   ═══════════════════════════════════════════════════════════ */

const PENDING_PREFIX = "pending-";

type PendingResult = { ok: true } | { ok: false; code: BaileysSendErrorCode; error: string };

/**
 * Lo que se sabe de un envío aceptado con 202. `result` se escribe apenas
 * termina y ANTES de avisar: si el proceso muere entre el aviso y el borrado
 * de la fila, el arranque siguiente avisa lo que pasó de verdad, y no inventa
 * un "falló" sobre una foto que sí salió (la app lo tomaría en serio y el
 * vendedor la mandaría de nuevo).
 */
type PendingRow = {
  channelId: string;
  acceptedAt: number;
  clientRef?: string;
  result?: PendingResult;
};

function sendResultEvent(channelId: string, waMessageId: string, result: PendingResult): WorkerEvent {
  return {
    type: "send_result",
    channelId,
    waMessageId,
    ok: result.ok,
    error: result.ok ? null : result.error,
    code: result.ok ? null : result.code,
    timestamp: Date.now(),
  };
}

/**
 * Al arrancar: cada "pending-<id>" que quedó es un envío que el proceso
 * anterior aceptó y no llegó a cerrar. Si alcanzó a anotar el resultado se
 * avisa ese; si no, la verdad es que no sabemos, y a la app se le dice que
 * falló por timeout con un motivo honesto. Corre después de bootSessions:
 * no necesita el socket, pero sí que notify tenga primeQueue hecho por canal.
 */
export async function failOrphanedSends(): Promise<void> {
  const rows = await listState(PENDING_PREFIX, undefined, { orderBy: "value->>acceptedAt" });
  if (rows.length === 0) return;
  console.warn(`[send] ${rows.length} envío(s) quedaron a medias en el reinicio anterior: se avisa a la app`);
  for (const row of rows) {
    const value = row.value as Partial<PendingRow> | null;
    // aceptado por ESTE proceso mientras arrancaba: sigue en curso, no es huérfano
    if (typeof value?.acceptedAt === "number" && value.acceptedAt >= BOOT_AT) continue;
    const waMessageId = row.key.slice(PENDING_PREFIX.length);
    const result: PendingResult = value?.result ?? {
      ok: false,
      code: "timeout",
      error: "El worker se reinició antes de terminar el envío.",
    };
    await notifyApp(sendResultEvent(row.channel_id, waMessageId, result));
    await deleteState(row.channel_id, row.key);
  }
}

async function runMediaSend(
  session: Session,
  jid: string,
  content: BaileysSendContent,
  options: MiscMessageGenerationOptions,
  messageId: string,
  pending: PendingRow,
): Promise<void> {
  const { channelId } = session;
  const { acceptedAt, clientRef } = pending;
  const label = `[send ${channelId}] ${content.type} ${messageId}${clientRef ? ` (${clientRef})` : ""}`;
  const pendingKey = `${PENDING_PREFIX}${messageId}`;
  // resultado a la base → aviso a la app → recién ahí se borra la fila
  const done = async (result: PendingResult) => {
    await writeState(channelId, pendingKey, { ...pending, result } satisfies PendingRow);
    await notifyApp(sendResultEvent(channelId, messageId, result));
    await deleteState(channelId, pendingKey);
  };

  // El presupuesto corre desde el 202, cola incluida: si esperó 5 min detrás
  // de otros uploads, la app ya lo dio por perdido y hay que decírselo.
  const remaining = acceptedAt + SEND_BUDGET_MS - Date.now();
  if (remaining <= 0) {
    console.error(`${label}: venció el presupuesto en la cola`);
    await done({ ok: false, code: "timeout", error: "El envío esperó demasiado en la cola." });
    return;
  }

  const sock = session.sock;
  if (!session.connected || !sock?.user) {
    await done({ ok: false, code: "not_connected", error: "El número de la sucursal se desconectó antes de enviar." });
    return;
  }

  try {
    const sent = await withTimeout(
      sock.sendMessage(jid, toBaileysContent(content, jid), options),
      remaining,
      "El envío superó los 5 minutos.",
    );
    remember(session, sent);
    console.log(`${label}: enviado en ${Math.round((Date.now() - acceptedAt) / 1000)} s`);
    await done({ ok: true });
  } catch (error) {
    const { code, error: detail } = classify(error, "upload_failed");
    console.error(`${label}: ${detail}`);
    await done({ ok: false, code, error: detail });
  }
}
