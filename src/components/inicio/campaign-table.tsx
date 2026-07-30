import { Megaphone } from "lucide-react";

export type CampaignRow = {
  name: string;
  leads: number;
  quoted: number;
  won: number;
  /** conversión ganados/leads, 0–100 */
  conv: number;
};

/** Rendimiento por campaña del mes. Se renderiza como slot dentro de InsightsCard. */
export function CampaignTable({ rows }: { rows: CampaignRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <div className="flex size-11 items-center justify-center rounded-full bg-sand-soft text-ink-faint ring-4 ring-sand-soft/40">
          <Megaphone className="size-5" strokeWidth={1.75} />
        </div>
        <p className="font-medium text-ink">Sin campañas este mes</p>
        <p className="max-w-xs text-sm text-ink-faint">
          Acá se agrupan los leads del mes por su origen: los que entran desde un anuncio traen
          el nombre del aviso, el resto queda agrupado por canal.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="grid grid-cols-[minmax(0,1fr)_2.6rem_2.6rem_3.2rem_3.6rem] items-center gap-x-2 border-b border-line bg-sand-soft/50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint md:gap-x-3">
        <span>Campaña</span>
        <span className="text-right">Leads</span>
        <span className="text-right">Ppto.</span>
        <span className="text-right">Ganados</span>
        <span className="text-right">Conv.</span>
      </div>
      <div className="divide-y divide-line stagger-children">
        {rows.map((r) => (
          <div
            key={r.name}
            className="grid grid-cols-[minmax(0,1fr)_2.6rem_2.6rem_3.2rem_3.6rem] items-center gap-x-2 px-3 py-2.5 md:gap-x-3"
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
  );
}
