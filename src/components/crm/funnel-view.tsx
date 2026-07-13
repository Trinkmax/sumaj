"use client";

import * as React from "react";
import { ChevronDown, Filter, Trophy, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGES, CHANNELS } from "@/lib/domain";
import { fmtNumber } from "@/lib/format";
import { AnimatedNumber, EmptyState } from "@/components/ui/misc";
import type { LeadStage } from "@/lib/types";
import type { BoardLead } from "./types";

/** nuevo → contactado → presupuestado → negociación → ganado */
const FUNNEL_ORDER: LeadStage[] = STAGES.filter((s) => s.active)
  .map((s) => s.key)
  .concat("ganado");

const RANK: Record<string, number> = Object.fromEntries(FUNNEL_ORDER.map((k, i) => [k, i]));

/** gradiente sutil del tono vivo de cada etapa (400→500 funciona en ambos temas) */
const BAR_GRADIENTS: Record<string, string> = {
  nuevo: "bg-gradient-to-r from-sky-400 to-sky-500",
  contactado: "bg-gradient-to-r from-amber-400 to-amber-500",
  presupuestado: "bg-gradient-to-r from-violet-400 to-violet-500",
  negociacion: "bg-gradient-to-r from-brand-400 to-brand-500",
  ganado: "bg-gradient-to-r from-emerald-400 to-emerald-500",
};

export function FunnelView({ leads }: { leads: BoardLead[] }) {
  // las barras entran animando el width (0 → pct) con stagger
  const [entered, setEntered] = React.useState(false);
  React.useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  if (leads.length === 0) {
    return (
      <div className="px-4 md:px-6">
        <EmptyState
          icon={Filter}
          title="Todavía no hay datos para el embudo"
          description="Cargá leads y movelos por el pipeline para ver la conversión."
        />
      </div>
    );
  }

  // "alcanzó la etapa X" = está en X o más adelante (perdido cuenta solo como nuevo)
  const rankOf = (l: BoardLead) => (l.stage === "perdido" ? 0 : RANK[l.stage] ?? 0);
  const reached = FUNNEL_ORDER.map((_, i) => leads.filter((l) => rankOf(l) >= i).length);
  const total = reached[0] || 1;
  const won = reached[reached.length - 1];
  const lost = leads.filter((l) => l.stage === "perdido").length;
  const totalConversion = Math.round((won / total) * 100);

  // rendimiento por campaña (origin_campaign, o el canal si no hay campaña)
  const byCampaign = new Map<string, { leads: number; won: number }>();
  for (const l of leads) {
    const key = l.origin_campaign ?? CHANNELS[l.origin_channel].label;
    const row = byCampaign.get(key) ?? { leads: 0, won: 0 };
    row.leads += 1;
    if (l.stage === "ganado") row.won += 1;
    byCampaign.set(key, row);
  }
  const campaigns = [...byCampaign.entries()].sort((a, b) => b[1].leads - a[1].leads);

  return (
    <div className="space-y-4 px-4 md:px-6 animate-slide-up">
      {/* embudo de conversión */}
      <div className="card p-4 md:p-6">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Embudo de conversión</h2>
            <p className="text-[13px] text-ink-soft">{fmtNumber(leads.length)} leads en total</p>
          </div>
          <div className="text-right">
            <p className="font-display text-3xl font-semibold tabular-nums text-tone-emerald-text">
              <AnimatedNumber
                value={totalConversion}
                from={0}
                format={(n) => `${Math.round(n)}%`}
              />
            </p>
            <p className="text-[11px] text-ink-faint">conversión total</p>
          </div>
        </div>

        {/* cierres: ganados / perdidos */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-tone-emerald-line bg-tone-emerald-soft px-2.5 py-1 text-[12px] font-semibold tabular-nums text-tone-emerald-text">
            <Trophy className="size-3.5" strokeWidth={2} />
            {won} {won === 1 ? "ganado" : "ganados"}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-tone-stone-line bg-tone-stone-soft px-2.5 py-1 text-[12px] font-semibold tabular-nums text-tone-stone-text">
            <XCircle className="size-3.5" strokeWidth={2} />
            {lost} {lost === 1 ? "perdido" : "perdidos"}
          </span>
        </div>

        <div className="space-y-1">
          {FUNNEL_ORDER.map((stage, i) => {
            const meta = STAGES.find((s) => s.key === stage)!;
            const StageIcon = meta.icon;
            const count = reached[i];
            const pctOfNew = Math.round((count / total) * 100);
            const next = reached[i + 1];
            const stepConversion =
              next != null && count > 0 ? Math.round((next / count) * 100) : null;

            return (
              <div key={stage}>
                <div className="flex items-center gap-3">
                  <div className="w-[110px] shrink-0 md:w-[150px]">
                    <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                      <StageIcon className="size-3.5 shrink-0 text-ink-faint" strokeWidth={2} />
                      <span className="truncate">{meta.label}</span>
                    </p>
                  </div>
                  <div className="relative h-10 min-w-0 flex-1 overflow-hidden rounded-lg bg-sand-soft">
                    <div
                      className={cn(
                        "flex h-full items-center rounded-lg pl-3 shadow-sm",
                        "transition-[width] duration-700 ease-out",
                        BAR_GRADIENTS[stage],
                      )}
                      style={{
                        width: entered ? `${Math.max(pctOfNew, 7)}%` : "0%",
                        transitionDelay: `${i * 90}ms`,
                      }}
                    >
                      <span className="text-[13px] font-semibold tabular-nums text-white drop-shadow-sm">
                        {count}
                      </span>
                    </div>
                  </div>
                  <span className="w-11 shrink-0 text-right text-[12px] tabular-nums text-ink-faint">
                    {pctOfNew}%
                  </span>
                </div>

                {stepConversion != null && (
                  <p className="my-1 flex items-center gap-1 pl-[122px] text-[11px] text-ink-faint md:pl-[162px]">
                    <ChevronDown className="size-3 shrink-0" strokeWidth={2} />
                    {stepConversion}% pasa a{" "}
                    {STAGES.find((s) => s.key === FUNNEL_ORDER[i + 1])!.label.toLowerCase()}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* rendimiento por campaña */}
      <div className="card p-4 md:p-6 animate-fade-in">
        <h2 className="font-display text-lg font-semibold text-ink">Rendimiento por campaña</h2>
        <p className="mb-3 text-[13px] text-ink-soft">De dónde vienen los leads que compran</p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                <th className="pb-2 pr-3 font-semibold">Campaña</th>
                <th className="pb-2 pr-3 text-right font-semibold">Leads</th>
                <th className="pb-2 pr-3 text-right font-semibold">Ganados</th>
                <th className="pb-2 text-right font-semibold">Conversión</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(([name, row]) => {
                const conv = Math.round((row.won / row.leads) * 100);
                return (
                  <tr key={name} className="border-b border-line/60 last:border-0">
                    <td className="max-w-[200px] truncate py-2.5 pr-3 font-medium text-ink">
                      {name}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-ink-soft">
                      {row.leads}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-ink-soft">
                      {row.won > 0 ? (
                        <span className="inline-flex items-center gap-1 font-medium text-tone-emerald-text">
                          <Trophy className="size-3.5" strokeWidth={2} />
                          {row.won}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      <span
                        className={cn(
                          "inline-block rounded-full border px-2 py-0.5 text-[12px] font-semibold tabular-nums",
                          conv >= 25
                            ? "border-tone-emerald-line bg-tone-emerald-soft text-tone-emerald-text"
                            : conv > 0
                              ? "border-tone-amber-line bg-tone-amber-soft text-tone-amber-text"
                              : "border-tone-stone-line bg-tone-stone-soft text-tone-stone-text",
                        )}
                      >
                        {conv}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
