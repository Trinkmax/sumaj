"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtMoney } from "@/lib/format";

export type SalesPoint = { label: string; mine: number; agency: number };

/**
 * BarChart de ventas. Colores SIEMPRE con var(--color-…) para que el tema flipee.
 * compare=true (vendedores): serie propia en brand contra la agencia en gris.
 */
export function SalesChart({
  data,
  currency,
  compare,
}: {
  data: SalesPoint[];
  currency: string;
  compare: boolean;
}) {
  return (
    <div className="h-40 w-full md:h-44">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barGap={3}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" vertical={false} />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "var(--color-ink-faint)" }}
            dy={6}
          />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: "var(--color-sand-soft)", opacity: 0.6 }}
            content={<ChartTip currency={currency} />}
          />
          {compare && (
            <Bar
              dataKey="agency"
              name="Agencia"
              fill="var(--color-ink-faint)"
              fillOpacity={0.35}
              radius={[5, 5, 0, 0]}
              maxBarSize={18}
              isAnimationActive
              animationDuration={400}
            />
          )}
          <Bar
            dataKey={compare ? "mine" : "agency"}
            name={compare ? "Mis ventas" : "Ventas"}
            fill="var(--color-brand-500)"
            radius={[6, 6, 0, 0]}
            maxBarSize={compare ? 18 : 34}
            isAnimationActive
            animationDuration={450}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ChartTip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: { value?: number | string; name?: string; dataKey?: string | number }[];
  label?: string;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-paper px-3 py-2 shadow-md shadow-ink/5">
      <p className="text-[11px] capitalize text-ink-faint">{label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="text-sm font-semibold tabular-nums text-ink">
          {payload.length > 1 && (
            <span className="mr-1.5 text-[11px] font-medium text-ink-soft">{p.name}</span>
          )}
          {fmtMoney(Number(p.value ?? 0), currency)}
        </p>
      ))}
    </div>
  );
}
