"use client";

import Link from "next/link";
import {
  Ban,
  CalendarClock,
  CheckCheck,
  PencilLine,
  Send,
  ThumbsUp,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { AnimatedNumber } from "@/components/ui/misc";
import { fmtDate, fmtNumber, fmtRelative, fmtTime } from "@/lib/format";
import type { BroadcastStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Metadata visual de cada estado — la comparten la lista y el resultado. */
export const BROADCAST_STATUSES: Record<
  BroadcastStatus,
  { label: string; chip: string; icon: LucideIcon }
> = {
  borrador: {
    label: "Borrador",
    chip: "border-tone-stone-line bg-tone-stone-soft text-tone-stone-text",
    icon: PencilLine,
  },
  programada: {
    label: "Programada",
    chip: "border-tone-sky-line bg-tone-sky-soft text-tone-sky-text",
    icon: CalendarClock,
  },
  enviando: {
    label: "Saliendo",
    chip: "border-tone-amber-line bg-tone-amber-soft text-tone-amber-text",
    icon: Send,
  },
  enviada: {
    label: "Enviada",
    chip: "border-tone-emerald-line bg-tone-emerald-soft text-tone-emerald-text",
    icon: CheckCheck,
  },
  cancelada: {
    label: "Cancelada",
    chip: "border-tone-red-line bg-tone-red-soft text-tone-red-text",
    icon: Ban,
  },
};

export function BroadcastStatusChip({
  status,
  className,
}: {
  status: BroadcastStatus;
  className?: string;
}) {
  const meta = BROADCAST_STATUSES[status];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        meta.chip,
        className,
      )}
    >
      <Icon className="size-3" strokeWidth={2} />
      {meta.label}
    </span>
  );
}

export type BroadcastListRow = {
  id: string;
  name: string;
  status: BroadcastStatus;
  scheduledAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  totalRecipients: number;
  /** de broadcast_totals (0 si la difusión todavía no tiene destinatarios) */
  total: number;
  enviados: number;
  respondidos: number;
  interesados: number;
  leads: number;
};

/**
 * Una difusión en la lista. El número que se lee primero NO es "mensajes
 * enviados": son los interesados y los leads, que es lo que la agencia
 * factura. Los enviados quedan como contexto de la barra de progreso.
 */
export function BroadcastCard({ row }: { row: BroadcastListRow }) {
  const salio = row.enviados > 0 || row.status === "enviada" || row.status === "enviando";
  const progreso = row.total > 0 ? row.enviados / row.total : 0;

  return (
    <Link
      href={`/difusiones/${row.id}`}
      className="card card-hover block p-4 tap-highlight-none active:bg-sand-soft/50"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BroadcastStatusChip status={row.status} />
        <span className="text-[11px] text-ink-faint">{subtitulo(row)}</span>
      </div>

      <h3 className="mt-1.5 truncate text-[15px] font-semibold text-ink">{row.name}</h3>

      {row.status === "enviando" && row.total > 0 && (
        <div className="mt-2.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-sand-soft">
            <div
              className="h-full rounded-full bg-amber-500 transition-[width] duration-700 ease-out"
              style={{ width: `${Math.max(progreso * 100, 3)}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] tabular-nums text-ink-faint">
            {fmtNumber(row.enviados)} de {fmtNumber(row.total)} mensajes
          </p>
        </div>
      )}

      {salio ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <MiniStat label="Interesados" value={row.interesados} icon={ThumbsUp} highlight />
          <MiniStat label="Leads" value={row.leads} icon={UserPlus} />
          <MiniStat label="Respuestas" value={row.respondidos} icon={CheckCheck} />
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-ink-soft">
          {row.total > 0
            ? `Le llega a ${fmtNumber(row.total)} ${row.total === 1 ? "persona" : "personas"}`
            : "Todavía sin destinatarios"}
        </p>
      )}
    </Link>
  );
}

function MiniStat({
  label,
  value,
  icon: Icon,
  highlight,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border px-2.5 py-2",
        highlight && value > 0
          ? "border-brand-tint-line bg-brand-tint"
          : "border-line bg-sand-soft/50",
      )}
    >
      <p className="flex items-center gap-1 truncate text-[10px] font-medium uppercase tracking-wide text-ink-faint">
        <Icon className="size-3 shrink-0" strokeWidth={2} />
        {label}
      </p>
      <AnimatedNumber
        value={value}
        from={0}
        format={(n) => fmtNumber(Math.round(n))}
        className={cn(
          "mt-0.5 block text-lg font-semibold leading-none",
          highlight && value > 0 ? "text-brand-text" : "text-ink",
        )}
      />
    </div>
  );
}

/** La línea chiquita de la derecha: lo que hace falta saber de un vistazo. */
function subtitulo(row: BroadcastListRow): string {
  if (row.status === "programada" && row.scheduledAt) {
    return `Sale el ${fmtDate(row.scheduledAt)} a las ${fmtTime(row.scheduledAt)}`;
  }
  if (row.status === "enviada" && row.finishedAt) return `Terminó ${fmtRelative(row.finishedAt)}`;
  return fmtRelative(row.createdAt);
}
