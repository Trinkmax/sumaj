import { randomUUID } from "node:crypto";
import { downloadMediaMessage, type WAMessage, type WASocket } from "@whiskeysockets/baileys";
import type { WorkerMediaDescriptor } from "./contract.js";
import { uploadAttachment } from "./supabase.js";

/**
 * Adjuntos que entran por el número de la sucursal.
 *
 * Meta manda una URL; Baileys no manda nada: el binario viene cifrado y solo
 * este proceso tiene la clave para descifrarlo. Por eso el que baja y sube al
 * bucket es el worker, y a la app le llega solo el path (WorkerMediaDescriptor).
 * Mandarle los bytes a la app no es una opción: Vercel corta el body en ~4,5 MB
 * y una foto de pasaporte ya anda cerca.
 *
 * Si algo falla, el mensaje entra igual sin adjunto: la app pone el cartel de
 * "no se pudo recuperar". Perder la foto es malo; perder la consulta, peor.
 */

/**
 * Copia de src/lib/media/store.ts (el worker no puede importar de src). Si se
 * agrega un tipo allá, agregarlo acá. El nombre en el bucket no lo ve nadie,
 * pero la extensión es de lo que se agarra el navegador para saber qué es.
 */
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "application/pdf": "pdf",
  "text/plain": "txt",
};

/** "audio/ogg; codecs=opus" → "audio/ogg". Para comparar contra tablas. */
export function baseMime(mime: string | null | undefined): string {
  return (mime ?? "").split(";")[0]!.trim().toLowerCase();
}

export function extFor(mime: string, name?: string | null): string {
  const known = EXT_BY_MIME[baseMime(mime)];
  if (known) return known;
  const fromName = name?.includes(".") ? name.split(".").pop() : null;
  return (fromName ?? "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
}

/** Lo que describeMessage sabe del adjunto antes de bajarlo. */
export type InboundMediaPart = {
  mime: string | null;
  name: string | null;
  size: number | null;
  duration: number | null;
  voice: boolean;
  sticker: boolean;
  animated: boolean;
};

/** Techo duro, igual que el de la app: más que esto ni Meta lo acepta. */
const MAX_INBOUND_BYTES = 100 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * Baja el adjunto de WhatsApp (descifrado por Baileys) y lo deja en el bucket.
 * Nunca tira: devuelve null y loguea, y el mensaje sigue su camino sin adjunto.
 *
 * `reuploadRequest` importa: si el archivo ya no está en los servidores de
 * WhatsApp (410/404), Baileys le pide al celular que lo vuelva a subir y
 * reintenta solo. Sin eso, todo lo que quedó encolado mientras el worker
 * estaba caído bajaría sin archivo.
 */
export async function storeInboundMedia(input: {
  sock: WASocket;
  logger: unknown;
  message: WAMessage;
  part: InboundMediaPart;
  agencyId: string;
  channelId: string;
}): Promise<WorkerMediaDescriptor | null> {
  const tag = `[media ${input.channelId}]`;
  let buffer: Buffer;
  try {
    buffer = await withTimeout(
      downloadMediaMessage(
        input.message,
        "buffer",
        {},
        {
          logger: input.logger as never,
          reuploadRequest: (msg) => input.sock.updateMediaMessage(msg) as Promise<WAMessage>,
        },
      ),
      DOWNLOAD_TIMEOUT_MS,
      "la descarga tardó más de 30 s",
    );
  } catch (error) {
    console.warn(`${tag} no se pudo bajar el adjunto:`, error instanceof Error ? error.message : error);
    return null;
  }

  if (buffer.length === 0) {
    console.warn(`${tag} el adjunto vino vacío`);
    return null;
  }
  if (buffer.length > MAX_INBOUND_BYTES) {
    console.warn(`${tag} adjunto demasiado grande (${buffer.length} bytes)`);
    return null;
  }

  const mime = baseMime(input.part.mime) || "application/octet-stream";
  // La primera carpeta TIENE que ser el agency_id (RLS del bucket). `inbound`
  // y no el id de la conversación porque el worker no sabe cuál es: la app la
  // resuelve recién cuando procesa el evento.
  const path = `${input.agencyId}/chat/inbound/${input.channelId}/${randomUUID()}.${extFor(mime, input.part.name)}`;

  const uploaded = await uploadAttachment(path, buffer, mime);
  if (!uploaded.ok) {
    console.error(`${tag} no se pudo subir el adjunto al bucket:`, uploaded.error);
    return null;
  }

  const descriptor: WorkerMediaDescriptor = {
    path,
    mime,
    name: input.part.name,
    size: buffer.length,
    duration: input.part.duration,
  };
  if (input.part.voice) descriptor.voice = true;
  if (input.part.sticker) descriptor.sticker = true;
  if (input.part.animated) descriptor.animated = true;
  return descriptor;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, why: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const bomb = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(why);
      error.name = "TimeoutError";
      reject(error);
    }, ms);
  });
  return Promise.race([promise, bomb]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/* ═══════════════════════════════════════════════════════════
   Salida: qué MIME acepta WhatsApp por tipo
   ═══════════════════════════════════════════════════════════ */

export type OutboundMediaType = "image" | "video" | "audio" | "document" | "sticker";

/**
 * Lista blanca por tipo. Es lo que WhatsApp muestra bien del otro lado: una
 * imagen GIF como `image` no se renderiza (se manda como video con
 * gifPlayback), y un audio que no sea de estos formatos queda como "archivo".
 * El documento acepta cualquier MIME con forma válida: WhatsApp lo trata como
 * adjunto genérico y muestra el nombre.
 */
const MIME_ALLOWED: Record<OutboundMediaType, (mime: string) => boolean> = {
  image: (m) => ["image/jpeg", "image/png", "image/webp"].includes(m),
  video: (m) => ["video/mp4", "video/3gpp"].includes(m),
  audio: (m) =>
    ["audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "audio/amr", "audio/wav", "audio/x-wav", "audio/webm"].includes(m),
  document: (m) => /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(m),
  sticker: (m) => m === "image/webp",
};

export function mimeAllowed(type: OutboundMediaType, mime: string | null | undefined): boolean {
  const base = baseMime(mime);
  return !!base && MIME_ALLOWED[type](base);
}
