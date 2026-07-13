"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Segmented, EmptyState } from "@/components/ui/misc";
import { fmtDate, fmtMoney } from "@/lib/format";
import { STAGE_BY_KEY, FILE_STATUSES, QUOTE_STATUSES } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { sumByCurrency, type LeadSummary, type FileSummary, type QuoteSummary } from "./types";

type Tab = "consultas" | "ventas" | "presupuestos";

export function HistoriaCard({
  leads,
  files,
  quotes,
}: {
  leads: LeadSummary[];
  files: FileSummary[];
  quotes: QuoteSummary[];
}) {
  const [tab, setTab] = React.useState<Tab>(
    files.length > 0 ? "ventas" : leads.length > 0 ? "consultas" : "consultas",
  );

  const spentFiles = files.filter((f) => f.status !== "cancelado");
  const totalSpent = sumByCurrency(
    spentFiles.map((f) => ({ currency: f.currency, amount: f.total_sale })),
  );

  return (
    <section className="card animate-fade-in p-4 md:p-5">
      <h2 className="font-display text-lg font-semibold text-ink">Historia</h2>

      {/* resumen */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <SummaryStat value={String(leads.length)} label={leads.length === 1 ? "consulta" : "consultas"} />
        <SummaryStat value={String(spentFiles.length)} label={spentFiles.length === 1 ? "venta" : "ventas"} />
        <SummaryStat
          value={
            totalSpent.length > 0
              ? totalSpent.map(([cur, amt]) => fmtMoney(amt, cur)).join(" · ")
              : fmtMoney(0)
          }
          label="total gastado"
          money
        />
      </div>

      <div className="mt-4">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "consultas", label: `Consultas${leads.length ? ` (${leads.length})` : ""}` },
            { value: "ventas", label: `Ventas${files.length ? ` (${files.length})` : ""}` },
            { value: "presupuestos", label: `Ppto.${quotes.length ? ` (${quotes.length})` : ""}` },
          ]}
        />
      </div>

      <div className="mt-3">
        {tab === "consultas" &&
          (leads.length === 0 ? (
            <Empty emoji="✨" title="Sin consultas todavía" />
          ) : (
            <ul className="divide-y divide-line">
              {leads.map((l) => {
                const stage = STAGE_BY_KEY[l.stage];
                return (
                  <HistoryRow key={l.id} href={`/crm/${l.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {l.destination ?? "Destino a definir"}
                      </p>
                      <p className="text-xs text-ink-faint">{fmtDate(l.created_at)}</p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                        stage.chip,
                      )}
                    >
                      {stage.label}
                    </span>
                  </HistoryRow>
                );
              })}
            </ul>
          ))}

        {tab === "ventas" &&
          (files.length === 0 ? (
            <Empty emoji="🧳" title="Sin ventas todavía" />
          ) : (
            <ul className="divide-y divide-line">
              {files.map((f) => {
                const status = FILE_STATUSES[f.status];
                return (
                  <HistoryRow key={f.id} href={`/files/${f.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        <span className="text-ink-faint">{f.code}</span> · {f.destination}
                      </p>
                      <p className="text-xs text-ink-faint">{fmtDate(f.created_at)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums text-ink">
                        {fmtMoney(f.total_sale, f.currency)}
                      </span>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                          status.chip,
                        )}
                      >
                        {status.label}
                      </span>
                    </div>
                  </HistoryRow>
                );
              })}
            </ul>
          ))}

        {tab === "presupuestos" &&
          (quotes.length === 0 ? (
            <Empty emoji="🧾" title="Sin presupuestos todavía" />
          ) : (
            <ul className="divide-y divide-line">
              {quotes.map((q) => {
                const status = QUOTE_STATUSES[q.status];
                return (
                  <HistoryRow key={q.id} href={`/presupuestos/${q.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        <span className="text-ink-faint">{q.code}</span> · {q.destination}
                      </p>
                      <p className="text-xs text-ink-faint">{fmtDate(q.created_at)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums text-ink">
                        {fmtMoney(q.total_price, q.currency)}
                      </span>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                          status.chip,
                        )}
                      >
                        {status.label}
                      </span>
                    </div>
                  </HistoryRow>
                );
              })}
            </ul>
          ))}
      </div>
    </section>
  );
}

function SummaryStat({
  value,
  label,
  money,
}: {
  value: string;
  label: string;
  money?: boolean;
}) {
  return (
    <div className="rounded-xl bg-sand-soft/70 px-3 py-2.5 text-center">
      <p
        className={cn(
          "truncate text-base font-semibold tabular-nums md:text-lg",
          money ? "text-money-700" : "text-ink",
        )}
        title={value}
      >
        {value}
      </p>
      <p className="text-[11px] text-ink-faint">{label}</p>
    </div>
  );
}

function HistoryRow({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="group flex min-h-12 items-center gap-3 py-2.5 transition-colors tap-highlight-none hover:bg-sand-soft/40"
      >
        {children}
        <ChevronRight className="size-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

function Empty({ emoji, title }: { emoji: string; title: string }) {
  return (
    <EmptyState
      emoji={emoji}
      title={title}
      className="py-8"
    />
  );
}
