import { randomUUID } from "node:crypto";
import { Boom } from "@hapi/boom";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidUser,
  isLidUser,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  proto,
  toNumber,
  WAMessageStubType,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { config } from "./config.js";
import { useSupabaseAuthState } from "./auth-state.js";
import { deleteState, getChannel, listState, patchChannel, patchStateValue, writeState } from "./supabase.js";
import { drainOutbox, notifyApp, primeQueue } from "./notify.js";
import { describeMessage, textOf } from "./inbound.js";
import { storeInboundMedia } from "./media.js";
import { LidBook, digitsOf } from "./lids.js";
import type { WorkerEvent } from "./contract.js";

const logger = pino({ level: config.logLevel }) as never;

/** El QR de WhatsApp vive ~60 s; damos margen para que la UI lo muestre. */
const QR_TTL_MS = 60_000;
/** Backoff de reconexión: no martillar a WhatsApp si algo está mal. */
const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;
/** Cuántos mensajes enviados se recuerdan para el retry de Baileys (getMessage). */
const SENT_CACHE_SIZE = 500;
/**
 * Al apagar, cuánto se espera a que terminen las colas (descargas de adjuntos,
 * avisos, uploads en curso). Railway da 10 s de gracia antes del SIGKILL; se
 * dejan 2 para cerrar los sockets y salir.
 */
const SHUTDOWN_GRACE_MS = 8_000;
/** Un entrante a medio procesar se repone hasta 3 veces; después se retira. */
const INBOX_MAX_REPLAYS = 3;
const INBOX_MAX_AGE_MS = 24 * 60 * 60_000;
const INBOX_PREFIX = "inbox-";

/**
 * Map con orden de inserción como LRU chico. Baileys pide por `getMessage` el
 * proto de un mensaje que mandamos cuando el celular del otro lado no pudo
 * descifrarlo y pide reenvío; sin esto el cliente ve "esperando el mensaje"
 * para siempre. 500 alcanza de sobra: el retry llega segundos después.
 */
export class SentCache {
  private readonly map = new Map<string, proto.IMessage>();
  constructor(private readonly max: number) {}
  get(id: string): proto.IMessage | undefined {
    const value = this.map.get(id);
    if (value) {
      this.map.delete(id);
      this.map.set(id, value);
    }
    return value;
  }
  has(id: string): boolean {
    return this.map.has(id);
  }
  set(id: string, value: proto.IMessage): void {
    this.map.delete(id);
    this.map.set(id, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

export type Session = {
  channelId: string;
  agencyId: string;
  sock: WASocket | null;
  starting: boolean;
  /** cerrada a propósito (logout / stop): no reconectar */
  stopped: boolean;
  attempts: number;
  timer: NodeJS.Timeout | null;
  /**
   * Token del socket vigente. Cada socket nuevo lo incrementa; los handlers
   * capturan el valor con el que nacieron y se callan si dejaron de ser el
   * socket actual. Sin esto, un socket viejo que se cierra tarde escribe
   * `status: 'error'` encima de la sesión nueva que el operador acaba de pedir.
   */
  generation: number;
  /**
   * `sock.user` NO dice si está conectado: es `creds.me`, y existe apenas se
   * cargan las credenciales, antes de que el WebSocket abra. Esto se prende en
   * connection "open" y se apaga en "close".
   */
  connected: boolean;
  /** lo que mandamos, por id, para el retry de Baileys y para reconocer el eco */
  sentCache: SentCache;
  /** ids de envíos en curso: el eco puede llegar antes de que sendMessage resuelva */
  inflight: Set<string>;
  /** LID → teléfono de los chats que llegaron sin número */
  lids: LidBook;
  /**
   * Cola de avisos a la app, en orden de llegada. Los handlers de Baileys no
   * esperan: encolan y vuelven. Si esperaran, una descarga de 30 s o la
   * escalera de reintentos de notify frenaría todo lo que viene atrás.
   */
  inboundChain: Promise<void>;
  /** Cola de envíos de media (outbound.ts): un upload por vez por sesión */
  sendChain: Promise<void>;
};

const sessions = new Map<string, Session>();

export function getSession(channelId: string): Session | undefined {
  return sessions.get(channelId);
}

export function sessionState(channelId: string) {
  const s = sessions.get(channelId);
  return {
    running: !!s && !s.stopped,
    connected: !!s?.connected && !!s.sock?.user,
    phone: s?.sock?.user?.id ? digitsOf(jidNormalizedUser(s.sock.user.id)) : null,
  };
}

/** "5493511234567" → "5493511234567@s.whatsapp.net" */
export function toJid(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

/** Un chat 1:1, con número o con LID. Lo demás (grupos, estados, canales) no es una consulta. */
function isChatJid(jid: string | null | undefined): boolean {
  return !!jid && (isJidUser(jid) === true || isLidUser(jid) === true);
}

/** Encola trabajo en la cola de entrada de la sesión; los errores no cortan la cadena. */
function enqueueInbound(session: Session, job: () => Promise<void>): void {
  session.inboundChain = session.inboundChain.then(job).catch((error) => {
    console.error(`[session ${session.channelId}] entrada:`, error instanceof Error ? error.message : error);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Levanta (o relevanta) la sesión de un canal. Idempotente: si ya está corriendo
 * no hace nada. Cada sucursal es una sesión independiente dentro del mismo proceso.
 */
export async function startSession(
  channelId: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  const existing = sessions.get(channelId);

  // Ya vinculada de verdad: no hay nada que reiniciar, ni siquiera a pedido.
  if (existing?.sock?.user) {
    existing.stopped = false;
    return;
  }

  if (existing && !opts.force && (existing.starting || existing.sock)) {
    existing.stopped = false;
    return;
  }

  /* `force` es el operador tocando "Vincular de nuevo". Sin esto la llamada era
     idempotente y no hacía NADA: si el backoff ya había abierto un socket que
     estaba esperando que alguien escanee, el click se descartaba, y si estaba
     en la ventana de espera —que desde el sexto intento es de 60 s fijos— había
     que esperar hasta un minuto para ver un QR. Desde la UI eso se ve como un
     botón que no responde. */
  if (existing && opts.force) {
    existing.generation += 1; // los handlers del socket viejo quedan mudos
    if (existing.timer) {
      clearTimeout(existing.timer);
      existing.timer = null;
    }
    existing.attempts = 0;
    const anterior = existing.sock;
    existing.sock = null;
    existing.connected = false;
    existing.starting = false;
    if (anterior) {
      try {
        anterior.end(undefined);
      } catch {
        // ya estaba cerrada
      }
    }
  }

  const channel = await getChannel(channelId);
  if (!channel) throw new Error("Canal inexistente");
  if (channel.kind !== "baileys") throw new Error("El canal no es de Baileys");

  const session: Session = existing ?? {
    channelId,
    agencyId: channel.agency_id,
    sock: null,
    starting: false,
    stopped: false,
    attempts: 0,
    timer: null,
    generation: 0,
    connected: false,
    sentCache: new SentCache(SENT_CACHE_SIZE),
    inflight: new Set(),
    lids: new LidBook(channelId),
    inboundChain: Promise.resolve(),
    sendChain: Promise.resolve(),
  };
  session.starting = true;
  session.stopped = false;
  sessions.set(channelId, session);

  try {
    const { state, saveCreds, clear } = await useSupabaseAuthState(channelId);
    const { version } = await fetchLatestBaileysVersion();
    // ANTES de abrir el socket: si quedaron avisos encolados del proceso
    // anterior, lo que WhatsApp entregue al conectar tiene que formarse atrás.
    await primeQueue(channelId);

    session.generation += 1;
    const generacion = session.generation;

    const sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: false,
      browser: Browsers.appropriate(config.deviceName),
      markOnlineOnConnect: false, // no robarle las notificaciones al celular del operador
      syncFullHistory: false,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      // Cuando el celular del cliente no pudo descifrar algo que mandamos, pide
      // el mensaje de nuevo; Baileys lo busca acá. Sin esto el retry no existe.
      getMessage: async (key) => (key.id ? session.sentCache.get(key.id) : undefined),
    });

    session.sock = sock;
    session.starting = false;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      // Socket reemplazado por un restart: lo que diga ya no es la verdad.
      if (session.generation !== generacion) return;
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 340 });
        await patchChannel(channelId, {
          status: "vinculando",
          qr: dataUrl,
          qr_expires_at: new Date(Date.now() + QR_TTL_MS).toISOString(),
          last_error: null,
        });
      }

      if (connection === "open") {
        session.attempts = 0;
        session.connected = true;
        const phone = sock.user?.id ? digitsOf(jidNormalizedUser(sock.user.id)) : null;
        await patchChannel(channelId, {
          status: "conectado",
          qr: null,
          qr_expires_at: null,
          phone,
          last_connected_at: new Date().toISOString(),
          last_error: null,
        });
        console.log(`[session ${channelId}] conectado como ${phone ?? "?"}`);
        // Lo que quedó a medio procesar en el corte anterior se repone primero
        // (entra a la cola de la sesión, y de ahí a la de avisos, en orden);
        // después sale lo que no pudo avisarse mientras la app estaba caída.
        replayInbox(session, sock).catch(() => {});
        drainOutbox(channelId).catch(() => {});
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        /* Se lee ACÁ y no al arrancar la sesión: `state.creds` es el mismo objeto
           que Baileys muta en vivo, así que ya es true apenas se escribe `me` al
           completar el pairing. Importa, porque el timer del QR no se limpia al
           parear: escanear el último código a milisegundos de que venza puede dar
           pairing y 408 seguidos, y una lectura vieja mataría una sesión que
           acababa de quedar vinculada. */
        const yaVinculado = Boolean(state.creds.me?.id);
        session.sock = null;
        session.connected = false;

        if (loggedOut) {
          // el usuario cerró la sesión desde su teléfono: las credenciales ya no sirven
          await clear();
          await patchChannel(channelId, {
            status: "desconectado",
            qr: null,
            qr_expires_at: null,
            last_error: "La sesión se cerró desde el teléfono. Volvé a vincular el número.",
          });
          session.stopped = true;
          return;
        }

        /* 408 sin credenciales = se agotaron los códigos de pairing sin que
           nadie escanee. WhatsApp manda 6 refs (el primero vive 60 s, los otros
           cinco 20 s: 2 min 40 s en total) y ahí cierra con timedOut.
           Reintentar no arregla nada —hace falta una persona con el celular— y
           deja al worker pidiendo refs nuevos cada 220 s, para siempre, desde la
           única IP de Railway. Eso es exactamente el patrón que WhatsApp
           castiga. Se corta y se espera el botón. */
        if (statusCode === DisconnectReason.timedOut && !yaVinculado) {
          session.stopped = true;
          session.generation += 1;
          if (session.timer) {
            clearTimeout(session.timer);
            session.timer = null;
          }
          sessions.delete(channelId);
          await patchChannel(channelId, {
            status: "desconectado",
            qr: null,
            qr_expires_at: null,
            last_error:
              "Nadie escaneó el código a tiempo. WhatsApp da 2 minutos y medio: abrí Dispositivos vinculados en el celular de la sucursal ANTES de tocar Vincular.",
          });
          console.warn(`[session ${channelId}] nadie escaneó el QR: queda a la espera`);
          return;
        }

        if (session.stopped) return;

        session.attempts += 1;
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** (session.attempts - 1), RECONNECT_MAX_MS);
        await patchChannel(channelId, {
          status: "error",
          last_error: `Se cortó la conexión (código ${statusCode ?? "?"}). Reintentando…`,
        });
        console.warn(`[session ${channelId}] reconecta en ${delay}ms (intento ${session.attempts})`);
        // El reintento se re-arma solo. Antes el .catch() solo logueaba: si
        // startSession fallaba (Baileys pidiendo la versión, Supabase caído),
        // no quedaba ningún timer y la sesión moría con el proceso vivo — sin
        // reconexión y sin nadie que se enterara hasta que la sucursal no
        // contestaba un mensaje.
        const reintentar = (espera: number): void => {
          session.timer = setTimeout(() => {
            startSession(channelId).catch((e) => {
              console.error(
                `[session ${channelId}] falló la reconexión:`,
                e instanceof Error ? e.message : e,
              );
              if (session.stopped) return;
              session.attempts += 1;
              reintentar(
                Math.min(RECONNECT_BASE_MS * 2 ** (session.attempts - 1), RECONNECT_MAX_MS),
              );
            });
          }, espera);
        };
        reintentar(delay);
      }
    });

    /* ── mapa LID → teléfono: todo lo que junte las dos identidades ── */

    // El cliente compartió su número en un chat que venía por LID.
    sock.ev.on("chats.phoneNumberShare", ({ lid, jid }) => {
      session.lids.remember(lid, jid).catch(() => {});
    });
    // La agenda del celular (app state) trae lid + jid del mismo contacto. Al
    // abrir la sesión llega ENTERA en un solo evento: se guarda en lote, no un
    // upsert suelto por contacto.
    sock.ev.on("contacts.upsert", (contacts) => {
      session.lids.rememberManyJids(contacts.map((c) => [c.id, c.lid, c.jid])).catch(() => {});
    });
    sock.ev.on("contacts.update", (contacts) => {
      session.lids.rememberManyJids(contacts.map((c) => [c.id, c.lid, c.jid])).catch(() => {});
    });

    /* ── mensajes: entrantes Y los que el operador escribe desde el celular ── */

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (session.generation !== generacion) return;
      /* `notify` es lo que llega en vivo; `append` es lo que WhatsApp encoló
         mientras el worker estaba caído (messages-recv.js: offline → append) y
         también el eco de lo que manda el propio worker (emitOwnEvents). Las dos
         cosas tienen que llegar al CRM. El filtro es por contenido, no por tipo. */
      if (type !== "notify" && type !== "append") return;
      for (const m of messages) {
        /* Write-ahead AL ENCOLAR, no al empezar a procesar: Baileys ya mandó el
           recibo de entrega a WhatsApp antes de emitir este evento, así que un
           mensaje que espera en la cola detrás de una descarga lenta y muere
           con el proceso no vuelve nunca. La fila se escribe sin esperar; el
           procesamiento espera a que esté (o a que falle: entonces se sigue
           sin red de seguridad, no sin mensaje). */
        const echo =
          m.key.fromMe === true &&
          !!m.key.id &&
          (session.sentCache.has(m.key.id) || session.inflight.has(m.key.id));
        const key = inboxKey(m);
        inProgress.add(key);
        const stashed = writeState(channelId, key, freezeMessage(m, type, echo)).catch(() => false);
        enqueueInbound(session, async () => {
          try {
            const ok = await stashed;
            await processInbound(session, sock, m, type, { alreadyStashed: ok ? key : undefined, echo });
          } finally {
            inProgress.delete(key);
          }
        });
      }
    });

    /* ── reacciones (lib/Utils/process-message.js: content.reactionMessage) ── */

    sock.ev.on("messages.reaction", (items) => {
      if (session.generation !== generacion) return;
      for (const { key, reaction } of items) {
        if (!isChatJid(key.remoteJid) || !key.id) continue;
        const event: WorkerEvent = {
          type: "reaction",
          channelId,
          targetMessageId: key.id,
          emoji: reaction.text || null,
          // `reaction.key` es la key del MENSAJE DE REACCIÓN (process-message.js
          // la pisa con message.key): fromMe dice si reaccionamos nosotros.
          direction: reaction.key?.fromMe ? "out" : "in",
          timestamp: toNumber(reaction.senderTimestampMs) || Date.now(),
        };
        enqueueInbound(session, async () => {
          await notifyApp(event);
        });
      }
    });

    /* ── borrados, ediciones y recibos de lo nuestro (messages.update) ── */

    sock.ev.on("messages.update", (updates) => {
      if (session.generation !== generacion) return;
      for (const { key, update } of updates) {
        if (!isChatJid(key.remoteJid) || !key.id) continue;
        const waMessageId = key.id;
        const timestamp = update.messageTimestamp ? toNumber(update.messageTimestamp) * 1000 : Date.now();
        const events: WorkerEvent[] = [];

        if (update.messageStubType === WAMessageStubType.REVOKE) {
          events.push({ type: "revoke", channelId, waMessageId, timestamp });
        } else if (update.message?.editedMessage) {
          // process-message.js envuelve el contenido nuevo en editedMessage;
          // textOf lo desenvuelve (normalizeMessageContent abre editedMessage).
          events.push({ type: "edit", channelId, waMessageId, text: textOf(update.message), timestamp });
        }

        /* Recibos de lo que MANDAMOS (proto.WebMessageInfo.Status). PENDING (1)
           no se avisa: la app ya lo puso así al guardar. message-receipt.update
           es solo de grupos, así que este es el único camino para 1:1. */
        if (typeof update.status === "number" && key.fromMe) {
          const status = STATUS_BY_CODE[update.status];
          if (status) events.push({ type: "status", channelId, waMessageId, status, timestamp });
        }

        for (const event of events) {
          enqueueInbound(session, async () => {
            await notifyApp(event);
          });
        }
      }
    });
  } catch (error) {
    session.starting = false;
    session.sock = null;
    const message = error instanceof Error ? error.message : "Error desconocido";
    await patchChannel(channelId, { status: "error", last_error: message });
    throw error;
  }
}

/** proto.WebMessageInfo.Status → message_status de la base. */
const STATUS_BY_CODE: Record<number, "enviado" | "entregado" | "leido" | "fallido" | undefined> = {
  0: "fallido", // ERROR
  2: "enviado", // SERVER_ACK
  3: "entregado", // DELIVERY_ACK
  4: "leido", // READ
  5: "leido", // PLAYED
};

/* ═══════════════════════════════════════════════════════════
   Entrantes a medio procesar (write-ahead)
   ═══════════════════════════════════════════════════════════ */

/**
 * Lo que se guarda de un WAMessage para poder reprocesarlo en otro arranque.
 * El proto se serializa con `toObject` (longs y bytes como string: JSON
 * limpio, y `fromObject` los rearma). Los campos que Baileys le pega a la key
 * POR FUERA del proto (senderPn, senderLid, isViewOnce… ver WAMessageKey en
 * lib/Types/Message.d.ts) no sobreviven a toObject y se copian aparte: sin
 * senderPn un chat por LID vuelve sin número.
 */
type InboxRow = {
  message: Record<string, unknown>;
  keyExtras: Pick<WAMessage["key"], "senderPn" | "senderLid" | "participantPn" | "participantLid" | "isViewOnce">;
  upsertType: string;
  /** era el eco de un envío nuestro: sentCache/inflight no sobreviven al reinicio, esto sí */
  echo: boolean;
  stashed_at: string;
  replays: number;
};

function freezeMessage(m: WAMessage, upsertType: string, echo: boolean): InboxRow {
  const message = proto.WebMessageInfo.toObject(proto.WebMessageInfo.fromObject(m), {
    longs: String,
    bytes: String,
  }) as Record<string, unknown>;
  const { senderPn, senderLid, participantPn, participantLid, isViewOnce } = m.key;
  return {
    message,
    keyExtras: { senderPn, senderLid, participantPn, participantLid, isViewOnce },
    upsertType,
    echo,
    stashed_at: new Date().toISOString(),
    replays: 0,
  };
}

function thawMessage(row: InboxRow): WAMessage {
  const m = proto.WebMessageInfo.fromObject(row.message) as WAMessage;
  m.key = { ...m.key, ...row.keyExtras };
  return m;
}

function inboxKey(m: WAMessage): string {
  return `${INBOX_PREFIX}${m.key.id ?? randomUUID()}`;
}

/**
 * Claves `inbox-…` que ESTA corrida está procesando o tiene encoladas. Lo
 * comparten el handler de messages.upsert y replayInbox: sin esto, una
 * reconexión en el medio de una descarga de 30 s repone el mismo mensaje y se
 * baja y sube el adjunto dos veces (archivo huérfano en el bucket, aviso doble).
 */
const inProgress = new Set<string>();

/**
 * Al conectar: lo que quedó anotado como "en proceso" y nunca se confirmó (el
 * proceso murió bajando un adjunto o en la escalera de avisos) se vuelve a
 * procesar. El socket ya está abierto, así que la descarga puede pedirle al
 * celular que resuba el archivo si WhatsApp ya lo soltó (reuploadRequest).
 *
 * Con tope: un mensaje que rompe processInbound tres veces seguidas no puede
 * quedarse repitiendo en cada reconexión; se retira a "dead-…" y se loguea.
 */
async function replayInbox(session: Session, sock: WASocket): Promise<void> {
  const { channelId } = session;
  const rows = await listState(INBOX_PREFIX, channelId, { orderBy: "value->>stashed_at" });
  if (rows.length === 0) return;
  console.warn(`[session ${channelId}] ${rows.length} entrante(s) quedaron a medio procesar: se reponen`);
  for (const row of rows) {
    if (inProgress.has(row.key)) continue;
    const value = row.value as Partial<InboxRow> | null;
    const replays = value?.replays ?? 0;
    const stashedAt = Date.parse(value?.stashed_at ?? "");
    const tooOld = Number.isFinite(stashedAt) && Date.now() - stashedAt > INBOX_MAX_AGE_MS;
    if (!value?.message || replays >= INBOX_MAX_REPLAYS || tooOld) {
      const why = !value?.message ? "fila sin mensaje" : tooOld ? "más de un día" : `${replays} reintentos`;
      console.error(`[session ${channelId}] entrante ${row.key} retirado (${why})`);
      const copied = await writeState(channelId, `dead-${randomUUID()}`, {
        ...(value ?? {}),
        original_key: row.key,
        dead_at: new Date().toISOString(),
        dead_reason: why,
      });
      if (copied) await deleteState(channelId, row.key);
      continue;
    }
    let m: WAMessage;
    try {
      m = thawMessage(value as InboxRow);
    } catch (error) {
      console.error(`[session ${channelId}] entrante ${row.key} no se pudo rearmar:`, error instanceof Error ? error.message : error);
      await deleteState(channelId, row.key);
      continue;
    }
    await patchStateValue(channelId, row.key, { ...value, replays: replays + 1 });
    inProgress.add(row.key);
    enqueueInbound(session, () =>
      processInbound(session, sock, m, value.upsertType ?? "replay", {
        alreadyStashed: row.key,
        echo: value.echo === true,
      }).finally(() => {
        inProgress.delete(row.key);
      }),
    );
  }
}

/**
 * Un mensaje de `messages.upsert`, de punta a punta: identidad (número o LID),
 * clasificación, adjunto y aviso. Corre dentro de la cola de la sesión.
 *
 * Write-ahead: antes de lo lento (bajar el adjunto, avisar con reintentos) el
 * mensaje se anota en la base, y se borra recién cuando el aviso terminó. Un
 * corte en el medio —deploy, OOM, SIGKILL— no lo pierde: replayInbox lo repone
 * al reconectar. `notifyApp` devolviendo false también es "terminado": quedó
 * en la cola de avisos (persistida) o la app lo rechazó a propósito.
 */
async function processInbound(
  session: Session,
  sock: WASocket,
  m: WAMessage,
  upsertType: string,
  opts: { alreadyStashed?: string; echo?: boolean } = {},
): Promise<void> {
  const { channelId } = session;
  const jid = m.key.remoteJid ?? "";
  const tag = `[session ${channelId}]`;
  const contentType = m.message ? Object.keys(m.message).find((k) => k !== "messageContextInfo") : undefined;
  // un descarte de algo repuesto también cierra su fila: no hay nada que reponer
  const discard = async (why: string) => {
    console.log(`${tag} descartado: ${why} (jid ${jid || "?"}, type ${upsertType}, contenido ${contentType ?? "-"})`);
    if (opts.alreadyStashed) await deleteState(channelId, opts.alreadyStashed);
  };

  // grupos, estados, canales y difusiones no son consultas de clientes
  if (!isChatJid(jid)) return discard("no es un chat 1:1");
  // "Mensajes a vos mismo" del celular de la sucursal: no es un cliente, y
  // avisarlo crearía un contacto con el propio número de la sucursal.
  const ownJids = [sock.user?.id, sock.user?.lid].map(digitsOf).filter(Boolean);
  if (ownJids.includes(digitsOf(jid))) return discard("chat con el propio número");

  const described = describeMessage(m);
  if ("skip" in described) return discard(described.skip);

  const fromMe = m.key.fromMe === true;
  /* El eco de lo que mandó el propio worker (emitOwnEvents) llega con el mismo
     id que la app ya guardó: se avisa igual —la app deduplica— pero no tiene
     sentido bajar de WhatsApp el archivo que acabamos de subir. Repuesto de
     otra corrida, la marca viene de la fila (la memoria ya no está). */
  const echo =
    opts.echo ?? (fromMe && !!m.key.id && (session.sentCache.has(m.key.id) || session.inflight.has(m.key.id)));

  /* ── anotado antes de lo lento: si el proceso muere acá, vuelve ── */
  let inboxRowKey = opts.alreadyStashed ?? null;
  if (!inboxRowKey) {
    // si no se puede anotar (hipo de la base, proto raro) se sigue igual: se
    // pierde la red de seguridad, no el mensaje
    try {
      const key = inboxKey(m);
      if (await writeState(channelId, key, freezeMessage(m, upsertType, echo))) inboxRowKey = key;
    } catch (error) {
      console.warn(`${tag} no se pudo anotar el entrante ${m.key.id ?? "?"}:`, error instanceof Error ? error.message : error);
    }
  }

  /* ── quién es: número directo, o LID resuelto por senderPn / el mapa ── */
  let from: string | null = null;
  let lid: string | null = null;
  if (isLidUser(jid)) {
    lid = digitsOf(jid);
    // En un mensaje fromMe `senderPn` es NUESTRO número (el que lo mandó), no
    // el del cliente: ahí solo sirve el mapa.
    const pn = !fromMe ? digitsOf(m.key.senderPn) : "";
    if (pn) {
      await session.lids.remember(lid, pn);
      from = pn;
    } else {
      from = await session.lids.resolve(lid);
    }
    if (!from) {
      console.warn(`${tag} chat por LID ${lid} sin número conocido: se avisa con from null`);
    }
  } else {
    from = digitsOf(jid);
    // Vino con número pero WhatsApp también dijo cuál es su LID: anotarlo para
    // el día que el mismo chat llegue por LID.
    if (!fromMe && m.key.senderLid) await session.lids.remember(m.key.senderLid, from);
  }

  /* ── el adjunto: se baja y se sube al bucket, salvo que sea nuestro eco ── */
  let media = null;
  if (described.media && described.mediaNode && !echo) {
    media = await storeInboundMedia({
      sock,
      logger,
      // downloadMediaMessage saca el tipo de la primera clave del contenido:
      // se le pasa el nodo ya desenvuelto (viewOnce, lottie, documentWithCaption…)
      message: { ...m, message: { [described.mediaNode.type]: described.mediaNode.node } } as WAMessage,
      part: described.media,
      agencyId: session.agencyId,
      channelId,
    });
  }
  // El eco de lo que mandó el propio worker va marcado: la app lo deduplica
  // por id y sabe que no tiene que tratarlo como "escrito desde el celular".
  if (echo) described.meta.echo = true;

  await notifyApp({
    type: "message",
    channelId,
    from,
    lid,
    direction: fromMe ? "out" : "in",
    waMessageId: m.key.id ?? null,
    // en un fromMe el pushName es el del operador: no es el nombre del cliente
    pushName: fromMe ? null : (m.pushName ?? null),
    text: described.text,
    kind: described.kind,
    media,
    contextMessageId: described.contextMessageId,
    metadata: described.meta,
    timestamp: toNumber(m.messageTimestamp) * 1000 || Date.now(),
  });

  // confirmado (llegó, quedó encolado o se descartó a propósito): ya no hace falta la copia
  if (inboxRowKey) await deleteState(channelId, inboxRowKey);
}

/** Cierra la sesión sin borrar credenciales (para apagar el worker o pausar). */
export async function stopSession(channelId: string): Promise<void> {
  const session = sessions.get(channelId);
  if (!session) return;
  session.stopped = true;
  session.generation += 1;
  if (session.timer) {
    clearTimeout(session.timer);
    session.timer = null;
  }
  try {
    session.sock?.end(undefined);
  } catch {
    // ya estaba cerrada
  }
  session.sock = null;
  session.connected = false;
}

/** Desvincula el número: cierra sesión en WhatsApp y borra las credenciales. */
export async function logoutSession(channelId: string): Promise<void> {
  const session = sessions.get(channelId);
  try {
    await session?.sock?.logout();
  } catch {
    // si ya no hay socket, alcanza con limpiar el estado
  }
  await stopSession(channelId);
  // clear() vacía TODA la fila del canal, cola de avisos incluida: lo que
  // todavía no salió se intenta una última vez antes.
  await drainOutbox(channelId).catch(() => {});
  const { clear } = await useSupabaseAuthState(channelId);
  await clear();
  sessions.delete(channelId);
  await patchChannel(channelId, {
    status: "desconectado",
    qr: null,
    qr_expires_at: null,
    phone: null,
    last_error: null,
  });
}

/** Al arrancar el worker: levanta todas las sesiones ya vinculadas. */
export async function bootSessions(channelIds: string[]): Promise<void> {
  for (const id of channelIds) {
    try {
      await startSession(id);
    } catch (error) {
      console.error(`[boot] canal ${id}:`, error instanceof Error ? error.message : error);
    }
  }
}

/**
 * Apagado ordenado. Primero se deja de reconectar (stopped), después se espera
 * —acotado— a que terminen las colas: una descarga a medias, un upload de media
 * en curso, la escalera de avisos. Sin esta espera, SIGTERM → end() → exit
 * tiraba lo que estaba en el aire; el write-ahead de processInbound y las
 * filas "pending-" lo recuperan igual en el próximo arranque, pero mejor
 * terminar lo que se puede terminar ahora. Recién al final se cierran los
 * sockets, para que lo que está en curso todavía tenga con qué hablar.
 */
export async function shutdownAll(): Promise<void> {
  const all = [...sessions.values()];
  for (const session of all) {
    session.stopped = true;
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }
  }
  const enCurso = all.flatMap((s) => [s.inboundChain, s.sendChain]);
  const empezo = Date.now();
  await Promise.race([Promise.allSettled(enCurso), sleep(SHUTDOWN_GRACE_MS)]);
  const tardo = Date.now() - empezo;
  if (tardo >= SHUTDOWN_GRACE_MS) console.warn(`[worker] las colas no terminaron en ${SHUTDOWN_GRACE_MS} ms: se cierra igual`);
  await Promise.all(all.map((s) => stopSession(s.channelId)));
}
