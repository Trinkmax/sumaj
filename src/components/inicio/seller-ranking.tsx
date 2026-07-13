import { Trophy } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { MoneyMulti, type MoneyByCurrency } from "@/components/inicio/money-multi";

export type RankingRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
  total: MoneyByCurrency;
  count: number;
};

/** Ranking del mes (solo admin). Se renderiza como slot dentro de InsightsCard. */
export function SellerRanking({ rows, currency }: { rows: RankingRow[]; currency: string }) {
  const max = Math.max(...rows.map((r) => r.total[currency] ?? 0), 1);

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-sand-soft text-ink-faint ring-4 ring-sand-soft/40">
          <Trophy className="size-5" strokeWidth={1.75} />
        </div>
        <p className="max-w-xs text-sm text-ink-faint">
          Todavía no hay ventas este mes. La primera se lleva el trofeo.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3 stagger-children">
      {rows.map((r, i) => (
        <li key={r.id}>
          <div className="flex items-center gap-2.5">
            <Avatar name={r.name} src={r.avatarUrl} className="size-8 text-[11px]" />
            <p className="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm font-medium text-ink">
              {i === 0 && (
                <Trophy
                  className="size-3.5 shrink-0 text-tone-amber-text"
                  strokeWidth={2}
                  aria-label="Primer puesto"
                />
              )}
              <span className="truncate">{r.name}</span>
            </p>
            <div className="shrink-0 text-right">
              <MoneyMulti
                amounts={r.total}
                primary={currency}
                className="text-sm font-semibold text-ink"
              />
              <p className="text-[11px] text-ink-faint">
                {r.count} {r.count === 1 ? "file" : "files"}
              </p>
            </div>
          </div>
          <div className="ml-[42px] mt-1.5 h-1.5 overflow-hidden rounded-full bg-sand-soft">
            <div
              className="h-full rounded-full bg-brand-500"
              style={{ width: `${Math.max(((r.total[currency] ?? 0) / max) * 100, 4)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
