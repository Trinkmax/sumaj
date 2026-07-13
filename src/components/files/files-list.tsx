"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Segmented, EmptyState, Tooltip } from "@/components/ui/misc";
import { fmtDate, fmtMoney } from "@/lib/format";
import { FILE_STATUSES } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { FileStatus } from "@/lib/types";
import {
  addMoney,
  departureBadge,
  daysUntil,
  moneyLines,
  type MoneyByCurrency,
} from "./helpers";
import type { FileListRow } from "./types";

type StatusFilter = "todos" | FileStatus;
type OwnerFilter = "mios" | "todos";

export function FilesList({
  rows,
  memberId,
  isAdmin,
}: {
  rows: FileListRow[];
  memberId: string;
  isAdmin: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("todos");
  const [owner, setOwner] = React.useState<OwnerFilter>(isAdmin ? "todos" : "mios");

  const byOwner = React.useMemo(
    () => (owner === "mios" ? rows.filter((r) => r.seller_id === memberId) : rows),
    [rows, owner, memberId],
  );

  const stats = React.useMemo(() => computeStats(byOwner), [byOwner]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return byOwner.filter((r) => {
      if (status !== "todos" && r.status !== status) return false;
      if (!q) return true;
      return (
        r.contact_name.toLowerCase().includes(q) ||
        r.destination.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q)
      );
    });
  }, [byOwner, query, status]);

  if (rows.length === 0) {
    return (
      <EmptyState
        emoji="🧳"
        title="Todavía no hay files"
        description="Las ventas nacen del CRM al ganar un lead, o cargá una directa con el botón de arriba."
      />
    );
  }

  return (
    <div className="animate-slide-up space-y-3">
      <StatTiles stats={stats} />

      {/* búsqueda */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por cliente, destino o código…"
          className="pl-10"
          type="search"
        />
      </div>

      {/* filtros */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="-mx-4 max-w-full overflow-x-auto scrollbar-none px-4 md:mx-0 md:px-0">
          <Segmented<StatusFilter>
            value={status}
            onChange={setStatus}
            options={[
              { value: "todos", label: "Todos" },
              ...(Object.entries(FILE_STATUSES) as [FileStatus, { label: string }][]).map(
                ([key, meta]) => ({ value: key as StatusFilter, label: meta.label }),
              ),
            ]}
          />
        </div>

        <Segmented<OwnerFilter>
          value={owner}
          onChange={setOwner}
          options={[
            { value: "mios", label: "Míos" },
            { value: "todos", label: "Todos" },
          ]}
        />
      </div>

      {/* resultados */}
      {filtered.length === 0 ? (
        <EmptyState
          emoji="🔍"
          title="No encontramos files"
          description="Probá con otro nombre o sacá los filtros."
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setQuery("");
                setStatus("todos");
                setOwner("todos");
              }}
            >
              Limpiar búsqueda
            </Button>
          }
        />
      ) : (
        <>
          {/* mobile: cards */}
          <div className="space-y-2 md:hidden">
            {filtered.map((r) => (
              <FileCard key={r.id} row={r} />
            ))}
          </div>

          {/* desktop: tabla */}
          <div className="card hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <FilesTable rows={filtered} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ───────────────────────────── stats ───────────────────────────── */

type Stats = {
  salesMonth: MoneyByCurrency;
  utilityMonth: MoneyByCurrency;
  receivable: MoneyByCurrency;
  upcoming: number;
};

function computeStats(rows: FileListRow[]): Stats {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const salesMonth: MoneyByCurrency = {};
  const utilityMonth: MoneyByCurrency = {};
  const receivable: MoneyByCurrency = {};
  let upcoming = 0;

  for (const r of rows) {
    if (new Date(r.created_at).getTime() >= monthStart && r.status !== "cancelado") {
      addMoney(salesMonth, r.currency, r.total_sale);
      addMoney(utilityMonth, r.currency, r.utility);
    }
    if (r.balance > 0 && r.status !== "cancelado") {
      addMoney(receivable, r.currency, r.balance);
    }
    const days = daysUntil(r.departure_date);
    if (days != null && days >= 0 && days < 30 && r.status !== "cancelado") upcoming++;
  }

  return { salesMonth, utilityMonth, receivable, upcoming };
}

function StatTiles({ stats }: { stats: Stats }) {
  return (
    <div className="grid grid-cols-3 gap-2.5 md:grid-cols-4 md:gap-3">
      <StatTile label="Ventas del mes" lines={moneyLines(stats.salesMonth)} />
      <StatTile
        label="Utilidad del mes"
        lines={moneyLines(stats.utilityMonth)}
        valueClass="text-money-700"
      />
      <StatTile
        label="Por cobrar"
        lines={moneyLines(stats.receivable)}
        valueClass={
          Object.keys(stats.receivable).length > 0 ? "text-amber-700" : "text-money-700"
        }
      />
      <StatTile
        label="Próximas salidas"
        lines={[`${stats.upcoming}`]}
        hint="en 30 días"
        className="hidden md:block"
      />
    </div>
  );
}

function StatTile({
  label,
  lines,
  hint,
  valueClass,
  className,
}: {
  label: string;
  lines: string[];
  hint?: string;
  valueClass?: string;
  className?: string;
}) {
  return (
    <div className={cn("card min-w-0 p-3.5 md:p-4", className)}>
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 truncate text-base font-semibold tabular-nums text-ink md:text-xl",
          valueClass,
        )}
      >
        {lines[0]}
        {hint && (
          <span className="ml-1.5 text-xs font-normal normal-case text-ink-faint">{hint}</span>
        )}
      </p>
      {lines.slice(1).map((l) => (
        <p key={l} className={cn("truncate text-xs font-medium tabular-nums text-ink-soft", valueClass)}>
          {l}
        </p>
      ))}
    </div>
  );
}

/* ───────────────────────────── filas ───────────────────────────── */

function StatusChip({ status }: { status: FileStatus }) {
  const meta = FILE_STATUSES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        meta.chip,
      )}
    >
      {meta.label}
    </span>
  );
}

function SaldoCell({ row }: { row: FileListRow }) {
  if (row.total_sale > 0 && row.balance <= 0) {
    return <span className="text-[13px] font-semibold text-money-700">Saldado</span>;
  }
  if (row.balance > 0) {
    return (
      <span className="text-[13px] font-semibold tabular-nums text-amber-700">
        {fmtMoney(row.balance, row.currency)}
      </span>
    );
  }
  return <span className="text-[13px] text-ink-faint">—</span>;
}

function FileCard({ row }: { row: FileListRow }) {
  const badge = departureBadge(row.departure_date);
  return (
    <Link
      href={`/files/${row.id}`}
      className="card block p-3.5 transition-all tap-highlight-none hover:-translate-y-px hover:border-line-strong hover:shadow-md active:bg-sand-soft/50"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-xs font-semibold text-ink-soft">{row.code}</span>
          <StatusChip status={row.status} />
        </div>
        {badge && (
          <span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
            {badge}
          </span>
        )}
      </div>

      <div className="mt-1.5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-ink">{row.destination}</p>
          <p className="mt-0.5 truncate text-[13px] text-ink-faint">
            {row.contact_name}
            {row.departure_date ? ` · sale ${fmtDate(row.departure_date)}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums text-ink">
            {fmtMoney(row.total_sale, row.currency)}
          </p>
          <SaldoCell row={row} />
        </div>
      </div>
    </Link>
  );
}

function FilesTable({ rows }: { rows: FileListRow[] }) {
  const router = useRouter();
  return (
    <table className="w-full min-w-[760px] text-sm">
      <thead>
        <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          <th className="px-4 py-2.5">File</th>
          <th className="px-3 py-2.5">Cliente</th>
          <th className="px-3 py-2.5">Destino</th>
          <th className="px-3 py-2.5">Salida</th>
          <th className="px-3 py-2.5">Estado</th>
          <th className="px-3 py-2.5 text-right">Venta</th>
          <th className="px-3 py-2.5 text-right">Saldo</th>
          <th className="px-4 py-2.5 text-right">Vendedor</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((r) => {
          const badge = departureBadge(r.departure_date);
          return (
            <tr
              key={r.id}
              onClick={() => router.push(`/files/${r.id}`)}
              className="cursor-pointer transition-colors hover:bg-sand-soft/60"
            >
              <td className="px-4 py-3">
                <span className="font-mono text-xs font-semibold text-ink-soft">{r.code}</span>
              </td>
              <td className="max-w-[180px] truncate px-3 py-3 font-medium text-ink">
                {r.contact_name}
              </td>
              <td className="max-w-[200px] truncate px-3 py-3 text-ink-soft">{r.destination}</td>
              <td className="whitespace-nowrap px-3 py-3 text-ink-soft">
                {r.departure_date ? fmtDate(r.departure_date) : "—"}
                {badge && (
                  <span className="ml-1.5 rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-700">
                    {badge}
                  </span>
                )}
              </td>
              <td className="px-3 py-3">
                <StatusChip status={r.status} />
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-ink">
                {fmtMoney(r.total_sale, r.currency)}
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-right">
                <SaldoCell row={r} />
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end">
                  {r.seller_name ? (
                    <Tooltip content={r.seller_name}>
                      <span>
                        <Avatar name={r.seller_name} className="size-7 text-[10px]" />
                      </span>
                    </Tooltip>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
