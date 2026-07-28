import { Boom } from "@hapi/boom";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { config } from "./config.js";
import { useSupabaseAuthState } from "./auth-state.js";
import { getChannel, patchChannel } from "./supabase.js";
import { notifyApp } from "./notify.js";

const logger = pino({ level: config.logLevel }) as never;

/** El QR de WhatsApp vive ~60 s; damos margen para que la UI lo muestre. */
const QR_TTL_MS = 60_000;
/** Backoff de reconexión: no martillar a WhatsApp si algo está mal. */
const RECONNECT_BASE_MS = 3_000;
const RECONNECT_MAX_MS = 60_000;

type Session = {
  channelId: string;
  agencyId: string;
  sock: WASocket | null;
  starting: boolean;
  /** cerrada a propósito (logout / stop): no reconectar */
  stopped: boolean;
  attempts: number;
  timer: NodeJS.Timeout | null;
};

const sessions = new Map<string, Session>();

export function sessionState(channelId: string) {
  const s = sessions.get(channelId);
  return {
    running: !!s && !s.stopped,
    connected: !!s?.sock?.user,
    phone: s?.sock?.user?.id ? onlyDigits(jidNormalizedUser(s.sock.user.id)) : null,
  };
}

function onlyDigits(value: string): string {
  return value.split("@")[0].split(":")[0].replace(/\D/g, "");
}

/** "5493511234567" → "5493511234567@s.whatsapp.net" */
export function toJid(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

/**
 * Levanta (o relevanta) la sesión de un canal. Idempotente: si ya está corriendo
 * no hace nada. Cada sucursal es una sesión independiente dentro del mismo proceso.
 */
export async function startSession(channelId: string): Promise<void> {
  const existing = sessions.get(channelId);
  if (existing && (existing.starting || existing.sock)) {
    existing.stopped = false;
    return;
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
  };
  session.starting = true;
  session.stopped = false;
  sessions.set(channelId, session);

  try {
    const { state, saveCreds, clear } = await useSupabaseAuthState(channelId);
    const { version } = await fetchLatestBaileysVersion();

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
    });

    session.sock = sock;
    session.starting = false;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
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
        const phone = sock.user?.id ? onlyDigits(jidNormalizedUser(sock.user.id)) : null;
        await patchChannel(channelId, {
          status: "conectado",
          qr: null,
          qr_expires_at: null,
          phone,
          last_connected_at: new Date().toISOString(),
          last_error: null,
        });
        console.log(`[session ${channelId}] conectado como ${phone ?? "?"}`);
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        session.sock = null;

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

        if (session.stopped) return;

        session.attempts += 1;
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** (session.attempts - 1), RECONNECT_MAX_MS);
        await patchChannel(channelId, {
          status: "error",
          last_error: `Se cortó la conexión (código ${statusCode ?? "?"}). Reintentando…`,
        });
        console.warn(`[session ${channelId}] reconecta en ${delay}ms (intento ${session.attempts})`);
        session.timer = setTimeout(() => {
          startSession(channelId).catch((e) =>
            console.error(`[session ${channelId}] falló la reconexión:`, e),
          );
        }, delay);
      }
    });

    /* mensajes entrantes → la app decide qué hacer (lead, ruteo, alerta) */
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const m of messages) {
        if (m.key.fromMe) continue;
        const jid = m.key.remoteJid ?? "";
        // grupos, estados y difusiones no son consultas de clientes
        if (!jid.endsWith("@s.whatsapp.net")) continue;

        const text =
          m.message?.conversation ??
          m.message?.extendedTextMessage?.text ??
          m.message?.imageMessage?.caption ??
          m.message?.videoMessage?.caption ??
          "";

        await notifyApp({
          type: "message",
          channelId,
          from: onlyDigits(jid),
          waMessageId: m.key.id ?? null,
          pushName: m.pushName ?? null,
          text,
          kind: m.message?.imageMessage
            ? "imagen"
            : m.message?.videoMessage
              ? "video"
              : m.message?.audioMessage
                ? "audio"
                : m.message?.documentMessage
                  ? "documento"
                  : "texto",
          timestamp: Number(m.messageTimestamp ?? 0) * 1000 || Date.now(),
        });
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

/** Cierra la sesión sin borrar credenciales (para apagar el worker o pausar). */
export async function stopSession(channelId: string): Promise<void> {
  const session = sessions.get(channelId);
  if (!session) return;
  session.stopped = true;
  if (session.timer) clearTimeout(session.timer);
  try {
    session.sock?.end(undefined);
  } catch {
    // ya estaba cerrada
  }
  session.sock = null;
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

export type SendResult = { waMessageId: string | null };

/** Envía un texto por el número de la sucursal. */
export async function sendText(
  channelId: string,
  to: string,
  text: string,
): Promise<SendResult> {
  const session = sessions.get(channelId);
  const sock = session?.sock;
  if (!sock || !sock.user) throw new Error("El número de la sucursal no está conectado");

  const jid = toJid(to);
  const found = (await sock.onWhatsApp(jid).catch(() => [])) ?? [];
  const check = found[0];
  if (check && check.exists === false) throw new Error("Ese número no tiene WhatsApp");

  const sent = await sock.sendMessage(check?.jid ?? jid, { text });
  return { waMessageId: sent?.key?.id ?? null };
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

export async function shutdownAll(): Promise<void> {
  await Promise.all([...sessions.keys()].map((id) => stopSession(id)));
}
