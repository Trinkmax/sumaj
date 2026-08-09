"use client";

import { memo, useState } from "react";
import {
  Bot,
  Check,
  CheckCheck,
  CircleAlert,
  Clock,
  FileText,
  Image as ImageIcon,
  Mic,
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

/* memo: el tick del reloj (60 s) re-renderiza el hilo pero no las 500 burbujas */
export const Bubble = memo(function Bubble({
  m,
  tail = false,
  fresh = false,
}: {
  m: MessageRow;
  /** primera burbuja de una racha del mismo lado → colita estilo WA */
  tail?: boolean;
  /** llegó después de la carga inicial → anima la entrada */
  fresh?: boolean;
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
  // colita solo en burbujas "normales": la nota es amarilla, la plantilla tiene
  // borde punteado y la figurita no tiene burbuja
  const withTail = tail && !isNote && !isTemplate && !isSticker;

  const meta = (
    <span
      className={cn(
        "inline-flex items-center gap-1 align-bottom text-[11px] leading-none text-wa-bubble-meta",
        media ? "justify-end" : "float-right ml-2 mt-[7px]",
      )}
    >
      {m.is_automated && (
        <span className="inline-flex items-center gap-0.5 text-[10px]">
          <Bot className="size-3" />
          Automático
        </span>
      )}
      <span className="tabular-nums">{fmtTime(m.created_at)}</span>
      {out && !isNote && <StatusTicks status={m.status} />}
    </span>
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

        {file ? (
          <>
            <MediaContent media={file} out={out} caption={caption} />
            {caption && !isSticker && (
              <p className="whitespace-pre-wrap break-words pt-1 text-[14.2px] leading-[19px] text-wa-bubble-ink">
                {caption}
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
                {mediaBody ?? media.label}
              </span>
            </div>
            <div className="flex justify-end pt-0.5">{meta}</div>
          </>
        ) : (
          <div className="text-[14.2px] leading-[19px] text-wa-bubble-ink">
            <span className="whitespace-pre-wrap break-words">{m.body}</span>
            {meta}
          </div>
        )}
      </div>
      <Reactions emojis={reactions} out={out} />
    </div>
  );
});
