"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Ban,
  CircleHelp,
  CircleSlash,
  Send,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  Trophy,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedNumber } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/config/confirm-dialog";
import { WaTemplatePreview } from "@/components/config/template-dialog";
import { cancelBroadcast } from "@/lib/actions/broadcasts";
import { fmtDate, fmtMoney, fmtNumber, fmtTime } from "@/lib/format";
import type { BroadcastStatus, TemplateButton } from "@/lib/types";
import { cn } from "@/lib/utils";

export type BroadcastTotals = {
  total: number;
  pendientes: number;
  omitidos: number;
  fallidos: number;
  enviados: number;
  entregados: number;
  leidos: number;
  respondidos: number;
  interesados: number;
  talVez: number;
  bajas: number;
  leads: number;
  ventas: number;
  ventaTotal: number;
};

export type BroadcastSummary = {
  id: string;
  name: string;
  status: BroadcastStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  throttlePerRun: number;
  header: string | null;
  body: string;
  footer: string | null;
  buttons: TemplateButton[];
  branchName: string | null;
  templateName: string | null;
};

/** Cada 20 segundos alcanza: el despachador manda un lote cada 5 minutos. */
const REFRESH_MS = 20_000;

export function Results({
  broadcast,
  totals,
  currency,
  canCancel,
}: {
  broadcast: BroadcastSummary;
  totals: BroadcastTotals;
  /** moneda de las ventas que salieron de esta difusión */
  currency: string;
  /** admin y la difusión todavía se puede frenar */
  canCancel: boolean;
}) {
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const viva = broadcast.status === "enviando" || broadcast.status === "programada";

  // Mientras sale, la pantalla se refresca sola: el vendedor la deja abierta y
  // ve entrar las respuestas sin tocar nada.
  React.useEffect(() => {
    if (!viva) return;
    const id = window.setInterval(() => router.refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [viva, router]);

  const enviadosOTotal = broadcast.status === "programada" ? 0 : totals.enviados;
  const progreso = totals.total > 0 ? enviadosOTotal / totals.total : 0;
  const faltan = Math.max(totals.total - enviadosOTotal, 0);
  const minutosRestantes =
    broadcast.throttlePerRun > 0 ? Math.ceil(faltan / broadcast.throttlePerRun) * 5 : 0;

  const ventana = broadcast.startedAt
    ? broadcast.finishedAt
      ? `Salió el ${fmtDate(broadcast.startedAt)}, de ${fmtTime(broadcast.startedAt)} a ${fmtTime(broadcast.finishedAt)}`
      : `Arrancó el ${fmtDate(broadcast.startedAt)} a las ${fmtTime(broadcast.startedAt)}`
    : null;

  return (
    <div className="space-y-4">
      {/* ── progreso vivo ── */}
      {viva && (
        <section className="card animate-slide-up p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">
                {broadcast.status === "programada" ? "Programada" : "Saliendo ahora"}
              </p>
              <p className="mt-0.5 text-[13px] text-ink-soft">
                {broadcast.status === "programada" && broadcast.scheduledAt
                  ? `Arranca el ${fmtDate(broadcast.scheduledAt)} a las ${fmtTime(broadcast.scheduledAt)} · ${fmtNumber(totals.total)} ${totals.total === 1 ? "persona" : "personas"}`
                  : `${fmtNumber(totals.enviados)} de ${fmtNumber(totals.total)} · salen ${broadcast.throttlePerRun} cada 5 minutos${
                      minutosRestantes > 0 ? ` · faltan unos ${minutosRestantes} min` : ""
                    }`}
              </p>
            </div>
            {canCancel && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCancelOpen(true)}
                className="shrink-0"
              >
                <Ban />
                Frenar
              </Button>
            )}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-sand-soft">
            <div
              className="h-full rounded-full bg-amber-500 transition-[width] duration-700 ease-out"
              style={{ width: `${progreso > 0 ? Math.max(progreso * 100, 2) : 0}%` }}
            />
          </div>
        </section>
      )}

      {/* ── el número que importa ── */}
      <section className="grid grid-cols-2 gap-2.5 md:gap-3 stagger-children">
        <HeroStat
          label="Interesados"
          value={totals.interesados}
          icon={ThumbsUp}
          hint="tocaron el botón de interés"
          tone="brand"
        />
        <HeroStat
          label="Leads"
          value={totals.leads}
          icon={UserPlus}
          hint="entraron al pipeline"
          tone="ink"
        />
      </section>

      {totals.ventas > 0 && (
        <section className="card flex items-center gap-3 p-4 animate-fade-in md:p-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-money-tint text-money-text">
            <Trophy className="size-5" strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] text-ink-soft">
              {totals.ventas === 1
                ? "Una venta salió de esta difusión"
                : `${fmtNumber(totals.ventas)} ventas salieron de esta difusión`}
            </p>
            <p className="text-xl font-semibold tabular-nums text-money-text md:text-2xl">
              {fmtMoney(totals.ventaTotal, currency)}
            </p>
          </div>
        </section>
      )}

      {/* ── el embudo real ── */}
      <section className="card p-4 md:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-ink">De la salida a la venta</h2>
          {ventana && <p className="text-[11px] text-ink-faint">{ventana}</p>}
        </div>
        <div className="mt-3">
          <Funnel totals={totals} />
        </div>
      </section>

      {/* ── lo que no hay que festejar, pero hay que ver ── */}
      <section className="flex flex-wrap gap-2">
        <SideStat label="Tal vez" value={totals.talVez} icon={CircleHelp} />
        <SideStat label="Se dieron de baja" value={totals.bajas} icon={ThumbsDown} tone="amber" />
        <SideStat label="No llegaron" value={totals.fallidos} icon={TriangleAlert} tone="red" />
        {/* omitidos: los que salteamos a propósito (baja, sin teléfono, fatiga) */}
        <SideStat label="Salteados" value={totals.omitidos} icon={CircleSlash} />
        {totals.pendientes > 0 && (
          <SideStat label="Sin salir" value={totals.pendientes} icon={Send} />
        )}
      </section>

      {/* ── lo que recibió la gente ── */}
      <section className="card p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-ink">Lo que recibieron</h2>
          {broadcast.branchName && (
            <span className="text-[11px] text-ink-faint">
              Los que contestan caen en {broadcast.branchName}
            </span>
          )}
        </div>
        <div className="mt-3">
          <WaTemplatePreview
            header={broadcast.header}
            body={broadcast.body}
            footer={broadcast.footer}
            buttons={broadcast.buttons}
          />
        </div>
        {broadcast.templateName && (
          <p className="mt-2 truncate font-mono text-[11px] text-ink-faint">
            {broadcast.templateName}
          </p>
        )}
      </section>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="¿Frenar la difusión?"
        description="Los que ya la recibieron la tienen. Al resto no les llega y no se puede retomar."
        confirmLabel="Frenar"
        onConfirm={async () => {
          const res = await cancelBroadcast({ id: broadcast.id });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("Difusión frenada.");
          setCancelOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}

/* ───────────────────────────── el embudo ─────────────────────────────
   Barras horizontales con el % de conversión respecto del paso anterior: es la
   única forma de ver DÓNDE se pierde la gente y no solo cuánta queda. */

type FunnelStep = { key: string; label: string; count: number; dot: string; bar: string };

function Funnel({ totals }: { totals: BroadcastTotals }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const steps: FunnelStep[] = [
    { key: "enviados", label: "Salieron", count: totals.enviados, dot: "bg-stone-400", bar: "bg-stone-400" },
    { key: "entregados", label: "Llegaron", count: totals.entregados, dot: "bg-sky-400", bar: "bg-sky-400" },
    { key: "leidos", label: "Lo leyeron", count: totals.leidos, dot: "bg-sky-500", bar: "bg-sky-500" },
    { key: "respondidos", label: "Contestaron", count: totals.respondidos, dot: "bg-violet-500", bar: "bg-violet-500" },
    { key: "interesados", label: "Interesados", count: totals.interesados, dot: "bg-emerald-500", bar: "bg-emerald-500" },
    { key: "leads", label: "Leads", count: totals.leads, dot: "bg-brand-500", bar: "bg-brand-500" },
    { key: "ventas", label: "Ventas", count: totals.ventas, dot: "bg-money-600", bar: "bg-money-600" },
  ];

  const max = Math.max(...steps.map((s) => s.count), 1);

  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].count : null;
        const pct = prev && prev > 0 ? Math.round((s.count / prev) * 100) : null;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <span className={cn("size-1.5 shrink-0 rounded-full", s.dot)} />
            <span className="w-[86px] shrink-0 truncate text-xs text-ink-soft md:w-24">
              {s.label}
            </span>
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sand-soft">
              <div
                className={cn("h-full rounded-full transition-[width] duration-700 ease-out", s.bar)}
                style={{
                  width: mounted && s.count > 0 ? `${Math.max((s.count / max) * 100, 4)}%` : "0%",
                }}
              />
            </div>
            <span className="w-9 shrink-0 text-right text-[13px] font-semibold tabular-nums text-ink">
              {fmtNumber(s.count)}
            </span>
            <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-ink-faint">
              {pct !== null ? `${pct}%` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────────── piezas ───────────────────────────── */

function HeroStat({
  label,
  value,
  icon: Icon,
  hint,
  tone,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  hint: string;
  tone: "brand" | "ink";
}) {
  return (
    <div
      className={cn(
        "card min-w-0 p-4 md:p-5",
        tone === "brand" && value > 0 && "border-brand-tint-line bg-brand-tint",
      )}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        <Icon className="size-3.5 shrink-0" strokeWidth={2} />
        {label}
      </p>
      <AnimatedNumber
        value={value}
        from={0}
        format={(n) => fmtNumber(Math.round(n))}
        className={cn(
          "mt-1 block text-[32px] font-semibold leading-none md:text-[40px]",
          tone === "brand" && value > 0 ? "text-brand-text" : "text-ink",
        )}
      />
      <p className="mt-1.5 text-[11px] text-ink-faint">{hint}</p>
    </div>
  );
}

function SideStat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone?: "amber" | "red";
}) {
  const activo = value > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px]",
        activo && tone === "amber" && "border-tone-amber-line bg-tone-amber-soft text-tone-amber-text",
        activo && tone === "red" && "border-tone-red-line bg-tone-red-soft text-tone-red-text",
        (!activo || !tone) && "border-line bg-paper text-ink-soft",
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={2} />
      {label}
      <span className="font-semibold tabular-nums">{fmtNumber(value)}</span>
    </span>
  );
}
