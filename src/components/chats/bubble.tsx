"use client";

import { memo } from "react";
import { Check, CheckCheck, CircleAlert, Clock } from "lucide-react";
import { fmtDate, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
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

/** Píldora separadora de día del hilo. */
export function DayChip({ label }: { label: string }) {
  return (
    <div className="my-2.5 flex justify-center">
      <span className="rounded-full border border-line bg-paper/95 px-3 py-1 text-[11px] font-medium text-ink-faint shadow-sm">
        {label}
      </span>
    </div>
  );
}

function StatusTicks({ status }: { status: MessageRow["status"] }) {
  if (status === "pendiente") return <Clock className="size-3 text-ink-faint" />;
  if (status === "enviado") return <Check className="size-3.5 text-ink-faint" />;
  if (status === "entregado") return <CheckCheck className="size-3.5 text-ink-faint" />;
  if (status === "leido") return <CheckCheck className="size-3.5 text-sky-500" />;
  return <CircleAlert className="size-3.5 text-red-500" />;
}

/* memo: el tick del reloj (60 s) re-renderiza el hilo pero no las 500 burbujas */
export const Bubble = memo(function Bubble({ m }: { m: MessageRow }) {
  const out = m.direction === "out";
  const isTemplate = m.kind === "plantilla";
  const isInternalNote = m.kind === "nota_interna";
  return (
    <div className={cn("flex", out ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "relative max-w-[82%] rounded-2xl px-3 py-1.5 shadow-sm md:max-w-[65%]",
          out ? "rounded-br-md bg-[#dcf5c8]" : "rounded-bl-md bg-paper",
          isTemplate && "border border-dashed border-money-700/40",
          isInternalNote && "border border-amber-200 bg-amber-50",
          m.id.startsWith("temp-") && "animate-pop",
        )}
      >
        {isTemplate && (
          <span className="block pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-money-700">
            Plantilla
          </span>
        )}
        {isInternalNote && (
          <span className="block pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
            📝 Nota interna
          </span>
        )}
        <p className="whitespace-pre-wrap break-words text-[14.5px] leading-snug text-ink">
          {m.body}
        </p>
        <div className="mt-0.5 flex items-center justify-end gap-1">
          {m.is_automated && (
            <span className="mr-0.5 text-[10px] text-ink-faint">🤖 Automático</span>
          )}
          <span className="text-[10px] tabular-nums text-ink-faint">{fmtTime(m.created_at)}</span>
          {out && <StatusTicks status={m.status} />}
        </div>
      </div>
    </div>
  );
});
