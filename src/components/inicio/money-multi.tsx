import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/format";

/** montos agrupados por moneda: { USD: 1200, ARS: 350000 } */
export type MoneyByCurrency = Record<string, number>;

function currencyOrder(c: string, primary: string): number {
  if (c === primary) return -1;
  return c === "USD" ? 0 : c === "ARS" ? 1 : 2;
}

export function moneyEntries(m: MoneyByCurrency, primary: string): [string, number][] {
  return Object.entries(m)
    .filter(([, v]) => Math.abs(v) > 0.004)
    .sort((a, b) => currencyOrder(a[0], primary) - currencyOrder(b[0], primary));
}

/** monto multimoneda: la moneda principal grande, las demás chicas abajo */
export function MoneyMulti({
  amounts,
  primary,
  className,
}: {
  amounts: MoneyByCurrency;
  /** moneda dominante: va primera y grande */
  primary: string;
  className?: string;
}) {
  const entries = moneyEntries(amounts, primary);
  if (entries.length === 0) {
    return <span className={cn("tabular-nums", className)}>{fmtMoney(0, primary)}</span>;
  }
  const [first, ...rest] = entries;
  return (
    <span className="inline-flex flex-col">
      <span className={cn("tabular-nums", className)}>{fmtMoney(first[1], first[0])}</span>
      {rest.map(([c, v]) => (
        <span key={c} className="text-[11px] font-medium tabular-nums text-ink-faint">
          + {fmtMoney(v, c)}
        </span>
      ))}
    </span>
  );
}
