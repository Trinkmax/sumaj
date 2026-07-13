import { Avatar } from "@/components/ui/avatar";
import { MoneyMulti, type MoneyByCurrency } from "@/components/inicio/money-multi";

export type RankingRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
  total: MoneyByCurrency;
  count: number;
};

export function SellerRanking({ rows, currency }: { rows: RankingRow[]; currency: string }) {
  const max = Math.max(...rows.map((r) => r.total[currency] ?? 0), 1);

  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-ink-soft">Ranking del mes</p>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-ink-faint">
          Todavía no hay ventas este mes. La primera se lleva el 🏆.
        </p>
      ) : (
        <ul className="mt-3 space-y-3.5">
          {rows.map((r, i) => (
            <li key={r.id}>
              <div className="flex items-center gap-2.5">
                <Avatar name={r.name} src={r.avatarUrl} className="size-8 text-[11px]" />
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {i === 0 && <span className="mr-1">🏆</span>}
                  {r.name}
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
      )}
    </div>
  );
}
