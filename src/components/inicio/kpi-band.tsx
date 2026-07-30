"use client";

import * as React from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { AnimatedNumber, Segmented } from "@/components/ui/misc";
import { moneyEntries, type MoneyByCurrency } from "@/components/inicio/money-multi";

export type MonthStats = {
  sales: MoneyByCurrency;
  prevSales: MoneyByCurrency;
  utility: MoneyByCurrency;
  collected: MoneyByCurrency;
  receivable: MoneyByCurrency;
  filesCount: number;
};

/**
 * Banda de KPIs del mes: 4 stats compactas en una fila.
 * Los números cuentan al entrar (AnimatedNumber from=0) y re-animan al
 * togglear Míos/Agencia (solo no-admins).
 */
export function KpiBand({
  showToggle,
  mineStats,
  agencyStats,
  currency,
  currencyKnown,
}: {
  /** true para vendedores: pueden alternar Míos / Agencia */
  showToggle: boolean;
  mineStats: MonthStats | null;
  agencyStats: MonthStats;
  /** moneda dominante del mes */
  currency: string;
  /** false sin ningún file cargado: mostramos el 0 pelado en vez de inventarle moneda */
  currencyKnown: boolean;
}) {
  const [scope, setScope] = React.useState<"mine" | "agency">(
    showToggle && mineStats ? "mine" : "agency",
  );
  const stats = scope === "mine" && mineStats ? mineStats : agencyStats;

  const sales = stats.sales[currency] ?? 0;
  const prevSales = stats.prevSales[currency] ?? 0;
  const delta = prevSales > 0 ? Math.round(((sales - prevSales) / prevSales) * 100) : null;

  return (
    <section aria-label="Resumen del mes">
      {showToggle && mineStats && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-ink-soft">Tu mes</p>
          <Segmented
            value={scope}
            onChange={setScope}
            options={[
              { value: "mine", label: "Míos" },
              { value: "agency", label: "Agencia" },
            ]}
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:gap-3 stagger-children">
        <KpiTile
          label="Ventas del mes"
          amounts={stats.sales}
          currency={currency}
          currencyKnown={currencyKnown}
          extra={
            delta !== null ? (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums",
                  delta >= 0 ? "text-tone-emerald-text" : "text-tone-red-text",
                )}
              >
                {delta >= 0 ? (
                  <TrendingUp className="size-3.5" strokeWidth={2} />
                ) : (
                  <TrendingDown className="size-3.5" strokeWidth={2} />
                )}
                {Math.abs(delta)}%
              </span>
            ) : undefined
          }
        />
        <KpiTile
          label="Utilidad"
          amounts={stats.utility}
          currency={currency}
          currencyKnown={currencyKnown}
        />
        <KpiTile
          label="Cobrado"
          amounts={stats.collected}
          currency={currency}
          currencyKnown={currencyKnown}
          valueClassName="text-money-text"
        />
        <KpiTile
          label="Por cobrar"
          amounts={stats.receivable}
          currency={currency}
          currencyKnown={currencyKnown}
        />
      </div>
    </section>
  );
}

function KpiTile({
  label,
  amounts,
  currency,
  currencyKnown,
  extra,
  valueClassName,
}: {
  label: string;
  amounts: MoneyByCurrency;
  currency: string;
  currencyKnown: boolean;
  extra?: React.ReactNode;
  valueClassName?: string;
}) {
  const primary = amounts[currency] ?? 0;
  const rest = moneyEntries(amounts, currency).filter(([c]) => c !== currency);

  return (
    <div className="card px-3.5 py-3 md:px-4">
      <p className="text-xs text-ink-soft">{label}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <AnimatedNumber
          value={primary}
          from={0}
          format={(n) =>
            currencyKnown ? fmtMoney(Math.round(n), currency) : fmtNumber(Math.round(n))
          }
          className={cn(
            "min-w-0 text-lg font-semibold leading-none text-ink md:text-xl",
            valueClassName,
          )}
        />
        {extra}
      </div>
      {rest.length > 0 && (
        <p className="mt-1 truncate text-[11px] font-medium tabular-nums text-ink-faint">
          {rest.map(([c, v]) => `+ ${fmtMoney(v, c)}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
