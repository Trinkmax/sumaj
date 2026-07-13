"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, ReceiptText, Search, SearchX } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState, Segmented } from "@/components/ui/misc";
import { QUOTE_STATUSES } from "@/lib/domain";
import { fmtDate, fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { QuoteStatus } from "@/lib/types";

export type QuoteListItem = {
  id: string;
  code: string;
  title: string | null;
  destination: string;
  status: QuoteStatus;
  currency: string;
  total_price: number;
  valid_until: string | null;
  created_at: string;
  contact: { full_name: string } | null;
};

type Filter = "todos" | "borrador" | "enviado" | "aceptado" | "vencido";

function isExpired(q: QuoteListItem): boolean {
  if (q.status === "vencido") return true;
  if (!q.valid_until) return false;
  if (q.status === "aceptado" || q.status === "rechazado") return false;
  const [y, m, d] = q.valid_until.split("-").map(Number);
  const end = new Date(y, m - 1, d, 23, 59, 59);
  return end.getTime() < Date.now();
}

function SegLabel({
  status,
  label,
  count,
}: {
  status: QuoteStatus;
  label: string;
  count: number;
}) {
  const Icon = QUOTE_STATUSES[status].icon;
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <Icon className="size-3.5" strokeWidth={1.9} />
      {label}
      {count > 0 && <span className="tabular-nums opacity-60">{count}</span>}
    </span>
  );
}

export function QuotesList({ quotes }: { quotes: QuoteListItem[] }) {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("todos");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return quotes.filter((quote) => {
      if (filter === "vencido") {
        if (!isExpired(quote)) return false;
      } else if (filter !== "todos" && quote.status !== filter) {
        return false;
      }
      if (!q) return true;
      return [quote.code, quote.title ?? "", quote.destination, quote.contact?.full_name ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [quotes, query, filter]);

  const counts = React.useMemo(
    () => ({
      borrador: quotes.filter((q) => q.status === "borrador").length,
      enviado: quotes.filter((q) => q.status === "enviado").length,
      aceptado: quotes.filter((q) => q.status === "aceptado").length,
      vencido: quotes.filter(isExpired).length,
    }),
    [quotes],
  );

  return (
    <div className="px-4 md:px-6">
      {/* búsqueda + filtros por estado */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative lg:max-w-xs lg:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por destino, cliente o código…"
            className="pl-9"
          />
        </div>
        <div className="-mx-4 overflow-x-auto px-4 scrollbar-none lg:mx-0 lg:px-0">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "todos", label: "Todos" },
              {
                value: "borrador",
                label: <SegLabel status="borrador" label="Borradores" count={counts.borrador} />,
              },
              {
                value: "enviado",
                label: <SegLabel status="enviado" label="Enviados" count={counts.enviado} />,
              },
              {
                value: "aceptado",
                label: <SegLabel status="aceptado" label="Aceptados" count={counts.aceptado} />,
              },
              {
                value: "vencido",
                label: <SegLabel status="vencido" label="Vencidos" count={counts.vencido} />,
              },
            ]}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        quotes.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="Armá tu primer presupuesto"
            description="Cotizás en la planilla de siempre y sale un presupuesto lindo para mandar por WhatsApp."
            action={
              <Link href="/presupuestos/nuevo">
                <Button variant="brand">
                  <Plus /> Nuevo presupuesto
                </Button>
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={SearchX}
            title="No encontramos presupuestos"
            description="Probá con otra búsqueda u otro filtro."
          />
        )
      ) : (
        <div className={cn("space-y-2", filtered.length <= 14 ? "stagger-children" : "animate-slide-up")}>
          {filtered.map((q) => {
            const expired = isExpired(q);
            const meta = expired && q.status !== "aceptado" && q.status !== "rechazado"
              ? QUOTE_STATUSES.vencido
              : QUOTE_STATUSES[q.status];
            const StatusIcon = meta.icon;
            return (
              <Link
                key={q.id}
                href={`/presupuestos/${q.id}`}
                className="card card-hover flex items-center gap-3 px-4 py-3 tap-highlight-none sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-faint">
                      {q.code}
                    </span>
                    <p className="truncate text-sm font-semibold text-ink">
                      {q.title || q.destination}
                    </p>
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-ink-faint">
                    {q.contact?.full_name ?? "Sin contacto"}
                    {q.valid_until && (
                      <span className={cn(expired && "font-medium text-tone-red-text")}>
                        {" · "}
                        {expired ? "venció " : "válido hasta "}
                        {fmtDate(q.valid_until)}
                      </span>
                    )}
                    <span className="sm:hidden"> · {fmtDate(q.created_at)}</span>
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-ink">
                    {fmtMoney(q.total_price, q.currency)}
                  </p>
                  <p className="mt-0.5 hidden text-xs text-ink-faint sm:block">
                    {fmtDate(q.created_at)}
                  </p>
                </div>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
                    meta.chip,
                  )}
                >
                  <StatusIcon className="size-3" strokeWidth={2} />
                  <span className="hidden sm:inline">{meta.label}</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
