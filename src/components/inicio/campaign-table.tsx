import { EmptyState } from "@/components/ui/misc";

export type CampaignRow = {
  name: string;
  leads: number;
  quoted: number;
  won: number;
  /** conversión ganados/leads, 0–100 */
  conv: number;
};

export function CampaignTable({ rows }: { rows: CampaignRow[] }) {
  return (
    <section className="animate-fade-in">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        La pauta
      </h2>
      <p className="mt-1 text-[13px] text-ink-soft">Rendimiento por campaña este mes</p>

      {rows.length === 0 ? (
        <EmptyState
          emoji="📣"
          title="Sin campañas este mes"
          description="Conectá tus anuncios de Meta para ver el rendimiento acá."
          className="mt-3 py-8"
        />
      ) : (
        <div className="card mt-3 overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_2.6rem_2.6rem_3.2rem_3.6rem] items-center gap-x-2 border-b border-line bg-sand-soft/50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint md:gap-x-3">
            <span>Campaña</span>
            <span className="text-right">Leads</span>
            <span className="text-right">Ppto.</span>
            <span className="text-right">Ganados</span>
            <span className="text-right">Conv.</span>
          </div>
          <div className="divide-y divide-line">
            {rows.map((r) => (
              <div
                key={r.name}
                className="grid grid-cols-[minmax(0,1fr)_2.6rem_2.6rem_3.2rem_3.6rem] items-center gap-x-2 px-4 py-3 md:gap-x-3"
              >
                <p className="truncate text-sm font-medium text-ink">{r.name}</p>
                <p className="text-right text-sm tabular-nums text-ink">{r.leads}</p>
                <p className="text-right text-sm tabular-nums text-ink-soft">{r.quoted}</p>
                <p className="text-right text-sm font-medium tabular-nums text-money-700">
                  {r.won}
                </p>
                <div>
                  <p className="text-right text-sm font-semibold tabular-nums text-ink">
                    {r.conv}%
                  </p>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-sand-soft">
                    <div
                      className="h-full rounded-full bg-money-600"
                      style={{ width: `${Math.min(r.conv, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
