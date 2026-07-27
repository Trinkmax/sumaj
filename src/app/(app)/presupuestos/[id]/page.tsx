import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Clock, Trophy, XCircle } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { QuoteSheet, type QuoteSheetData } from "@/components/quotes/quote-sheet";
import { TotalsPanel } from "@/components/quotes/quote-builder";
import { QuoteDetailActions } from "@/components/quotes/quote-detail-actions";
import {
  computeOptionTotals,
  computeQuoteTotals,
  DEFAULT_SELLER_MARKUP_PCT,
  paxLabel,
  QUOTE_STATUSES,
  SERVICE_TYPES,
  type QuoteItemInput,
  type QuotePax,
} from "@/lib/domain";
import { fmtDate, fmtMoney, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AgencySettings, QuoteTheme } from "@/lib/types";

export const metadata = { title: "Presupuesto" };

export default async function PresupuestoDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { member, agency, isAdmin } = await requireMember();
  const supabase = await createClient();

  const { data: quote } = await supabase
    .from("quotes")
    .select(
      "*, items:quote_items(*, supplier:suppliers(name)), options:quote_options!quote_options_quote_id_fkey(*), contact:contacts(id, full_name, phone), creator:members!quotes_created_by_fkey(display_name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!quote) notFound();

  const items = [...quote.items].sort((a, b) => a.position - b.position);
  const options = [...(quote.options ?? [])].sort((a, b) => a.position - b.position);

  const pax: QuotePax = {
    adults: quote.pax_adults || Math.max(1, quote.pax),
    children: quote.pax_children,
    infants: quote.pax_infants,
    childrenAges: Array.isArray(quote.children_ages)
      ? (quote.children_ages as number[]).map((a) => Number(a) || 0)
      : [],
  };

  const toInput = (i: (typeof items)[number]): QuoteItemInput => ({
    type: i.type,
    cost: Number(i.cost),
    gross: i.gross != null ? Number(i.gross) : Number(i.cost),
    commission_pct: Number(i.commission_pct),
  });

  const calc = {
    markup_type: quote.markup_type === "porcentaje" ? ("porcentaje" as const) : ("monto" as const),
    markup_value: Number(quote.markup_value),
    discount: Number(quote.discount),
    pax,
  };

  const commonItems = items.filter((i) => !i.option_id);
  const totals = computeQuoteTotals({ ...calc, items: commonItems.map(toInput) });

  const optionTotals = computeOptionTotals(
    commonItems.map(toInput),
    options.map((o) => ({
      key: o.id,
      name: o.name,
      subtitle: o.subtitle,
      isRecommended: o.is_recommended,
      items: items.filter((i) => i.option_id === o.id).map(toInput),
    })),
    calc,
  );

  const headline =
    optionTotals.find((o) => o.isRecommended)?.totals ?? optionTotals[0]?.totals ?? totals;

  const settings = agency.settings as unknown as Partial<AgencySettings>;

  const sheetData: QuoteSheetData = {
    code: quote.code,
    title: quote.title,
    destination: quote.destination,
    currency: quote.currency,
    pax,
    nights: quote.nights,
    tripDateFrom: quote.trip_date_from,
    tripDateTo: quote.trip_date_to,
    validUntil: quote.valid_until,
    totalPrice: headline.totalPrice,
    perPerson: headline.perPerson,
    perInfant: headline.perInfant,
    discount: headline.discount,
    notes: quote.notes,
    createdAt: quote.created_at,
    contactName: quote.contact?.full_name ?? null,
    contactPhone: quote.contact?.phone ?? null,
    agencyName: agency.name,
    agencyLogoUrl: agency.logo_url,
    agencyPhone: agency.phone,
    sellerName: quote.creator?.display_name ?? member.display_name,
    items: commonItems.map((i) => ({ type: i.type, description: i.description })),
    options: optionTotals.map((o) => ({
      name: o.name,
      subtitle: o.subtitle,
      isRecommended: o.isRecommended,
      totalPrice: o.totals.totalPrice,
      perPerson: o.totals.perPerson,
      perInfant: o.totals.perInfant,
      items: items
        .filter((i) => i.option_id === o.key)
        .map((i) => ({ type: i.type, description: i.description })),
    })),
    theme: (quote.theme ?? {}) as QuoteTheme,
  };

  const statusMeta = QUOTE_STATUSES[quote.status];
  const StatusIcon = statusMeta.icon;
  const isOpen = quote.status !== "aceptado" && quote.status !== "rechazado";
  const expired =
    !!quote.valid_until &&
    isOpen &&
    new Date(quote.valid_until + "T23:59:59").getTime() < Date.now();

  /** filas del detalle interno agrupadas: comunes primero, después cada opción */
  const internalGroups = [
    { key: "common", label: null as string | null, rows: commonItems },
    ...options.map((o) => ({
      key: o.id,
      label: o.name,
      rows: items.filter((i) => i.option_id === o.id),
    })),
  ].filter((g) => g.rows.length > 0);

  return (
    <>
      <PageHeader
        title={quote.title || quote.destination}
        subtitle={`${quote.code} · ${quote.creator?.display_name ?? "—"} · ${fmtRelative(quote.created_at)}`}
        actions={
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
              statusMeta.chip,
            )}
          >
            <StatusIcon className="size-3.5" strokeWidth={2} />
            {statusMeta.label}
          </span>
        }
      />

      <div className="space-y-4 px-4 md:px-6">
        {/* banners de estado */}
        {quote.status === "aceptado" && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-tone-emerald-line bg-tone-emerald-soft px-4 py-3 animate-slide-up">
            <p className="flex items-center gap-2 text-sm font-medium text-tone-emerald-text">
              <Trophy className="size-4 shrink-0" strokeWidth={1.9} />
              Presupuesto aceptado
              {quote.accepted_at ? ` ${fmtRelative(quote.accepted_at)}` : ""}
            </p>
            {quote.file_id && (
              <Link
                href={`/files/${quote.file_id}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-tone-emerald-text underline-offset-2 hover:underline"
              >
                Ver el file <ArrowUpRight className="size-3.5" />
              </Link>
            )}
          </div>
        )}
        {quote.status === "rechazado" && (
          <div className="rounded-2xl border border-tone-red-line bg-tone-red-soft px-4 py-3 animate-slide-up">
            <p className="flex items-center gap-2 text-sm font-medium text-tone-red-text">
              <XCircle className="size-4 shrink-0" strokeWidth={1.9} />
              Este presupuesto fue rechazado. Podés duplicarlo y ajustar la propuesta.
            </p>
          </div>
        )}
        {expired && quote.status !== "rechazado" && (
          <div className="rounded-2xl border border-tone-amber-line bg-tone-amber-soft px-4 py-3 animate-slide-up">
            <p className="flex items-center gap-2 text-sm font-medium text-tone-amber-text">
              <Clock className="size-4 shrink-0" strokeWidth={1.9} />
              Venció el {fmtDate(quote.valid_until)}. Editá la validez o duplicalo para
              reactivarlo.
            </p>
          </div>
        )}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[440px_minmax(0,1fr)]">
          {/* el presupuesto como lo ve el cliente */}
          <div className="animate-slide-up">
            <p className="mb-2 text-center text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Así lo ve tu cliente
            </p>
            <QuoteSheet data={sheetData} />
          </div>

          {/* panel interno */}
          <div className="min-w-0 space-y-4 animate-fade-in">
            <QuoteDetailActions
              quoteId={quote.id}
              code={quote.code}
              status={quote.status}
              fileId={quote.file_id}
              publicToken={quote.public_token}
              contactName={quote.contact?.full_name ?? null}
              contactPhone={quote.contact?.phone ?? null}
              currency={quote.currency}
              options={optionTotals.map((o) => ({
                id: o.key,
                name: o.name,
                subtitle: o.subtitle,
                isRecommended: o.isRecommended,
                perPerson: o.totals.perPerson,
                totalPrice: o.totals.totalPrice,
              }))}
              acceptedOptionId={quote.accepted_option_id}
            />

            {/* meta */}
            <div className="card p-4 sm:p-5">
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-ink-faint">Cliente</dt>
                  <dd className="mt-0.5 truncate font-medium text-ink">
                    {quote.contact ? (
                      <Link
                        href={`/clientes/${quote.contact.id}`}
                        className="hover:underline"
                      >
                        {quote.contact.full_name}
                      </Link>
                    ) : (
                      "Sin contacto"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-faint">Enviado</dt>
                  <dd className="mt-0.5 font-medium text-ink">
                    {quote.sent_at ? fmtRelative(quote.sent_at) : "Todavía no"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-faint">Validez</dt>
                  <dd
                    className={cn(
                      "mt-0.5 font-medium",
                      expired ? "text-tone-red-text" : "text-ink",
                    )}
                  >
                    {quote.valid_until
                      ? `${expired ? "venció " : ""}${fmtDate(quote.valid_until)}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-faint">Pasajeros</dt>
                  <dd className="mt-0.5 font-medium text-ink">
                    {paxLabel(pax)} · {quote.currency}
                  </dd>
                </div>
              </dl>
            </div>

            {/* tabla interna de ítems (con costos, solo para la agencia) */}
            <div className="card overflow-hidden">
              <p className="px-4 pt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-faint sm:px-5">
                Detalle interno
              </p>
              <div className="overflow-x-auto">
                <table className="mt-2 w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                      <th className="px-4 py-2 font-medium sm:px-5">Servicio</th>
                      <th className="px-3 py-2 text-right font-medium">Bruto</th>
                      <th className="px-3 py-2 text-right font-medium">Final</th>
                      {isAdmin && <th className="px-3 py-2 text-right font-medium">%</th>}
                      {isAdmin && (
                        <th className="px-4 py-2 text-right font-medium sm:px-5">Comisión</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {internalGroups.map((g) => (
                      <Fragment key={g.key}>
                        {g.label && (
                          <tr className="border-b border-line/60">
                            <td
                              colSpan={isAdmin ? 5 : 3}
                              className="bg-sand-soft/50 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft sm:px-5"
                            >
                              {g.label}
                            </td>
                          </tr>
                        )}
                        {g.rows.map((i) => {
                          const gross = i.gross != null ? Number(i.gross) : Number(i.cost);
                          const commission = (gross * Number(i.commission_pct)) / 100;
                          const TypeIcon = SERVICE_TYPES[i.type].icon;
                          return (
                            <tr key={i.id} className="border-b border-line/60 last:border-0">
                              <td className="px-4 py-2.5 sm:px-5">
                                <div className="flex items-start gap-2">
                                  <TypeIcon
                                    className="mt-0.5 size-4 shrink-0 text-ink-faint"
                                    strokeWidth={1.75}
                                    aria-label={SERVICE_TYPES[i.type].label}
                                  />
                                  <div className="min-w-0">
                                    <p className="font-medium text-ink">{i.description}</p>
                                    {i.supplier && (
                                      <p className="text-xs text-ink-faint">
                                        {i.supplier.name}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">
                                {fmtMoney(gross, quote.currency)}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                                {fmtMoney(Number(i.cost), quote.currency)}
                              </td>
                              {isAdmin && (
                                <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">
                                  {Number(i.commission_pct)}%
                                </td>
                              )}
                              {isAdmin && (
                                <td className="px-4 py-2.5 text-right tabular-nums text-money-700 sm:px-5">
                                  {fmtMoney(commission, quote.currency)}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* totales + comisión */}
            <TotalsPanel
              totals={totals}
              options={optionTotals}
              currency={quote.currency}
              pax={pax}
              isAdmin={isAdmin}
              sellerCommissionPct={
                settings.quote_seller_commission_pct ?? DEFAULT_SELLER_MARKUP_PCT
              }
            />

            {/* notas internas */}
            {quote.internal_notes && (
              <div className="card p-4 sm:p-5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  Notas internas
                </p>
                <p className="mt-1.5 whitespace-pre-line text-sm text-ink-soft">
                  {quote.internal_notes}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
