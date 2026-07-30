"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ChartNoAxesColumn } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  // sin un peso vendido el chart es una grilla con seis meses vacíos: prometería datos que no hay
  const emptyChart = chart.every((p) => p.agency === 0 && p.mine === 0);

  const title =
    tab === "ventas"
      ? emptyChart
        ? "Ventas"
        : `Ventas · últimos 6 meses${chartMixed ? ` · solo ${currency}` : ""}`
      : tab === "equipo"
        ? "Ranking del mes"
        : "Campañas del mes";

  return (
    <section className="card flex h-full min-h-[440px] flex-col p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink-soft">{title}</p>
        <Segmented value={tab} onChange={setTab} options={options} />
      </div>

      <div className="mt-3 min-h-0 flex-1">
        {tab === "ventas" &&
          (emptyChart ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center animate-fade-in">
              <div className="flex size-11 items-center justify-center rounded-full bg-sand-soft text-ink-faint ring-4 ring-sand-soft/40">
                <ChartNoAxesColumn className="size-5" strokeWidth={1.75} />
              </div>
              <p className="font-medium text-ink">Todavía no hay ventas</p>
              <p className="max-w-xs text-sm text-ink-faint">
                En cuanto cargues el primer file con sus servicios, acá vas a ver cuánto vendés
                mes a mes.
              </p>
              <Link href="/files" className="mt-2">
                <Button variant="secondary" size="sm">
                  Ir a files
                </Button>
              </Link>
            </div>
          ) : (
            <div className="flex h-full flex-col animate-fade-in">
              <div className="min-h-0 flex-1">
                <SalesChart data={chart} currency={currency} compare={compare} />
              </div>
              {compare && (
                <div className="mt-2 flex shrink-0 items-center gap-4 text-[11px] text-ink-faint">
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
          ))}
        {tab === "equipo" && equipoSlot && (
          <div className="h-full overflow-y-auto pr-1 animate-fade-in">{equipoSlot}</div>
        )}
        {tab === "pauta" && (
          <div className="h-full overflow-y-auto pr-1 animate-fade-in">{pautaSlot}</div>
        )}
      </div>
    </section>
  );
}
