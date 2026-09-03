"use client";

import { memo, useState, type ReactNode } from "react";
import {
  Ban,
  Bot,
  Check,
  CheckCheck,
  CircleAlert,
  Clock,
  Eye,
  FileText,
  Forward,
  Image as ImageIcon,
  MapPin,
  Mic,
  Smartphone,
  StickyNote,
  Video,
  type LucideIcon,
} from "lucide-react";
import { fmtDate, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MediaContent, Reactions } from "./media-bubble";
import type { MessageMedia, MessageReaction } from "@/lib/types";
import type { MessageRow } from "./types";

/** Ventana de respuesta libre de WhatsApp (24 hs desde el último entrante). */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

export function dayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hoy";
  if (d.toDateString() === yesterday.toDateString()) return "Ayer";
  return fmtDate(d);
}

export type ThreadItem =
  | { type: "day"; key: string; label: string }
  | { type: "msg"; msg: MessageRow };

/** Intercala separadores de día entre los mensajes (ya en orden cronológico). */
export function groupMessagesByDay(messages: MessageRow[]): ThreadItem[] {
  const out: ThreadItem[] = [];
  let lastDay = "";
  for (const m of messages) {
    const d = new Date(m.created_at);
    const key = d.toDateString();
    if (key !== lastDay) {
      out.push({ type: "day", key, label: dayLabel(d) });
      lastDay = key;
    }
    out.push({ type: "msg", msg: m });
  }
  return out;
}

/** NUEVO (aditivo): mensajes agrupados por día, para chips sticky estilo WA. */
export type DayGroup = { key: string; label: string; msgs: MessageRow[] };

export function groupMessagesIntoDayGroups(messages: MessageRow[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const m of messages) {
    const d = new Date(m.created_at);
    const key = d.toDateString();
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.msgs.push(m);
    else groups.push({ key, label: dayLabel(d), msgs: [m] });
  }
  return groups;
}

/**
 * ¿Esta burbuja arranca una racha (misma dirección seguida)?
 * La primera de cada racha lleva colita, como WhatsApp.
 * Las notas internas no llevan colita y cortan la racha.
 */
export function startsStreak(prev: MessageRow | undefined, m: MessageRow): boolean {
  if (m.kind === "nota_interna") return false;
  if (!prev || prev.kind === "nota_interna") return true;
  return prev.direction !== m.direction;
}

/** Chip separador de día — flota sticky sobre el wallpaper, como WA. */
export function DayChip({ label }: { label: string }) {
  return (
    <div className="pointer-events-none sticky top-1.5 z-[5] my-2.5 flex justify-center">
      <span className="rounded-lg bg-wa-panel-alt px-3 py-1.5 text-[12px] font-medium text-wa-ink-soft shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
        {label}
      </span>
    </div>
  );
}

function StatusTicks({ status }: { status: MessageRow["status"] }) {
  // solo animamos cambios de status en vivo, no la carga del historial
  // (ajuste de estado durante el render)
  const [prevStatus, setPrevStatus] = useState(status);
  const [changed, setChanged] = useState(false);
  if (prevStatus !== status) {
    setPrevStatus(status);
    setChanged(true);
  }
  return (
    <span
      key={status}
      className={cn("inline-flex shrink-0 items-center", changed && "animate-check-pop")}
    >
      {status === "pendiente" ? (
        <Clock className="size-3 text-wa-bubble-meta" />
      ) : status === "enviado" ? (
        <Check className="size-4 text-wa-bubble-meta" />
      ) : status === "entregado" ? (
        <CheckCheck className="size-4 text-wa-bubble-meta" />
      ) : status === "leido" ? (
        <CheckCheck className="size-4 text-wa-tick" />
      ) : (
        <CircleAlert className="size-3.5 text-tone-red-text" />
      )}
    </span>
  );
}

const MEDIA_META: Partial<Record<MessageRow["kind"], { icon: LucideIcon; label: string }>> = {
  imagen: { icon: ImageIcon, label: "Foto" },
  documento: { icon: FileText, label: "Documento" },
  audio: { icon: Mic, label: "Mensaje de voz" },
  video: { icon: Video, label: "Video" },
};

/** "[image]" / "[audio]" del webhook no son texto para humanos. */
function cleanMediaBody(body: string | null): string | null {
  if (!body) return null;
  return /^\[(image|document|audio|video|sticker)\]$/i.test(body.trim()) ? null : body;
}

/**
 * El nombre que le puso el webhook a un adjunto ("Foto", "Mensaje de voz") es un
 * relleno para la bandeja: adentro de la burbuja ya se ve la foto, así que
 * repetirlo abajo es ruido. El pie de foto que escribió el cliente, en cambio,
 * es contenido y va.
 */
const PLACEHOLDERS = new Set([
  "foto",
  "video",
  // el worker de las sucursales etiqueta así un gif / un audio sin caption
  // (`LABELS` de worker/src/inbound.ts); son relleno igual que "Foto"
  "gif",
  "audio",
  "mensaje de voz",
  "documento",
  "figurita",
  "imagen",
  "adjunto",
]);

function captionOf(body: string | null): string | null {
  const clean = cleanMediaBody(body)?.trim();
  if (!clean) return null;
  return PLACEHOLDERS.has(clean.toLowerCase()) ? null : clean;
}

/** El jsonb de la base, tipado — o null si la fila es vieja o vino vacía. */
function mediaOf(m: MessageRow): MessageMedia | null {
  const raw = m.media as unknown;
  if (!raw || typeof raw !== "object") return null;
  const media = raw as MessageMedia;
  return typeof media.path === "string" && typeof media.mime === "string" ? media : null;
}

function reactionsOf(m: MessageRow): string[] {
  const raw = m.reactions as unknown;
  if (!Array.isArray(raw)) return [];
  return (raw as MessageReaction[]).map((r) => r?.emoji).filter((e): e is string => !!e);
}

/* ───────────────────────── metadata ─────────────────────────
   `messages.metadata` es jsonb libre: lo que no entra en las columnas y la
   burbuja igual quiere saber (borrado, editado, cita, reenvío, ubicación, ver
   una vez — ver `WorkerEvent.metadata` en lib/wa/worker-contract.ts). Se lee con
   guards y no con un cast al tipo oficial: las filas viejas traen `{}`, cada
   canal escribe solo lo suyo, y un dato mal formado tiene que degradar a
   "no hay etiqueta", nunca a una burbuja rota. */

type BubbleMeta = {
  /** la persona lo borró para todos: el cuerpo ya no es el original */
  revoked: boolean;
  /** ISO; `body` ya es la versión editada */
  editedAt: string | null;
  /** el mensaje al que responde, con lo que alcanza para pintar la cita */
  quoted: { preview: string | null } | null;
  forwarded: boolean;
  /** el sistema lo mandó y volvió como eco por el worker (no lo escribió nadie desde el celular) */
  echo: boolean;
  /** alguien lo marcó explícito como escrito desde el celular físico (hoy nadie lo hace) */
  fromPhone: boolean;
  location: { lat: number; lng: number } | null;
  /** foto/video para ver una sola vez: el adjunto no se guarda */
  viewOnce: boolean;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringOf(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function numberOf(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function metaOf(m: MessageRow): BubbleMeta {
  const raw = m.metadata as unknown;
  const md = isRecord(raw) ? raw : {};

  /* la cita puede venir como {preview} (resumen ya armado) o {text} (lo que
     dice el citado): se acepta cualquiera de los dos para no depender de
     quién la escribió */
  const quotedRaw = isRecord(md.quoted) ? md.quoted : null;
  const quoted = quotedRaw
    ? { preview: stringOf(quotedRaw.preview) ?? stringOf(quotedRaw.text) }
    : null;

  // ídem la ubicación: {lat,lng} o {latitude,longitude}
  const locRaw = isRecord(md.location) ? md.location : null;
  const lat = locRaw ? (numberOf(locRaw.lat) ?? numberOf(locRaw.latitude)) : null;
  const lng = locRaw ? (numberOf(locRaw.lng) ?? numberOf(locRaw.longitude)) : null;

  return {
    revoked: md.revoked === true,
    editedAt: stringOf(md.edited_at),
    quoted,
    forwarded: md.forwarded === true,
    echo: md.echo === true,
    fromPhone: md.from_phone === true,
    location: lat != null && lng != null ? { lat, lng } : null,
    viewOnce: md.view_once === true,
  };
}

/* ───────────────────────── links ───────────────────────── */

const URL_RE = /((?:https?:\/\/|www\.)[^\s<]+)/gi;
const URL_TRAIL_RE = /[.,;:!?)]+$/;

/**
 * El texto con los links clickeables, como en WhatsApp. Las ubicaciones y los
 * presupuestos viajan como URL en el cuerpo: un link que no se puede tocar es
 * un mensaje al que el vendedor tiene que copiar y pegar.
 */
function Linkified({ text }: { text: string }): ReactNode {
  const parts = text.split(URL_RE);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (i % 2 === 0) return part;
    // el punto final de la oración no es parte del link
    const trail = part.match(URL_TRAIL_RE)?.[0] ?? "";
    const url = trail ? part.slice(0, -trail.length) : part;
    return (
      <span key={i}>
        <a
          href={url.startsWith("http") ? url : `https://${url}`}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all underline underline-offset-2 hover:opacity-80"
        >
          {url}
        </a>
        {trail}
      </span>
    );
  });
}

function hasUrl(text: string | null): boolean {
  if (!text) return false;
  URL_RE.lastIndex = 0;
  return URL_RE.test(text);
}

/* memo: el tick del reloj (60 s) re-renderiza el hilo pero no las 500 burbujas */
export const Bubble = memo(function Bubble({
  m,
  tail = false,
  fresh = false,
  channel,
}: {
  m: MessageRow;
  /** primera burbuja de una racha del mismo lado → colita estilo WA */
  tail?: boolean;
  /** llegó después de la carga inicial → anima la entrada */
  fresh?: boolean;
  /** canal del hilo: "desde el celular" solo tiene sentido en WhatsApp */
  channel?: "whatsapp" | "instagram";
}) {
  const out = m.direction === "out";
  const isTemplate = m.kind === "plantilla";
  const isNote = m.kind === "nota_interna";
  /* El archivo de verdad, si el webhook lo pudo bajar. Cuando no está, se cae al
     cartelito de antes: un mensaje sin adjunto recuperable sigue siendo un
     mensaje, y el vendedor tiene que ver que le mandaron algo. */
  const file = mediaOf(m);
  const media = MEDIA_META[m.kind];
  const mediaBody = media ? cleanMediaBody(m.body) : m.body;
  const caption = captionOf(m.body);
  const reactions = reactionsOf(m);
  const isSticker = file?.sticker === true;
  /* No salió. La burbuja tiene que decirlo con el cuerpo, no con un ícono: el
     verde de "saliente" es la señal más fuerte de la pantalla y leerlo como
     enviado es exactamente lo que no puede pasar. */
  const failed = out && m.status === "fallido";
  // colita solo en burbujas "normales": la nota es amarilla, la plantilla tiene
  // borde punteado y la figurita no tiene burbuja
  const withTail = tail && !isNote && !isTemplate && !isSticker;

  const md = metaOf(m);
  /* "desde el celular": salió por el número de la sucursal pero no lo escribió
     nadie desde la app (sin `sent_by`) ni fue un automático — o sea, alguien
     contestó desde el teléfono físico. No hay clave en metadata que lo diga:
     se deduce de las columnas (el guard de `from_phone` queda por si algún día
     alguien lo marca explícito). Dos excepciones, porque la misma deducción
     matchea cosas que NO son el celular: los ecos de Instagram (todo lo que
     manda la cuenta vuelve por webhook sin `sent_by`), así que solo se muestra
     en WhatsApp; y `metadata.echo`, que es lo que mandó el sistema y el worker
     devolvió como eco. */
  const fromPhone =
    out &&
    !isNote &&
    channel !== "instagram" &&
    !md.echo &&
    (md.fromPhone || (m.sent_by == null && !m.is_automated));
  // borrado para todos: el cuerpo y el adjunto ya no cuentan
  const revoked = md.revoked;

  const meta = (
    <span
      className={cn(
        "inline-flex items-center gap-1 align-bottom text-[11px] leading-none text-wa-bubble-meta",
        media && !revoked ? "justify-end" : "float-right ml-2 mt-[7px]",
      )}
    >
      {m.is_automated && (
        <span className="inline-flex items-center gap-0.5 text-[10px]">
          <Bot className="size-3" />
          Automático
        </span>
      )}
      {fromPhone && (
        <span className="inline-flex items-center gap-0.5 text-[10px]">
          <Smartphone className="size-3" />
          desde el celular
        </span>
      )}
      {md.editedAt && !revoked && <span className="text-[10px]">editado</span>}
      <span className="tabular-nums">{fmtTime(m.created_at)}</span>
      {out && !isNote && <StatusTicks status={m.status} />}
    </span>
  );

  /* Etiquetas de contexto arriba del cuerpo, en el mismo registro que
     "Plantilla": reenviado y ver una vez son cosas que WhatsApp muestra antes
     del mensaje, y el vendedor las lee igual. */
  const contextLabels = !revoked && (md.forwarded || md.viewOnce) && (
    <span className="flex flex-wrap items-center gap-x-2.5 pt-0.5 text-[11px] italic text-wa-bubble-meta">
      {md.forwarded && (
        <span className="inline-flex items-center gap-1">
          <Forward className="size-3" strokeWidth={2} />
          Reenviado
        </span>
      )}
      {md.viewOnce && (
        <span className="inline-flex items-center gap-1">
          <Eye className="size-3" strokeWidth={2} />
          Ver una vez
        </span>
      )}
    </span>
  );

  /* La cita: bloque atenuado con borde a la izquierda, arriba del cuerpo, como
     en WhatsApp. Sin ir a buscar el mensaje original: el preview alcanza. */
  const quoteBlock = !revoked && md.quoted && (
    <div className="my-1 rounded-md border-l-[3px] border-wa-accent-deep bg-wa-ink/5 px-2 py-1">
      {/* tinta de la burbuja atenuada, no el gris del panel: sobre el verde
          de la saliente el gris del panel queda en ~2.6:1 en oscuro */}
      <p className="line-clamp-2 text-[12.5px] leading-[17px] text-wa-bubble-ink/80">
        {md.quoted.preview ?? "Mensaje"}
      </p>
    </div>
  );

  /* La ubicación normalmente ya viene con el link de maps en el texto. Si el
     canal solo dejó las coordenadas en metadata, se arma el link igual: una
     ubicación sin dónde tocar no sirve para nada. */
  const mapLink = md.location && !hasUrl(m.body) && (
    <a
      href={`https://maps.google.com/?q=${md.location.lat},${md.location.lng}`}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 flex w-fit items-center gap-1 text-[13px] underline underline-offset-2 hover:opacity-80"
    >
      <MapPin className="size-3.5" strokeWidth={2} />
      Ver en el mapa
    </a>
  );

  return (
    <div
      className={cn(
        "flex flex-col",
        out ? "items-end" : "items-start",
        tail || isNote ? "mt-2" : "mt-[2px]",
        fresh && "animate-msg-in",
      )}
    >
      <div
        className={cn(
          "relative max-w-[85%] md:max-w-[65%]",
          // La figurita no lleva burbuja: va suelta sobre el wallpaper, como en
          // WhatsApp. Con fondo verde dejaría de leerse como una figurita.
          isSticker
            ? ""
            : "rounded-lg px-[9px] py-[6px] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]",
          isSticker
            ? ""
            : isNote
              ? "border border-tone-amber-line bg-tone-amber-soft"
              : out
                ? "bg-wa-bubble-out"
                : "bg-wa-bubble-in",
          withTail && (out ? "rounded-tr-none bubble-tail-out" : "rounded-tl-none bubble-tail-in"),
          isTemplate && "border border-dashed border-wa-accent-deep/50",
          // el borde rojo gana: si no salió, importa más que sea una plantilla
          failed && "border border-tone-red-line opacity-90",
        )}
      >
        {isTemplate && (
          <span className="block pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-wa-accent-deep">
            Plantilla
          </span>
        )}
        {isNote && (
          <span className="flex items-center gap-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-tone-amber-text">
            <StickyNote className="size-3" />
            Nota interna
          </span>
        )}

        {contextLabels}
        {quoteBlock}

        {revoked ? (
          /* Borrado para todos: WhatsApp no deja rastro del contenido y acá
             tampoco. Queda la burbuja (hubo un mensaje) con el aviso. */
          <div className="text-[14.2px] leading-[19px] text-wa-bubble-ink">
            <span className="inline-flex items-center gap-1.5 italic text-wa-bubble-meta">
              <Ban className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
              Se eliminó este mensaje
            </span>
            {meta}
          </div>
        ) : file ? (
          <>
            <MediaContent media={file} out={out} caption={caption} />
            {caption && !isSticker && (
              <p className="whitespace-pre-wrap break-words pt-1 text-[14.2px] leading-[19px] text-wa-bubble-ink">
                <Linkified text={caption} />
              </p>
            )}
            <div className={cn("flex justify-end", isSticker ? "pt-0.5" : "pt-0.5")}>{meta}</div>
          </>
        ) : media ? (
          /* Sin archivo recuperable: el cartel de antes. Pasa con los mensajes
             anteriores a que el sistema empezara a bajarlos, y cuando Meta ya lo
             borró (el id entrante caduca a los 7 días). */
          <>
            <div className="my-0.5 flex items-center gap-2.5 rounded-md bg-wa-ink/5 px-2.5 py-2">
              <media.icon className="size-4.5 shrink-0 text-wa-ink-soft" strokeWidth={1.9} />
              <span className="whitespace-pre-wrap break-words text-[13.5px] leading-snug text-wa-bubble-ink">
                {mediaBody ? <Linkified text={mediaBody} /> : media.label}
              </span>
            </div>
            <div className="flex justify-end pt-0.5">{meta}</div>
          </>
        ) : (
          <div className="text-[14.2px] leading-[19px] text-wa-bubble-ink">
            <span className="whitespace-pre-wrap break-words">
              {m.body ? <Linkified text={m.body} /> : null}
            </span>
            {mapLink}
            {meta}
          </div>
        )}

        {/* Por qué no salió, adentro de la burbuja.
            Un mensaje fallido se veía EXACTAMENTE igual a uno enviado salvo por
            un ícono de 14px, y el motivo —que estaba guardado en la fila— no se
            mostraba en ningún lado. El operador quedaba mirando tres plantillas
            verdes creyendo que el cliente las tenía, cuando no salió ninguna. */}
        {failed && (
          <div className="clear-both mt-1.5 flex items-start gap-1.5 rounded-md bg-tone-red-soft px-2 py-1.5">
            <CircleAlert
              className="mt-px size-3.5 shrink-0 text-tone-red-text"
              strokeWidth={2}
              aria-hidden
            />
            <p className="text-[11.5px] leading-snug text-tone-red-text">
              <span className="font-semibold">No se envió.</span>{" "}
              {m.error_detail ?? "WhatsApp lo rechazó."}
            </p>
          </div>
        )}
      </div>
      <Reactions emojis={reactions} out={out} />
    </div>
  );
});
