"use client";

import * as React from "react";
import Link from "next/link";
import { Luggage, PlaneTakeoff, Search, SearchX } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Segmented, EmptyState, Tooltip, AnimatedNumber } from "@/components/ui/misc";
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
        icon={Luggage}
        title="Todavía no hay files"
        description="Las ventas nacen del CRM al ganar un lead, o cargá una directa con el botón de arriba."
      />
    );
  }

  return (
    <div className="animate-slide-up space-y-3">
      <StatTiles stats={stats} ownerFiltered={owner === "mios"} />

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
          icon={SearchX}
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
        <div className={cn("space-y-2", filtered.length <= 14 && "stagger-children")}>
          {filtered.map((r) => (
            <FileRowCard key={r.id} row={r} />
          ))}
        </div>
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

function StatTiles({ stats, ownerFiltered }: { stats: Stats; ownerFiltered: boolean }) {
  const suffix = ownerFiltered ? " · míos" : "";
  return (
    <div className="grid grid-cols-3 gap-2.5 md:grid-cols-4 md:gap-3">
      <StatTile label={`Ventas del mes${suffix}`} lines={moneyLines(stats.salesMonth)} />
      <StatTile
        label={`Utilidad del mes${suffix}`}
        lines={moneyLines(stats.utilityMonth)}
        valueClass="text-money-text"
      />
      <StatTile
        label="Por cobrar"
        lines={moneyLines(stats.receivable)}
        valueClass={
          Object.keys(stats.receivable).length > 0 ? "text-tone-amber-text" : "text-money-text"
        }
      />
      <div className="card hidden min-w-0 p-3.5 md:block md:p-4">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          Próximas salidas
        </p>
        <p className="mt-1 flex items-baseline gap-1.5 truncate text-base font-semibold tabular-nums text-ink md:text-xl">
          <AnimatedNumber value={stats.upcoming} from={0} />
          <span className="text-xs font-normal text-ink-faint">en 30 días</span>
        </p>
      </div>
    </div>
  );
}

function StatTile({
  label,
  lines,
  valueClass,
  className,
}: {
  label: string;
  lines: string[];
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

function StatusChip({ status, className }: { status: FileStatus; className?: string }) {
  const meta = FILE_STATUSES[status];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        meta.chip,
        className,
      )}
    >
      <Icon className="size-3" strokeWidth={2} />
      {meta.label}
    </span>
  );
}

function DepartureChip({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-tone-sky-line bg-tone-sky-soft px-2 py-0.5 text-[11px] font-medium leading-4 text-tone-sky-text">
      <PlaneTakeoff className="size-3" strokeWidth={2} />
      {label}
    </span>
  );
}

function SaldoCell({ row }: { row: FileListRow }) {
  if (row.total_sale > 0 && row.balance <= 0) {
    return <span className="text-[13px] font-semibold text-money-text">Saldado</span>;
  }
  if (row.balance > 0) {
    return (
      <span className="text-[13px] font-semibold tabular-nums text-tone-amber-text">
        {fmtMoney(row.balance, row.currency)}
      </span>
    );
  }
  return <span className="text-[13px] text-ink-faint">—</span>;
}

function FileRowCard({ row }: { row: FileListRow }) {
  const badge = departureBadge(row.departure_date);
  return (
    <Link
      href={`/files/${row.id}`}
      className="card card-hover block p-3.5 tap-highlight-none active:bg-sand-soft/50 md:px-4 md:py-3"
    >
      {/* mobile: dos líneas */}
      <div className="md:hidden">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-mono text-xs font-semibold text-ink-soft">
              {row.code}
            </span>
            <StatusChip status={row.status} />
          </div>
          {badge && <DepartureChip label={badge} />}
        </div>

        <div className="mt-1.5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-ink">{row.destination}</p>
            <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-faint">
              {row.seller_name && (
                <Avatar name={row.seller_name} className="size-4.5 text-[8px]" />
              )}
              <span className="truncate">
                {row.contact_name}
                {row.departure_date ? ` · sale ${fmtDate(row.departure_date)}` : ""}
              </span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold tabular-nums text-ink">
              {fmtMoney(row.total_sale, row.currency)}
            </p>
            <SaldoCell row={row} />
          </div>
        </div>
      </div>

      {/* desktop: fila-card */}
      <div className="hidden items-center gap-4 md:flex">
        <span className="w-16 shrink-0 font-mono text-xs font-semibold text-ink-soft">
          {row.code}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[15px] font-semibold text-ink">{row.destination}</p>
            {badge && <DepartureChip label={badge} />}
          </div>
          <p className="mt-0.5 truncate text-[13px] text-ink-faint">
            {row.contact_name}
            {row.departure_date ? ` · sale ${fmtDate(row.departure_date)}` : " · fechas a definir"}
          </p>
        </div>

        <StatusChip status={row.status} />

        <div className="w-32 shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums text-ink">
            {fmtMoney(row.total_sale, row.currency)}
          </p>
          <SaldoCell row={row} />
        </div>

        {row.seller_name ? (
          <Tooltip content={row.seller_name}>
            <span className="shrink-0">
              <Avatar name={row.seller_name} className="size-7 text-[10px]" />
            </span>
          </Tooltip>
        ) : (
          <span className="size-7 shrink-0" aria-hidden />
        )}
      </div>
    </Link>
  );
}
