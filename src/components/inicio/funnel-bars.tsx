"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type FunnelRow = {
  key: string;
  label: string;
  count: number;
  /** clase del punto de color (viene de STAGES.dot) */
  dot: string;
  /** clase de la barra (viene de STAGES.headerBar) */
  bar: string;
};

/** Mini embudo con barras que crecen al montar (0 → ancho real). */
export function FunnelBars({ rows }: { rows: FunnelRow[] }) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2">
          <span className={cn("size-1.5 shrink-0 rounded-full", r.dot)} />
          <span className="w-24 shrink-0 truncate text-xs text-ink-soft">{r.label}</span>
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sand-soft">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-700 ease-out",
                r.bar,
              )}
              style={{
                width:
                  mounted && r.count > 0
                    ? `${Math.max((r.count / max) * 100, 6)}%`
                    : "0%",
              }}
            />
          </div>
          <span className="w-5 shrink-0 text-right text-[13px] font-semibold tabular-nums text-ink">
            {r.count}
          </span>
        </div>
      ))}
    </div>
  );
}
