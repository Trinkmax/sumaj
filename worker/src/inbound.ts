import {
  getContentType,
  toNumber,
  type WAMessage,
  type proto,
} from "@whiskeysockets/baileys";
import type { WorkerMessageKind } from "./contract.js";
import type { InboundMediaPart } from "./media.js";

/**
 * De un WAMessage de Baileys a lo que la app entiende.
 *
 * WhatsApp tiene ~80 tipos de contenido y el enum `message_kind` de la base
 * tiene cinco que sirven acá (texto, imagen, video, audio, documento). Este
 * módulo es la tabla de conversión: qué kind, qué texto se ve en la burbuja y
 * en la bandeja, qué adjunto hay que bajar y qué queda en `metadata` para que
 * la burbuja pueda dibujar lo que no entra en columnas (ubicación, contacto,
 * encuesta, cita, reenviado…).
 *
 * Misma regla que el camino de la Cloud API (src/lib/wa/cloud-webhook.ts):
 * ubicación y contactos van como TEXTO legible con el MISMO formato, para que
 * el vendedor vea lo que le mandaron y el preview de la bandeja diga algo.
 * Nada se descarta mudo: lo que no se entiende entra como texto con etiqueta
 * genérica y el tipo real en `metadata.wa_type`.
 */

export type Described = {
  kind: WorkerMessageKind;
  text: string;
  /** adjunto a bajar, si el tipo lo tiene */
  media: InboundMediaPart | null;
  /** nodo del contenido con el que hay que llamar a downloadMediaMessage */
  mediaNode: { type: keyof proto.IMessage; node: object } | null;
  contextMessageId: string | null;
  meta: Record<string, unknown>;
};

export type DescribeResult = Described | { skip: string };

/** Etiquetas de la bandeja cuando el mensaje no trae texto propio (= cloud-webhook). */
const LABEL = {
  image: "Foto",
  video: "Video",
  gif: "GIF",
  videoNote: "Video",
  voice: "Mensaje de voz",
  audio: "Audio",
  document: "Documento",
  sticker: "Figurita",
} as const;

/**
 * Tipos que llegan a `messages.upsert` pero se avisan por otro lado (o no se
 * avisan): protocolMessage dispara messages.update (borrado, edición), la
 * reacción dispara messages.reaction, el voto de una encuesta no tiene dónde
 * ir y la distribución de claves es plomería de Signal.
 */
const SILENT_TYPES = new Set<string>([
  "protocolMessage",
  "reactionMessage",
  "encReactionMessage",
  "pollUpdateMessage",
  "senderKeyDistributionMessage",
  "keepInChatMessage",
  "stickerSyncRmrMessage",
  "messageContextInfo",
]);

/**
 * Envoltorios "a prueba de futuro" que normalizeMessageContent NO abre (solo
 * abre ephemeral, viewOnce, documentWithCaption y edited). Adentro viene un
 * proto.IMessage común.
 */
const FUTURE_PROOF_WRAPPERS = new Set<string>([
  "lottieStickerMessage",
  "pollCreationMessageV4",
  "pollCreationMessageV5",
  "groupMentionedMessage",
  "associatedChildMessage",
  "botInvokeMessage",
  "eventCoverImage",
  "statusMentionMessage",
  "pollCreationOptionImageMessage",
  "limitSharingMessage",
  "botTaskMessage",
  "questionMessage",
]);

type Content = proto.IMessage;

/**
 * Abre los envoltorios hasta llegar a un contenido "de verdad". Es lo mismo que
 * normalizeMessageContent de Baileys (ephemeral, viewOnce, documentWithCaption,
 * edited) más los envoltorios de arriba, pero a mano: hay que saber si en el
 * camino hubo un viewOnce, y Baileys se lo come al normalizar.
 */
function unwrap(raw: Content | null | undefined): { content: Content; type: keyof Content; viewOnce: boolean } | null {
  let content = raw ?? undefined;
  let viewOnce = false;
  for (let i = 0; i < 8 && content; i++) {
    const type = getContentType(content);
    if (!type) return null;
    if (type === "viewOnceMessage" || type === "viewOnceMessageV2" || type === "viewOnceMessageV2Extension") {
      viewOnce = true;
    }
    if (
      type === "ephemeralMessage" ||
      type === "viewOnceMessage" ||
      type === "viewOnceMessageV2" ||
      type === "viewOnceMessageV2Extension" ||
      type === "documentWithCaptionMessage" ||
      type === "editedMessage" ||
      FUTURE_PROOF_WRAPPERS.has(type)
    ) {
      content = (content[type] as proto.Message.IFutureProofMessage | null | undefined)?.message ?? undefined;
      continue;
    }
    return { content, type, viewOnce };
  }
  return null;
}

/** Los mensajes "de texto" de Baileys traen el texto en lugares distintos. */
export function textOf(content: Content | null | undefined): string {
  const opened = unwrap(content);
  if (!opened) return "";
  const { content: c } = opened;
  return (
    c.conversation ??
    c.extendedTextMessage?.text ??
    c.imageMessage?.caption ??
    c.videoMessage?.caption ??
    c.documentMessage?.caption ??
    c.ptvMessage?.caption ??
    ""
  );
}

function quotedPreview(quoted: Content | null | undefined): string {
  const opened = unwrap(quoted);
  if (!opened) return "";
  const text = textOf(opened.content);
  if (text) return text.slice(0, 160);
  switch (opened.type) {
    case "imageMessage":
      return LABEL.image;
    case "videoMessage":
    case "ptvMessage":
      return LABEL.video;
    case "audioMessage":
      return opened.content.audioMessage?.ptt ? LABEL.voice : LABEL.audio;
    case "documentMessage":
      return opened.content.documentMessage?.fileName ?? LABEL.document;
    case "stickerMessage":
      return LABEL.sticker;
    case "locationMessage":
    case "liveLocationMessage":
      return "Ubicación";
    case "contactMessage":
    case "contactsArrayMessage":
      return "Contacto";
    default:
      return "";
  }
}

/** Mismo formato que describeMessage() de src/lib/wa/cloud-webhook.ts. */
function locationText(loc: { name?: string | null; address?: string | null; degreesLatitude?: number | null; degreesLongitude?: number | null }): string {
  const donde = [loc.name, loc.address].filter(Boolean).join(" · ");
  const coords =
    loc.degreesLatitude != null && loc.degreesLongitude != null
      ? `https://maps.google.com/?q=${loc.degreesLatitude},${loc.degreesLongitude}`
      : null;
  return ["Ubicación", donde || null, coords].filter(Boolean).join("\n");
}

/** El teléfono de una vCard: `TEL;type=CELL;waid=549…:+54 9 351 …` */
function phoneFromVcard(vcard: string | null | undefined): string | null {
  const m = /TEL[^:]*:([+\d\s-]+)/.exec(vcard ?? "");
  return m ? m[1]!.trim() : null;
}

function contactsText(cards: { displayName?: string | null; vcard?: string | null }[]): string {
  const tarjetas = cards.map((c) => {
    const nombre = c.displayName ?? "Contacto";
    const tel = phoneFromVcard(c.vcard);
    return tel ? `${nombre} · ${tel}` : nombre;
  });
  return [`Contacto${tarjetas.length > 1 ? "s" : ""} compartido`, ...tarjetas].join("\n");
}

/**
 * fileLength y compañía vienen como number o Long (protobuf): siempre a number.
 * El tipo se toma de la firma de toNumber para no depender del paquete `long`,
 * que es transitivo de Baileys y no está en nuestro package.json.
 */
function num(value: Parameters<typeof toNumber>[0]): number | null {
  if (value == null) return null;
  const n = toNumber(value);
  return Number.isFinite(n) ? n : null;
}

function part(input: {
  mime?: string | null;
  name?: string | null;
  /** el mismo tipo que acepta toNumber (number | Long), sin nombrar `Long` como global */
  size?: Parameters<typeof toNumber>[0] | null;
  duration?: number | null;
  voice?: boolean;
  sticker?: boolean;
  animated?: boolean;
}): InboundMediaPart {
  return {
    mime: input.mime ?? null,
    name: input.name ?? null,
    size: num(input.size),
    duration: input.duration ?? null,
    voice: input.voice ?? false,
    sticker: input.sticker ?? false,
    animated: input.animated ?? false,
  };
}

/**
 * Clasifica un mensaje entrante. Devuelve `{ skip }` con el motivo cuando no
 * hay nada que avisar (el caller lo loguea: ningún descarte es mudo).
 */
export function describeMessage(m: WAMessage): DescribeResult {
  if (!m.message) return { skip: "sin contenido (placeholder o stub)" };

  const rawType = getContentType(m.message);
  if (rawType && SILENT_TYPES.has(rawType)) return { skip: `tipo ${rawType} (va por su propio evento)` };

  const opened = unwrap(m.message);
  if (!opened) return { skip: `contenido sin tipo reconocible (${rawType ?? "?"})` };
  const { content, type, viewOnce } = opened;

  if (SILENT_TYPES.has(type)) return { skip: `tipo ${type} (va por su propio evento)` };
  if (type === "albumMessage") return { skip: "albumMessage (las fotos llegan por separado)" };

  const meta: Record<string, unknown> = {};

  // contextInfo vive adentro del nodo del contenido, sea del tipo que sea
  const node = content[type] as { contextInfo?: proto.IContextInfo | null; viewOnce?: boolean | null } | null | undefined;
  const ctx = node && typeof node === "object" ? node.contextInfo : null;
  // "ver una vez" puede venir como envoltorio o como bandera del propio adjunto
  if (viewOnce || m.key.isViewOnce || node?.viewOnce) meta.view_once = true;
  let contextMessageId: string | null = null;
  if (ctx?.stanzaId) {
    contextMessageId = ctx.stanzaId;
    meta.quoted = { wa_message_id: ctx.stanzaId, preview: quotedPreview(ctx.quotedMessage) };
  }
  if (ctx?.isForwarded || (ctx?.forwardingScore ?? 0) > 0) {
    meta.forwarded = true;
    if (ctx?.forwardingScore) meta.forwarding_score = ctx.forwardingScore;
  }

  const base = { contextMessageId, meta, media: null, mediaNode: null } as const;
  const withMedia = (kind: WorkerMessageKind, text: string, media: InboundMediaPart, mediaType: keyof Content, mediaNode: object): Described => ({
    ...base,
    kind,
    text,
    media,
    mediaNode: { type: mediaType, node: mediaNode },
  });

  switch (type) {
    case "conversation":
      return { ...base, kind: "texto", text: content.conversation ?? "" };

    case "extendedTextMessage": {
      const t = content.extendedTextMessage!;
      if (t.matchedText || t.title) {
        meta.link_preview = {
          url: t.matchedText ?? null,
          title: t.title ?? null,
          description: t.description ?? null,
        };
      }
      return { ...base, kind: "texto", text: t.text ?? "" };
    }

    case "imageMessage": {
      const i = content.imageMessage!;
      return withMedia("imagen", i.caption || LABEL.image, part({ mime: i.mimetype, size: i.fileLength }), type, i);
    }

    case "videoMessage": {
      const v = content.videoMessage!;
      if (v.gifPlayback) meta.gif = true;
      return withMedia(
        "video",
        v.caption || (v.gifPlayback ? LABEL.gif : LABEL.video),
        part({ mime: v.mimetype, size: v.fileLength, duration: v.seconds ?? null }),
        type,
        v,
      );
    }

    case "ptvMessage": {
      const v = content.ptvMessage!;
      meta.video_note = true;
      // Se baja como videoMessage: ptv y video comparten la clave HKDF ("Video",
      // MEDIA_HKDF_KEY_MAPPING) y assertMediaContent —el camino de reupload—
      // no conoce ptvMessage.
      return withMedia("video", LABEL.videoNote, part({ mime: v.mimetype, size: v.fileLength, duration: v.seconds ?? null }), "videoMessage", v);
    }

    case "audioMessage": {
      const a = content.audioMessage!;
      const voice = a.ptt === true;
      return withMedia(
        "audio",
        voice ? LABEL.voice : LABEL.audio,
        part({ mime: a.mimetype, size: a.fileLength, duration: a.seconds ?? null, voice }),
        type,
        a,
      );
    }

    case "documentMessage": {
      const d = content.documentMessage!;
      const name = d.fileName ?? d.title ?? null;
      // El nombre NO va en el texto: viaja en media.name y la burbuja ya lo
      // muestra; ponerlo también de body lo duplicaba en pantalla.
      return withMedia("documento", d.caption || LABEL.document, part({ mime: d.mimetype, name, size: d.fileLength }), type, d);
    }

    case "stickerMessage": {
      const s = content.stickerMessage!;
      const animated = s.isAnimated === true || s.isLottie === true;
      return withMedia(
        "imagen",
        LABEL.sticker,
        part({ mime: s.mimetype ?? "image/webp", size: s.fileLength, sticker: true, animated }),
        type,
        s,
      );
    }

    case "locationMessage": {
      const l = content.locationMessage!;
      meta.location = {
        lat: l.degreesLatitude ?? null,
        lng: l.degreesLongitude ?? null,
        name: l.name ?? null,
        address: l.address ?? null,
        live: false,
      };
      return { ...base, kind: "texto", text: locationText(l) };
    }

    case "liveLocationMessage": {
      const l = content.liveLocationMessage!;
      meta.location = {
        lat: l.degreesLatitude ?? null,
        lng: l.degreesLongitude ?? null,
        name: l.caption ?? null,
        address: null,
        live: true,
      };
      return { ...base, kind: "texto", text: locationText({ ...l, name: l.caption }) };
    }

    case "contactMessage": {
      const c = content.contactMessage!;
      meta.contacts = [c.vcard ?? ""];
      return { ...base, kind: "texto", text: contactsText([c]) };
    }

    case "contactsArrayMessage": {
      const cards = content.contactsArrayMessage?.contacts ?? [];
      meta.contacts = cards.map((c) => c.vcard ?? "");
      return { ...base, kind: "texto", text: contactsText(cards) };
    }

    case "pollCreationMessage":
    case "pollCreationMessageV2":
    case "pollCreationMessageV3": {
      const p = content[type] as proto.Message.IPollCreationMessage;
      const options = (p.options ?? []).map((o) => o.optionName ?? "").filter(Boolean);
      meta.poll = { name: p.name ?? "", options, selectable: p.selectableOptionsCount ?? null };
      return {
        ...base,
        kind: "texto",
        text: [`Encuesta: ${p.name ?? ""}`, ...options.map((o) => `· ${o}`)].join("\n"),
      };
    }

    /* Respuestas a botones/listas: para el CRM es texto que escribió el cliente */
    case "buttonsResponseMessage":
      meta.wa_type = type;
      return { ...base, kind: "texto", text: content.buttonsResponseMessage?.selectedDisplayText ?? "" };
    case "templateButtonReplyMessage":
      meta.wa_type = type;
      return { ...base, kind: "texto", text: content.templateButtonReplyMessage?.selectedDisplayText ?? "" };
    case "listResponseMessage": {
      const l = content.listResponseMessage!;
      meta.wa_type = type;
      return { ...base, kind: "texto", text: l.title ?? l.description ?? "" };
    }
    case "interactiveResponseMessage":
      meta.wa_type = type;
      return { ...base, kind: "texto", text: content.interactiveResponseMessage?.body?.text ?? "" };

    case "eventMessage": {
      const e = content.eventMessage!;
      meta.wa_type = type;
      return { ...base, kind: "texto", text: ["Evento", e.name, e.description].filter(Boolean).join("\n") };
    }

    case "orderMessage": {
      const o = content.orderMessage!;
      meta.wa_type = type;
      return { ...base, kind: "texto", text: ["Pedido", o.orderTitle, o.message].filter(Boolean).join("\n") };
    }

    case "productMessage": {
      const p = content.productMessage!;
      meta.wa_type = type;
      return { ...base, kind: "texto", text: ["Producto", p.product?.title, p.body].filter(Boolean).join("\n") };
    }

    case "groupInviteMessage": {
      const g = content.groupInviteMessage!;
      meta.wa_type = type;
      return { ...base, kind: "texto", text: ["Invitación a un grupo", g.groupName, g.caption].filter(Boolean).join("\n") };
    }

    default: {
      // Lo que no sabemos dibujar entra igual: el vendedor ve que le mandaron
      // ALGO y puede mirarlo en el celular de la sucursal.
      meta.wa_type = type;
      const inner = content[type] as { caption?: string | null; text?: string | null } | null | undefined;
      const text = (inner && typeof inner === "object" && (inner.caption ?? inner.text)) || "";
      return { ...base, kind: "texto", text: text || `Mensaje de WhatsApp que el sistema todavía no muestra (${type})` };
    }
  }
}
