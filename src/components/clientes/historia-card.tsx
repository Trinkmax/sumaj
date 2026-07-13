"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Luggage, ReceiptText, Sparkles, type LucideIcon } from "lucide-react";
import { Segmented, EmptyState, AnimatedNumber } from "@/components/ui/misc";
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
  const [tab, setTab] = React.useState<Tab>(files.length > 0 ? "ventas" : "consultas");

  const spentFiles = files.filter((f) => f.status !== "cancelado");
  const totalSpent = sumByCurrency(
    spentFiles.map((f) => ({ currency: f.currency, amount: f.total_sale })),
  );

  return (
    <section className="card animate-fade-in p-4 md:p-5">
      <h2 className="font-display text-lg font-semibold text-ink">Historia</h2>

      {/* resumen */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <SummaryStat
          count={leads.length}
          label={leads.length === 1 ? "consulta" : "consultas"}
        />
        <SummaryStat
          count={spentFiles.length}
          label={spentFiles.length === 1 ? "venta" : "ventas"}
        />
        <SummaryStat
          text={
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
            <Empty
              icon={Sparkles}
              title="Sin consultas todavía"
              description="Creá una desde el botón de arriba y aparece en el CRM."
            />
          ) : (
            <ul className="stagger-children divide-y divide-line">
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
                    <StatusChip chip={stage.chip} icon={stage.icon} label={stage.label} />
                  </HistoryRow>
                );
              })}
            </ul>
          ))}

        {tab === "ventas" &&
          (files.length === 0 ? (
            <Empty
              icon={Luggage}
              title="Sin ventas todavía"
              description="Cuando se gane una consulta, el file aparece acá."
            />
          ) : (
            <ul className="stagger-children divide-y divide-line">
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
                      <StatusChip chip={status.chip} icon={status.icon} label={status.label} />
                    </div>
                  </HistoryRow>
                );
              })}
            </ul>
          ))}

        {tab === "presupuestos" &&
          (quotes.length === 0 ? (
            <Empty
              icon={ReceiptText}
              title="Sin presupuestos todavía"
              description="Armá el primero con «Nuevo presupuesto»."
            />
          ) : (
            <ul className="stagger-children divide-y divide-line">
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
                      <StatusChip chip={status.chip} icon={status.icon} label={status.label} />
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
  count,
  text,
  label,
  money,
}: {
  count?: number;
  text?: string;
  label: string;
  money?: boolean;
}) {
  return (
    <div className="rounded-xl bg-sand-soft/70 px-3 py-2.5 text-center">
      <p
        className={cn(
          "truncate text-base font-semibold tabular-nums md:text-lg",
          money ? "text-money-text" : "text-ink",
        )}
        title={text}
      >
        {count !== undefined ? <AnimatedNumber value={count} from={0} /> : text}
      </p>
      <p className="text-[11px] text-ink-faint">{label}</p>
    </div>
  );
}

function StatusChip({ chip, icon: Icon, label }: { chip: string; icon: LucideIcon; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        chip,
      )}
    >
      <Icon className="size-3" strokeWidth={2} />
      {label}
    </span>
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

function Empty({
  icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  return <EmptyState icon={icon} title={title} description={description} className="py-8" />;
}
