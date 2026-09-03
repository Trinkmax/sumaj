/**
 * Contrato entre la app y el worker de WhatsApp de las sucursales (Baileys).
 *
 * Este archivo NO importa nada: lo lee la app y hay una copia byte a byte en
 * `worker/src/contract.ts` (el worker no comparte node_modules con la app). Si
 * se toca uno hay que tocar el otro — el test de arranque del worker compara el
 * hash de los dos y avisa en el log si divergen.
 *
 * Dos direcciones:
 *   · worker → app   POST {APP_URL}/api/wa/baileys/events, firmado HMAC-SHA256
 *                    en `x-wa-signature` con WA_WEBHOOK_SECRET. Una unión de
 *                    eventos: el mensaje que entró, una reacción, un borrado, una
 *                    edición, un recibo (entregado/leído) o el resultado de un
 *                    envío de media que quedó pendiente.
 *   · app → worker   POST {WA_WORKER_URL}/sessions/{channelId}/send con el bearer
 *                    WA_WORKER_TOKEN. `content` es discriminado por `type` y se
 *                    mapea 1:1 a `AnyMessageContent` de Baileys.
 */

/* ═══════════════════════════════════════════════════════════
   worker → app
   ═══════════════════════════════════════════════════════════ */

/**
 * Un adjunto que el worker ya bajó de WhatsApp, descifró y subió al bucket
 * `attachments` con su service role. Es exactamente la forma de
 * `messages.media` (MessageMedia en src/lib/types.ts) para que la burbuja lo
 * renderice igual que un adjunto del número madre.
 */
export type WorkerMediaDescriptor = {
  path: string;
  mime: string;
  name?: string | null;
  size?: number | null;
  /** segundos, para audio y video */
  duration?: number | null;
  /** nota de voz (ptt), no archivo de audio */
  voice?: boolean;
  sticker?: boolean;
  animated?: boolean;
};

export type WorkerMessageKind = "texto" | "imagen" | "video" | "audio" | "documento";

export type WorkerEvent =
  | {
      type: "message";
      channelId: string;
      /**
       * Número del cliente, solo dígitos (E.164 sin +). Puede ser null cuando
       * WhatsApp entregó el mensaje por LID y todavía no compartió el número:
       * la app crea la conversación por `lid` y la completa cuando aparezca.
       */
      from: string | null;
      /** Linked ID de WhatsApp (dígitos, sin @lid), si el chat vino por LID */
      lid: string | null;
      /** "out" = lo escribió el operador desde el celular físico de la sucursal */
      direction: "in" | "out";
      waMessageId: string | null;
      pushName: string | null;
      text: string;
      kind: WorkerMessageKind;
      media: WorkerMediaDescriptor | null;
      /** wa_message_id del mensaje citado (respuesta), si lo hay */
      contextMessageId: string | null;
      /**
       * Lo que no entra en las columnas y la burbuja igual quiere saber:
       * { location, contacts, poll, quoted, forwarded, view_once, gif,
       *   video_note, link_preview, wa_type }
       */
      metadata: Record<string, unknown>;
      timestamp: number;
    }
  | {
      type: "reaction";
      channelId: string;
      /** wa_message_id del mensaje reaccionado */
      targetMessageId: string;
      /** null = sacó la reacción */
      emoji: string | null;
      direction: "in" | "out";
      timestamp: number;
    }
  | { type: "revoke"; channelId: string; waMessageId: string; timestamp: number }
  | { type: "edit"; channelId: string; waMessageId: string; text: string; timestamp: number }
  | {
      type: "status";
      channelId: string;
      waMessageId: string;
      status: "enviado" | "entregado" | "leido" | "fallido";
      timestamp: number;
    }
  | {
      /** Resultado de un envío de media que el worker aceptó con `pending: true` */
      type: "send_result";
      channelId: string;
      waMessageId: string;
      ok: boolean;
      error?: string | null;
      code?: BaileysSendErrorCode | null;
      timestamp: number;
    };

/* ═══════════════════════════════════════════════════════════
   app → worker
   ═══════════════════════════════════════════════════════════ */

/** Mensaje citado al responder. Baileys solo necesita la key y un texto. */
export type BaileysQuoted = { id: string; fromMe: boolean; text: string | null };

/**
 * Los adjuntos viajan como URL FIRMADA de corta vida del bucket `attachments`
 * (la app la firma con service role, ~5 min). El worker la streamea a disco
 * cifrado y la sube a WhatsApp: el binario nunca pasa por Vercel ni por RAM.
 */
export type BaileysSendContent =
  | { type: "text"; text: string }
  | { type: "image"; url: string; mime: string; caption?: string | null; size?: number | null }
  | {
      type: "video";
      url: string;
      mime: string;
      caption?: string | null;
      /** se reproduce en loop sin sonido (tiene que ser mp4) */
      gif?: boolean;
      size?: number | null;
    }
  | {
      type: "audio";
      url: string;
      mime: string;
      /** true = nota de voz (ptt); false = archivo de audio */
      voice: boolean;
      seconds?: number | null;
      size?: number | null;
    }
  | {
      type: "document";
      url: string;
      mime: string;
      fileName: string;
      caption?: string | null;
      size?: number | null;
    }
  | { type: "sticker"; url: string; animated?: boolean }
  | {
      type: "location";
      latitude: number;
      longitude: number;
      name?: string | null;
      address?: string | null;
    }
  | { type: "contact"; displayName: string; vcard: string }
  | {
      type: "reaction";
      /** wa_message_id del mensaje reaccionado */
      messageId: string;
      /** si ese mensaje lo mandamos nosotros */
      fromMe: boolean;
      /** null = sacar la reacción */
      emoji: string | null;
    };

export type BaileysSendRequest = {
  /**
   * Número del cliente, solo dígitos (E.164 sin +). Vacío ("") cuando el hilo
   * vino por LID y WhatsApp todavía no compartió el número: entonces va `toLid`.
   */
  to: string;
  /**
   * Linked ID del cliente (dígitos, sin @lid), para los hilos que entraron sin
   * número. Si viene, el worker manda al JID `<toLid>@lid` y no intenta
   * resolver `to` (que puede venir vacío). Sin esto la app mandaba
   * "lid:2462…" como si fuera un teléfono y el worker lo rechazaba.
   */
  toLid?: string;
  /** referencia para logs; no la usa WhatsApp */
  clientRef?: string;
  quoted?: BaileysQuoted;
  content: BaileysSendContent;
};

/**
 * Por qué no salió. `timeout` merece una aclaración: en Baileys un timeout NO
 * cancela el envío. El worker deja de esperar y contesta (a los 15 s en el
 * camino síncrono, antes de que la app aborte a los 20), pero `sendMessage`
 * sigue corriendo y el mensaje puede llegarle al cliente igual segundos
 * después. Por eso el texto para el vendedor dice "no supimos si salió", no
 * "no salió". `send_failed` es el genérico del camino síncrono (texto,
 * reacción, ubicación, contacto); `upload_failed` es el genérico de la media.
 */
export type BaileysSendErrorCode =
  | "not_connected"
  | "no_whatsapp"
  | "invalid_media"
  | "too_large"
  | "upload_failed"
  | "send_failed"
  | "timeout"
  | "rate_limited"
  | "bad_request";

export type BaileysSendResponse =
  | {
      ok: true;
      waMessageId: string;
      /**
       * true = el worker aceptó el envío (HTTP 202) y lo termina en background;
       * el resultado llega después como evento `send_result`. Solo para media.
       */
      pending: boolean;
    }
  | { ok: false; error: string; code: BaileysSendErrorCode };

/** Los tipos que el worker resuelve en la misma request (respuesta 200). */
export const BAILEYS_SYNC_TYPES: ReadonlySet<BaileysSendContent["type"]> = new Set([
  "text",
  "reaction",
  "location",
  "contact",
]);

/** Topes de WhatsApp por tipo, en bytes. Más que esto WhatsApp lo rechaza. */
export const BAILEYS_MAX_BYTES: Record<
  Exclude<BaileysSendContent["type"], "text" | "location" | "contact" | "reaction">,
  number
> = {
  image: 5 * 1024 * 1024,
  sticker: 500 * 1024,
  audio: 16 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};
