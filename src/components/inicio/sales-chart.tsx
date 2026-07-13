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

type Point = { label: string; value: number };

export function SalesChart({ data, currency }: { data: Point[]; currency: string }) {
  return (
    <div className="h-44 w-full md:h-48">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e8e2d8" vertical={false} />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "#8a8177" }}
            dy={6}
          />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: "#f3efe7", opacity: 0.6 }}
            content={<ChartTip currency={currency} />}
          />
          <Bar
            dataKey="value"
            fill="#d96c2e"
            radius={[6, 6, 0, 0]}
            maxBarSize={34}
            isAnimationActive
            animationDuration={400}
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
  payload?: { value?: number | string }[];
  label?: string;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-paper px-3 py-2 shadow-md shadow-ink/5">
      <p className="text-[11px] capitalize text-ink-faint">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-ink">
        {fmtMoney(Number(payload[0].value ?? 0), currency)}
      </p>
    </div>
  );
}
