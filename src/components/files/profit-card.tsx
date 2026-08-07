"use client";

import * as React from "react";
import { HandCoins, Info, Lock, Pencil, TrendingDown, TrendingUp } from "lucide-react";
import { EmptyState, Tooltip } from "@/components/ui/misc";
import {
  COMMISSION_TYPES,
  computeFileProfit,
  serviceSupplierCommission,
  SERVICE_TYPES,
} from "@/lib/domain";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CommissionDialog } from "./commission-dialog";
import { MarkupDialog } from "./markup-dialog";
import type { ServiceRow } from "./types";

/**
 * Lo que gana la agencia con una venta. SOLO admin (socios).
 *
 * El vendedor ve "utilidad" = venta − costo, que en la práctica es el markup.
 * Esa no es la plata que entra: la comisión del mayorista —que suele ser diez
 * veces el markup— la devuelve el proveedor y no aparece por ningún lado en
 * precio − costo. Esta tarjeta suma las tres partes y descuenta al vendedor.
 */
export function ProfitCard({
  fileId,
  currency,
  sellerName,
  services,
  markup,
  discount,
  commissionType,
  commissionPct,
  commissionAmount,
  commissionLabel,
  className,
}: {
  fileId: string;
  currency: string;
  sellerName: string;
  services: ServiceRow[];
  markup: number;
  discount: number;
  commissionType: string;
  commissionPct: number;
  commissionAmount: number;
  commissionLabel: string | null;
  className?: string;
}) {
  const [markupOpen, setMarkupOpen] = React.useState(false);
  const [commissionOpen, setCommissionOpen] = React.useState(false);

  const profit = React.useMemo(
    () =>
      computeFileProfit({
        services,
        markup,
        discount,
        commission_type: commissionType,
        commission_pct: commissionPct,
        commission_amount: commissionAmount,
      }),
    [services, markup, discount, commissionType, commissionPct, commissionAmount],
  );

  /* servicios que devuelven comisión, del que más aporta al que menos */
  const withCommission = React.useMemo(
    () =>
      services
        .map((s) => ({ service: s, amount: serviceSupplierCommission(s) }))
        .filter((r) => r.amount > 0.004)
        .sort((a, b) => b.amount - a.amount),
    [services],
  );

  /* Avisamos solo cuando falta plata, no cuando falta un campo: un hotel
     reservado directo no tiene mayorista y su bruto vacío es correcto. El caso
     real es "elegí el proveedor (y su % se precargó) pero no cargué el bruto". */
  const missingGross = services.filter((s) => s.gross == null && s.commission_pct > 0).length;

  const isFixed = commissionType === "monto_fijo";
  const negative = profit.netProfit < 0;
  const Trend = negative ? TrendingDown : TrendingUp;

  const header = (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="font-display text-lg font-semibold text-ink">Rentabilidad</h2>
      <Tooltip content="Esta tarjeta no la ven los vendedores">
        <span className="inline-flex min-h-6 shrink-0 items-center gap-1 rounded-full border border-line bg-sand-soft px-2 text-[11px] font-medium text-ink-faint">
          <Lock className="size-3" strokeWidth={2} />
          Solo socios
        </span>
      </Tooltip>
    </div>
  );

  /* venta recién creada: una pared de ceros no dice nada, decimos qué falta */
  if (services.length === 0) {
    return (
      <section className={cn("card animate-slide-up p-4 md:p-5", className)}>
        {header}
        <EmptyState
          icon={HandCoins}
          title="Todavía no hay números"
          description="Cargá los servicios con su bruto y el % del mayorista, y acá vas a ver cuánto deja la venta."
        />
      </section>
    );
  }

  return (
    <section className={cn("card animate-slide-up p-4 md:p-5", className)}>
      {header}

      {/* el número con el que se decide: lo que queda después de pagar todo */}
      <div
        className={cn(
          "rounded-2xl px-4 py-3.5",
          negative ? "bg-tone-red-soft" : "bg-money-tint",
        )}
      >
        <p
          className={cn(
            "text-[13px] font-medium",
            negative ? "text-tone-red-text" : "text-money-text/80",
          )}
        >
          {negative ? "Esta venta pierde plata" : "Le queda a la agencia"}
        </p>
        <p
          className={cn(
            "mt-0.5 font-display text-[32px] font-bold leading-none tracking-tight tabular-nums md:text-[36px]",
            negative ? "text-tone-red-text" : "text-money-text",
          )}
        >
          {fmtMoney(profit.netProfit, currency)}
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-faint">
          <Trend className="size-3.5 shrink-0" strokeWidth={2} />
          <span className="tabular-nums">{fmtNumber(profit.marginPct, 1)}% de la venta</span>
          <span>· sobre {fmtMoney(profit.totalSale, currency)}</span>
        </p>
      </div>

      {/* la cuenta, para poder auditarla de un vistazo */}
      <div className="mt-3 space-y-1.5 rounded-xl bg-sand-soft/60 p-3.5">
        <Line
          label="Comisión del mayorista"
          sign="+"
          amount={profit.supplierCommission}
          currency={currency}
        />
        <Line
          label="Markup del paquete"
          sign="+"
          amount={profit.markup}
          currency={currency}
          onEdit={() => setMarkupOpen(true)}
        />
        {Math.abs(profit.priceAdjustment) > 0.004 && (
          <Line
            label="Sobreprecio de servicios"
            sign={profit.priceAdjustment < 0 ? "−" : "+"}
            amount={Math.abs(profit.priceAdjustment)}
            currency={currency}
          />
        )}
        {profit.discount > 0.004 && (
          <Line
            label="Descuento al cliente"
            sign="−"
            amount={profit.discount}
            currency={currency}
            onEdit={() => setMarkupOpen(true)}
          />
        )}

        <div className="flex items-center justify-between border-t border-line pt-1.5 text-sm">
          <span className="font-medium text-ink">Utilidad bruta</span>
          <span className="font-semibold tabular-nums text-ink">
            {fmtMoney(profit.grossProfit, currency)}
          </span>
        </div>

        <Line
          label={
            `Comisión ${sellerName}` +
            (!isFixed && commissionPct > 0
              ? ` (${fmtNumber(commissionPct, Number.isInteger(commissionPct) ? 0 : 1)}%)`
              : "")
          }
          badge={commissionLabel ?? (isFixed ? COMMISSION_TYPES.monto_fijo.short : null)}
          sign="−"
          amount={profit.sellerCommission}
          currency={currency}
          onEdit={() => setCommissionOpen(true)}
        />

        <div className="flex items-center justify-between border-t border-line pt-1.5">
          <span className="text-sm font-semibold text-ink">Utilidad neta</span>
          <span
            className={cn(
              "text-base font-bold tabular-nums",
              negative ? "text-tone-red-text" : "text-money-text",
            )}
          >
            {fmtMoney(profit.netProfit, currency)}
          </span>
        </div>
      </div>

      {/* de dónde sale la comisión del mayorista, servicio por servicio */}
      {withCommission.length > 0 && (
        <div className="mt-4">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
            <HandCoins className="size-4 text-ink-faint" strokeWidth={1.9} />
            Devuelve el mayorista
          </h3>
          <ul className="mt-1.5 divide-y divide-line/70">
            {withCommission.map(({ service, amount }) => {
              const Icon = SERVICE_TYPES[service.type].icon;
              return (
                <li key={service.id} className="flex items-center gap-2.5 py-2">
                  <Icon className="size-4 shrink-0 text-ink-faint" strokeWidth={1.9} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] leading-snug text-ink">
                      {service.description}
                    </p>
                    <p className="text-[11px] tabular-nums text-ink-faint">
                      {fmtNumber(
                        service.commission_pct,
                        Number.isInteger(service.commission_pct) ? 0 : 1,
                      )}
                      % sobre {fmtMoney(service.gross ?? 0, currency)}
                      {service.supplier_name ? ` · ${service.supplier_name}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums text-money-text">
                    {fmtMoney(amount, currency)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {missingGross > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-tone-amber-line bg-tone-amber-soft px-3 py-2.5 text-[12px] leading-snug text-tone-amber-text">
          <Info className="mt-px size-4 shrink-0" strokeWidth={2} />
          <span>
            {missingGross === 1
              ? "Hay un servicio sin bruto cargado: su comisión del mayorista no está sumada acá."
              : `Hay ${missingGross} servicios sin bruto cargado: sus comisiones del mayorista no están sumadas acá.`}{" "}
            Cargá el bruto comisionable desde Servicios y el número se completa solo.
          </span>
        </p>
      )}

      {markupOpen && (
        <MarkupDialog
          fileId={fileId}
          currency={currency}
          totalCost={profit.totalCost}
          servicesSale={profit.servicesSale}
          markup={markup}
          discount={discount}
          open
          onOpenChange={setMarkupOpen}
        />
      )}

      {commissionOpen && (
        <CommissionDialog
          fileId={fileId}
          currency={currency}
          sellerName={sellerName}
          utility={profit.utility}
          commissionType={commissionType}
          commissionPct={commissionPct}
          commissionAmount={commissionAmount}
          commissionLabel={commissionLabel}
          open
          onOpenChange={setCommissionOpen}
        />
      )}
    </section>
  );
}

/** una línea de la cuenta; con `onEdit` se vuelve un target táctil de 44px */
function Line({
  label,
  badge,
  sign,
  amount,
  currency,
  onEdit,
}: {
  label: string;
  badge?: string | null;
  sign: "+" | "−";
  amount: number;
  currency: string;
  onEdit?: () => void;
}) {
  const content = (
    <>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] text-ink-soft">
        <span className="truncate">{label}</span>
        {badge && (
          <span className="rounded-full border border-brand-tint-line bg-brand-tint px-1.5 py-0.5 text-[10px] font-medium leading-tight text-brand-text">
            {badge}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
        <span className="text-ink-faint">{sign}</span>
        <span className="text-[13px] font-medium text-ink-soft">
          {fmtMoney(amount, currency)}
        </span>
        {onEdit && <Pencil className="size-3.5 text-ink-faint" strokeWidth={2} />}
      </span>
    </>
  );

  if (!onEdit) {
    return <div className="flex items-center justify-between gap-2">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`Editar ${label}`}
      className="-mx-1.5 flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-1.5 text-left transition-colors hover:bg-sand-deep/50 tap-highlight-none"
    >
      {content}
    </button>
  );
}
