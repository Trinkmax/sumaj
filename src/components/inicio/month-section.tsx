"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { Segmented, Skeleton } from "@/components/ui/misc";
import { MoneyMulti, type MoneyByCurrency } from "@/components/inicio/money-multi";

const SalesChart = dynamic(
  () => import("@/components/inicio/sales-chart").then((m) => m.SalesChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-44 w-full rounded-xl md:h-48" />,
  },
);

export type MonthStats = {
  sales: MoneyByCurrency;
  prevSales: MoneyByCurrency;
  utility: MoneyByCurrency;
  collected: MoneyByCurrency;
  receivable: MoneyByCurrency;
  filesCount: number;
};

export type ChartPoint = { label: string; mine: number; agency: number };

export function MonthSection({
  showToggle,
  mineStats,
  agencyStats,
  chart,
  currency,
  chartMixed,
  rankingSlot,
}: {
  /** true para vendedores: pueden alternar Míos / Agencia */
  showToggle: boolean;
  mineStats: MonthStats | null;
  agencyStats: MonthStats;
  chart: ChartPoint[];
  /** moneda dominante del mes */
  currency: string;
  /** true si hay files en otra moneda dentro del período del chart */
  chartMixed: boolean;
  /** ranking de vendedores (solo admin), renderizado del lado server */
  rankingSlot?: React.ReactNode;
}) {
  const [scope, setScope] = React.useState<"mine" | "agency">(
    showToggle && mineStats ? "mine" : "agency",
  );
  const stats = scope === "mine" && mineStats ? mineStats : agencyStats;
  const chartData = chart.map((p) => ({
    label: p.label,
    value: scope === "mine" ? p.mine : p.agency,
  }));

  const sales = stats.sales[currency] ?? 0;
  const prevSales = stats.prevSales[currency] ?? 0;
  const delta = prevSales > 0 ? Math.round(((sales - prevSales) / prevSales) * 100) : null;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          El mes
        </h2>
        {showToggle && mineStats && (
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: "mine", label: "Míos" },
              { value: "agency", label: "Agencia" },
            ]}
          />
        )}
      </div>

      {/* stat tiles */}
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        <StatTile
          label="Ventas del mes"
          value={<MoneyMulti amounts={stats.sales} primary={currency} />}
          extra={
            delta !== null ? (
              <span
                className={cn(
                  "text-[11px] font-semibold tabular-nums",
                  delta >= 0 ? "text-money-700" : "text-red-600",
                )}
              >
                {delta >= 0 ? "↑" : "↓"} {Math.abs(delta)}%
              </span>
            ) : undefined
          }
        />
        <StatTile
          label="Utilidad"
          value={<MoneyMulti amounts={stats.utility} primary={currency} />}
        />
        <StatTile
          label="Cobrado"
          value={<MoneyMulti amounts={stats.collected} primary={currency} />}
          valueClassName="text-money-700"
        />
        <StatTile
          label="Por cobrar (total)"
          value={<MoneyMulti amounts={stats.receivable} primary={currency} />}
        />
      </div>

      {/* gráfico + ranking */}
      <div
        className={cn(
          "mt-3 grid gap-3",
          rankingSlot ? "md:grid-cols-[minmax(0,1fr)_320px]" : "",
        )}
      >
        <div className="card p-4">
          <p className="text-xs font-medium text-ink-soft">
            Ventas · últimos 6 meses
            {chartMixed && ` · solo ${currency}`}
          </p>
          <div className="mt-2">
            <SalesChart data={chartData} currency={currency} />
          </div>
        </div>
        {rankingSlot}
      </div>
    </section>
  );
}

function StatTile({
  label,
  value,
  extra,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  extra?: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="card p-3.5 md:p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <div className="mt-1 flex items-baseline gap-1.5">
        <p
          className={cn(
            "min-w-0 text-lg font-semibold tabular-nums text-ink md:text-xl",
            valueClassName,
          )}
        >
          {value}
        </p>
        {extra}
      </div>
    </div>
  );
}
