"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Segmented, Skeleton } from "@/components/ui/misc";

const SalesChart = dynamic(
  () => import("@/components/inicio/sales-chart").then((m) => m.SalesChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-40 w-full rounded-xl md:h-44" />,
  },
);

export type ChartPoint = { label: string; mine: number; agency: number };

type Tab = "ventas" | "equipo" | "pauta";

/**
 * Una sola card con tabs: Ventas (chart) / Equipo (ranking, solo admin) / Pauta.
 * El contenido de Equipo y Pauta llega server-rendered como slots.
 */
export function InsightsCard({
  chart,
  currency,
  chartMixed,
  compare,
  equipoSlot,
  pautaSlot,
}: {
  chart: ChartPoint[];
  /** moneda dominante del período */
  currency: string;
  /** true si hay files en otra moneda dentro del período del chart */
  chartMixed: boolean;
  /** vendedores: muestra la serie propia contra la de la agencia */
  compare: boolean;
  /** ranking del mes (solo admin, server-rendered) */
  equipoSlot?: React.ReactNode;
  /** tabla de campañas (server-rendered) */
  pautaSlot: React.ReactNode;
}) {
  const [tab, setTab] = React.useState<Tab>("ventas");

  const options: { value: Tab; label: string }[] = equipoSlot
    ? [
        { value: "ventas", label: "Ventas" },
        { value: "equipo", label: "Equipo" },
        { value: "pauta", label: "Pauta" },
      ]
    : [
        { value: "ventas", label: "Ventas" },
        { value: "pauta", label: "Pauta" },
      ];

  const title =
    tab === "ventas"
      ? `Ventas · últimos 6 meses${chartMixed ? ` · solo ${currency}` : ""}`
      : tab === "equipo"
        ? "Ranking del mes"
        : "Campañas del mes";

  return (
    <section className="card flex flex-col p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink-soft">{title}</p>
        <Segmented value={tab} onChange={setTab} options={options} />
      </div>

      <div className="mt-3 min-h-0 flex-1">
        {tab === "ventas" && (
          <div className="animate-fade-in">
            <SalesChart data={chart} currency={currency} compare={compare} />
            {compare && (
              <div className="mt-2 flex items-center gap-4 text-[11px] text-ink-faint">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-brand-500" />
                  Mis ventas
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-ink-faint/50" />
                  Agencia
                </span>
              </div>
            )}
          </div>
        )}
        {tab === "equipo" && equipoSlot && (
          <div className="animate-fade-in">{equipoSlot}</div>
        )}
        {tab === "pauta" && <div className="animate-fade-in">{pautaSlot}</div>}
      </div>
    </section>
  );
}
