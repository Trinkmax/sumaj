"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowUpFromLine,
  Banknote,
  Calculator,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  HandCoins,
  Hourglass,
  Link2,
  Luggage,
  MessageCircle,
  PartyPopper,
  Plus,
  ReceiptText,
  Shuffle,
  Trash2,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented, EmptyState, Tooltip, AnimatedNumber } from "@/components/ui/misc";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Avatar } from "@/components/ui/avatar";
import { COMMISSION_TYPES, PAYMENT_DIRECTIONS, PAYMENT_METHODS, waLink } from "@/lib/domain";
import { fmtMoney, fmtDate, fmtNumber, daysUntil } from "@/lib/format";
import { deletePayment } from "@/lib/actions/payments";
import type { PaymentDirection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PaymentDialog } from "./payment-dialog";
import { FilePickerDialog } from "./file-picker-dialog";
import { SupplierPaymentDialog } from "./supplier-payment-dialog";
import {
  CommissionPaymentDialog,
  type CommissionPreset,
} from "./commission-payment-dialog";
import type {
  CajaStats,
  CajaTab,
  CommissionRow,
  DebtorFile,
  FileOption,
  Movement,
  MoneyByCurrency,
  PaymentFile,
  SellerOption,
  SupplierOption,
} from "./types";

/* ── helpers ── */

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function currencyOrder(c: string): number {
  return c === "USD" ? 0 : c === "ARS" ? 1 : 2;
}

function moneyEntries(m: MoneyByCurrency): [string, number][] {
  const entries = Object.entries(m).filter(([, v]) => Math.abs(v) > 0.004);
  entries.sort((a, b) => currencyOrder(a[0]) - currencyOrder(b[0]));
  return entries;
}

/** monto multimoneda compacto: la principal arriba, las demás chicas abajo */
function MoneyMulti({
  amounts,
  className,
  zeroCurrency,
}: {
  amounts: MoneyByCurrency;
  className?: string;
  /** moneda del cero cuando no hay montos; sin ella se muestra un guion */
  zeroCurrency?: string | null;
}) {
  const entries = moneyEntries(amounts);
  if (entries.length === 0) {
    return (
      <span className={cn("tabular-nums", className)}>
        {zeroCurrency ? fmtMoney(0, zeroCurrency) : "—"}
      </span>
    );
  }
  const [first, ...rest] = entries;
  return (
    <span className="inline-flex flex-col">
      <span className={cn("tabular-nums", className)}>{fmtMoney(first[1], first[0])}</span>
      {rest.map(([c, v]) => (
        <span key={c} className="text-xs font-medium tabular-nums text-ink-faint">
          + {fmtMoney(v, c)}
        </span>
      ))}
    </span>
  );
}

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== "undefined" ? window.location.origin : "")
  );
}

/** color del monto según entre o salga plata */
function amountClass(direction: PaymentDirection): string {
  if (direction === "cobro") return "text-money-text";
  if (direction === "reembolso") return "text-tone-stone-text";
  return "text-ink";
}

/* ── stat tile: número grande que cuenta + icono en círculo tonal ── */
function StatTile({
  icon: Icon,
  circle,
  label,
  amounts,
  numberClass,
  zeroCurrency,
  compact = false,
  className,
}: {
  icon: LucideIcon;
  circle: string;
  label: string;
  amounts: MoneyByCurrency;
  numberClass: string;
  /** moneda del cero cuando el período no tuvo movimientos; sin ella, un guion */
  zeroCurrency?: string | null;
  /** para grillas de 4 en mobile: círculo y número más chicos, la plata no se corta */
  compact?: boolean;
  className?: string;
}) {
  const entries = moneyEntries(amounts);
  const empty = entries.length === 0;
  const [cur, val] = entries[0] ?? ([zeroCurrency ?? "USD", 0] as [string, number]);
  const rest = entries.slice(1);
  const isInt = Math.abs(val % 1) <= 0.004;
  return (
    <div
      className={cn(
        "card flex items-center gap-3.5 p-4",
        compact && "gap-2.5 p-3 md:gap-3.5 md:p-4",
        className,
      )}
    >
      <div
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-full",
          compact && "size-9 md:size-11",
          circle,
        )}
      >
        <Icon className={cn("size-5", compact && "size-4.5 md:size-5")} strokeWidth={1.9} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-ink-faint">{label}</p>
        {empty && !zeroCurrency ? (
          <p
            className={cn(
              "block truncate font-display text-xl font-semibold md:text-2xl",
              compact && "text-lg md:text-2xl",
              "text-ink-faint",
            )}
          >
            —
          </p>
        ) : (
          <AnimatedNumber
            value={val}
            from={0}
            format={(n) => fmtMoney(isInt ? Math.round(n) : n, cur)}
            className={cn(
              "block truncate font-display text-xl font-semibold md:text-2xl",
              compact && "text-lg md:text-2xl",
              numberClass,
            )}
          />
        )}
        {rest.map(([c, v]) => (
          <span key={c} className="block text-xs font-medium tabular-nums text-ink-faint">
            + {fmtMoney(v, c)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** chip que explica de dónde sale la comisión del vendedor */
function SchemeChip({ row }: { row: CommissionRow }) {
  if (row.filesCount === 0) {
    return <span className="text-ink-faint">—</span>;
  }
  const mixed = row.scheme.fixedFiles > 0 && row.scheme.pctFiles > 0;
  const Icon = mixed
    ? Shuffle
    : row.scheme.fixedFiles > 0
      ? COMMISSION_TYPES.monto_fijo.icon
      : COMMISSION_TYPES.utilidad_pct.icon;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line bg-sand-soft px-2 py-0.5 text-[11px] font-medium text-ink-soft">
      <Icon className="size-3" strokeWidth={2} aria-hidden />
      {row.schemeLabel}
    </span>
  );
}

/** "Al día": el vendedor no tiene nada pendiente */
function SettledChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-money-tint-line bg-money-tint px-2.5 py-1 text-xs font-medium text-money-text",
        className,
      )}
    >
      <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
      Al día
    </span>
  );
}

/* ── componente principal ── */

export function CajaClient({
  monthKey,
  monthLabel,
  initialTab,
  stats,
  movements,
  debtors,
  chargeable,
  commissions,
  suppliers,
  sellers,
  fileOptions,
  mainCurrency,
  isAdmin,
}: {
  monthKey: string;
  monthLabel: string;
  initialTab: CajaTab;
  stats: CajaStats;
  movements: Movement[];
  /** files con saldo: la cuenta corriente y el total por cobrar */
  debtors: DebtorFile[];
  /** a quién se le puede cobrar: los saldos + los files sin servicios cargados */
  chargeable: DebtorFile[];
  commissions: CommissionRow[];
  suppliers: SupplierOption[];
  sellers: SellerOption[];
  fileOptions: FileOption[];
  /** moneda con la que más opera la agencia; null cuando todavía no hay nada cargado */
  mainCurrency: string | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState<CajaTab>(initialTab);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [supplierOpen, setSupplierOpen] = React.useState(false);
  const [commissionOpen, setCommissionOpen] = React.useState(false);
  const [commissionPreset, setCommissionPreset] = React.useState<CommissionPreset | null>(
    null,
  );
  const [paymentFile, setPaymentFile] = React.useState<PaymentFile | null>(null);
  const [paymentOpen, setPaymentOpen] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<Movement | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [barsIn, setBarsIn] = React.useState(false);

  // barras de cobrado: entran desde 0 al montar
  React.useEffect(() => {
    const t = requestAnimationFrame(() => setBarsIn(true));
    return () => cancelAnimationFrame(t);
  }, []);

  function changeTab(t: CajaTab) {
    setTab(t);
    // persistimos el tab en la URL sin refetch
    window.history.replaceState(null, "", `/caja?m=${monthKey}&tab=${t}`);
  }

  function goToMonth(key: string) {
    if (key === monthKey) return;
    router.push(`/caja?m=${key}&tab=${tab}`);
  }

  function openPaymentFor(d: DebtorFile) {
    setPickerOpen(false);
    setPaymentFile({
      id: d.id,
      code: d.code,
      currency: d.currency,
      contact_id: d.contact_id,
      contact_name: d.contact_name,
      total_sale: d.total_sale,
      balance: d.balance,
    });
    setPaymentOpen(true);
  }

  /** sin fila: liquidación libre · con fila: vendedor + pendiente precargados */
  function openCommission(row?: CommissionRow) {
    if (row) {
      const [cur, amt] =
        moneyEntries(row.pending)[0] ?? ([mainCurrency ?? "USD", 0] as [string, number]);
      setCommissionPreset({
        memberId: row.memberId,
        name: row.name,
        amount: amt,
        currency: cur,
      });
    } else {
      setCommissionPreset(null);
    }
    setCommissionOpen(true);
  }

  async function copyReceipt(m: Movement) {
    try {
      await navigator.clipboard.writeText(`${appUrl()}/r/${m.receipt_token}`);
      setCopiedId(m.id);
      setTimeout(() => setCopiedId((prev) => (prev === m.id ? null : prev)), 2000);
      toast.success(`Link del recibo ${m.receipt_code} copiado`);
    } catch {
      toast.error("No se pudo copiar el link.");
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    const target = toDelete;
    setDeleting(true);
    // optimista: lo escondemos ya
    setHidden((prev) => new Set(prev).add(target.id));
    setToDelete(null);
    const res = await deletePayment({ paymentId: target.id });
    setDeleting(false);
    if (!res.ok) {
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
      toast.error(res.error);
      return;
    }
    toast.success("Movimiento eliminado");
    router.refresh();
  }

  const visibleMovements = movements.filter((m) => !hidden.has(m.id));
  const totalReceivable = moneyEntries(stats.receivable);
  const hasReceivable = totalReceivable.length > 0;
  /** files ya cargados pero sin servicios: no tienen saldo todavía, y hay que decirlo */
  const filesWithoutServices = chargeable.filter((f) => f.total_sale <= 0.004).length;

  // lo que falta liquidar en el período (suma de las filas visibles)
  const commissionsPending = React.useMemo(() => {
    const acc: MoneyByCurrency = {};
    for (const c of commissions) {
      for (const [cur, v] of Object.entries(c.pending)) {
        acc[cur] = Math.round(((acc[cur] ?? 0) + v) * 100) / 100;
      }
    }
    return acc;
  }, [commissions]);
  const hasPendingCommissions = moneyEntries(commissionsPending).length > 0;

  // ── filtro de período: Segmented (Este mes / Mes pasado / mes navegado) ──
  const nowKey = currentMonthKey();
  const prevKey = shiftMonth(nowKey, -1);
  const isKnownPeriod = monthKey === nowKey || monthKey === prevKey;
  const periodOptions: { value: string; label: React.ReactNode }[] = [
    ...(!isKnownPeriod
      ? [{ value: monthKey, label: <span className="capitalize">{monthLabel}</span> }]
      : []),
    { value: prevKey, label: "Mes pasado" },
    { value: nowKey, label: "Este mes" },
  ];

  return (
    <div className="flex flex-col gap-4 px-4 md:px-6">
      {/* ── filtro de período ── */}
      <div className="flex items-center justify-center gap-1 animate-fade-in">
        <button
          type="button"
          onClick={() => goToMonth(shiftMonth(monthKey, -1))}
          aria-label="Mes anterior"
          className="flex size-11 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none active:scale-95"
        >
          <ChevronLeft className="size-5" />
        </button>
        <Segmented options={periodOptions} value={monthKey} onChange={goToMonth} />
        <button
          type="button"
          onClick={() => goToMonth(shiftMonth(monthKey, 1))}
          aria-label="Mes siguiente"
          className="flex size-11 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none active:scale-95"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      {/* ── 3 números grandes ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 animate-slide-up">
        <StatTile
          icon={Banknote}
          circle="bg-money-tint text-money-text"
          label="Cobrado del período"
          amounts={stats.collected}
          numberClass="text-money-text"
          zeroCurrency={mainCurrency}
          className="col-span-2 md:col-span-1"
        />
        <StatTile
          icon={ArrowUpFromLine}
          circle="bg-tone-orange-soft text-tone-orange-text"
          label="Pagado a proveedores"
          amounts={stats.supplierPaid}
          numberClass="text-ink"
          zeroCurrency={mainCurrency}
        />
        <StatTile
          icon={Hourglass}
          circle="bg-tone-amber-soft text-tone-amber-text"
          label="Por cobrar total"
          amounts={stats.receivable}
          numberClass={hasReceivable ? "text-tone-amber-text" : "text-ink"}
          zeroCurrency={mainCurrency}
        />
      </div>

      {/* ── tabs + acciones ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<CajaTab>
          options={[
            { value: "movimientos", label: "Movimientos" },
            { value: "cuenta", label: "Cuenta corriente" },
            { value: "comisiones", label: "Comisiones" },
          ]}
          value={tab}
          onChange={changeTab}
        />
        <div className="flex w-full items-center gap-2 md:w-auto">
          {isAdmin && (
            <Button
              variant="secondary"
              size="sm"
              className="h-11 flex-1 md:h-8 md:flex-none"
              onClick={() => openCommission()}
            >
              <HandCoins />
              <span className="min-w-0 truncate md:hidden">Comisión</span>
              <span className="hidden md:inline">Pagar comisión</span>
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="h-11 flex-1 md:h-8 md:flex-none"
            onClick={() => setSupplierOpen(true)}
          >
            <ArrowUpFromLine />
            <span className="min-w-0 truncate md:hidden">Proveedor</span>
            <span className="hidden md:inline">Pago a proveedor</span>
          </Button>
          <Button
            variant="success"
            size="sm"
            className="h-11 flex-1 md:h-8 md:flex-none"
            onClick={() => setPickerOpen(true)}
          >
            <Banknote />
            <span className="min-w-0 truncate md:hidden">Cobro</span>
            <span className="hidden md:inline">Registrar cobro</span>
          </Button>
        </div>
      </div>

      {/* ── MOVIMIENTOS ── */}
      {tab === "movimientos" &&
        (visibleMovements.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="Sin movimientos este mes"
            description="Cuando registres un cobro o un pago, aparece acá."
            action={
              <Button variant="success" size="sm" onClick={() => setPickerOpen(true)}>
                <Banknote />
                Registrar cobro
              </Button>
            }
          />
        ) : (
          <div
            className={cn(
              "card divide-y divide-line",
              visibleMovements.length <= 14 ? "stagger-children" : "animate-fade-in",
            )}
          >
            {visibleMovements.map((m) => {
              const meta = PAYMENT_DIRECTIONS[m.direction];
              const Icon = meta.icon;
              const MethodIcon = PAYMENT_METHODS[m.method].icon;
              const isCross = m.currency !== m.file_currency;
              const isCommission = m.direction === "pago_comision";
              const who = isCommission
                ? (m.member_name ?? "Vendedor")
                : m.direction === "pago_proveedor"
                  ? (m.supplier_name ?? "Proveedor")
                  : (m.contact_name ?? "Cliente");
              // prefijo del subtítulo: "Comisión" y/o el file, separados por ·
              const lead: React.ReactNode[] = [];
              if (isCommission) {
                lead.push(
                  <span key="tipo" className="shrink-0 font-medium text-ink-soft">
                    Comisión
                  </span>,
                );
              }
              if (m.file_id && m.file_code) {
                lead.push(
                  <Link
                    key="file"
                    href={`/files/${m.file_id}`}
                    className="shrink-0 font-mono font-medium text-ink-soft underline-offset-2 hover:text-brand-text hover:underline"
                  >
                    {m.file_code}
                  </Link>,
                );
              }
              return (
                <div key={m.id} className="flex min-h-16 items-center gap-3 px-3.5 py-2.5">
                  <div
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-full",
                      meta.circle,
                    )}
                  >
                    <Icon className="size-4" strokeWidth={1.9} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{who}</p>
                    <p className="flex items-center gap-1.5 truncate text-xs text-ink-faint">
                      {lead.map((node, i) => (
                        <React.Fragment key={i}>
                          {node}
                          <span aria-hidden>·</span>
                        </React.Fragment>
                      ))}
                      <MethodIcon className="size-3.5 shrink-0" strokeWidth={1.9} />
                      <span className="truncate">
                        {PAYMENT_METHODS[m.method].label} · {fmtDate(m.paid_at)}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-right">
                      <span
                        className={cn(
                          "block text-sm font-semibold tabular-nums",
                          amountClass(m.direction),
                        )}
                      >
                        {meta.sign} {fmtMoney(m.amount, m.currency)}
                      </span>
                      {isCross && (
                        <span className="block text-[11px] tabular-nums text-ink-faint">
                          ≈ {fmtMoney(m.amount_in_file_currency, m.file_currency)}
                          {m.exchange_rate
                            ? ` · $ ${fmtNumber(m.exchange_rate)}`
                            : ""}
                        </span>
                      )}
                    </span>
                    {m.direction === "cobro" && m.receipt_code && (
                      <Tooltip content={`Copiar recibo ${m.receipt_code}`}>
                        <button
                          type="button"
                          onClick={() => copyReceipt(m)}
                          aria-label={`Copiar link del recibo ${m.receipt_code}`}
                          className="flex size-8 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none"
                        >
                          {copiedId === m.id ? (
                            <Check className="size-4 animate-check-pop text-money-text" />
                          ) : (
                            <Link2 className="size-4" />
                          )}
                        </button>
                      </Tooltip>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => setToDelete(m)}
                        aria-label="Eliminar movimiento"
                        className="flex size-8 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-tone-red-soft hover:text-tone-red-text tap-highlight-none"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

      {/* ── CUENTA CORRIENTE ── */}
      {tab === "cuenta" &&
        (debtors.length === 0 ? (
          fileOptions.length === 0 ? (
            <EmptyState
              icon={Luggage}
              title="Todavía no hay ventas cargadas"
              description="Cuando cargues un file con sus servicios, acá ves lo que falta cobrar."
              action={
                <Link href="/files">
                  <Button variant="brand">
                    <Plus /> Crear el primer file
                  </Button>
                </Link>
              }
            />
          ) : filesWithoutServices > 0 ? (
            <EmptyState
              icon={ReceiptText}
              title="Todavía no hay saldos"
              description={`${filesWithoutServices} ${
                filesWithoutServices === 1 ? "file está" : "files están"
              } sin servicios cargados: el saldo aparece cuando les pongas precio.`}
              action={
                <Link href="/files">
                  <Button variant="secondary">Ir a Files</Button>
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={PartyPopper}
              title="Nadie debe nada"
              description="Todos los files están saldados."
            />
          )
        ) : (
          <div className="flex flex-col gap-3 animate-fade-in">
            <div
              className={cn(
                "card divide-y divide-line",
                debtors.length <= 14 && "stagger-children",
              )}
            >
              {debtors.map((d) => {
                const days = daysUntil(d.departure_date);
                const urgent = days !== null && days < 15;
                const pct =
                  d.total_sale > 0
                    ? Math.min(100, Math.max(0, (d.paid_total / d.total_sale) * 100))
                    : 0;
                const reminder = d.contact_phone
                  ? waLink(
                      d.contact_phone,
                      `¡Hola ${d.contact_name.split(" ")[0]}! 👋 Te recuerdo que quedó un saldo pendiente de ${fmtMoney(d.balance, d.currency)} por tu viaje a ${d.destination} (file ${d.code}). Cuando puedas lo coordinamos. ¡Gracias!`,
                    )
                  : null;
                return (
                  <div key={d.id} className="flex flex-col gap-2.5 px-3.5 py-3.5">
                    <div className="flex items-start gap-3">
                      <Avatar name={d.contact_name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">
                          {d.contact_name}
                        </p>
                        <p className="truncate text-xs text-ink-faint">
                          <Link
                            href={`/files/${d.id}`}
                            className="font-mono font-medium text-ink-soft underline-offset-2 hover:text-brand-text hover:underline"
                          >
                            {d.code}
                          </Link>
                          {" · "}
                          {d.destination}
                          {d.departure_date && (
                            <>
                              {" · "}
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1",
                                  urgent && "font-semibold text-tone-red-text",
                                )}
                              >
                                {urgent && (
                                  <AlertTriangle
                                    className="size-3"
                                    strokeWidth={2}
                                    aria-hidden
                                  />
                                )}
                                {days !== null && days < 0 ? "salió " : "sale "}
                                {fmtDate(d.departure_date)}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-display text-lg font-semibold tabular-nums text-tone-amber-text">
                          {fmtMoney(d.balance, d.currency)}
                        </p>
                        <p className="text-[11px] text-ink-faint">
                          de {fmtMoney(d.total_sale, d.currency)}
                        </p>
                      </div>
                    </div>
                    {/* mini barra de cobrado */}
                    <div className="h-1.5 overflow-hidden rounded-full bg-sand-soft">
                      <div
                        className="h-full rounded-full bg-money-600 transition-[width] duration-700 ease-out"
                        style={{ width: barsIn ? `${pct}%` : "0%" }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs tabular-nums text-ink-faint">
                        Cobrado {fmtMoney(d.paid_total, d.currency)} ({Math.round(pct)}%)
                      </p>
                      <div className="flex items-center gap-2">
                        {reminder && (
                          <Button
                            variant="whatsapp"
                            size="sm"
                            onClick={() => window.open(reminder, "_blank")}
                          >
                            <MessageCircle />
                            Recordar
                          </Button>
                        )}
                        <Button
                          variant="success"
                          size="sm"
                          onClick={() => openPaymentFor(d)}
                        >
                          <Banknote />
                          Registrar cobro
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* footer total */}
            <div className="flex items-center justify-between rounded-2xl border border-line bg-sand-soft/60 px-4 py-3">
              <span className="text-sm font-medium text-ink-soft">Total por cobrar</span>
              <span className="text-right">
                {totalReceivable.length === 0 ? (
                  <span className="font-display text-lg font-semibold tabular-nums text-ink">
                    {mainCurrency ? fmtMoney(0, mainCurrency) : "—"}
                  </span>
                ) : (
                  totalReceivable.map(([c, v]) => (
                    <span
                      key={c}
                      className="block font-display text-lg font-semibold tabular-nums text-ink"
                    >
                      {fmtMoney(v, c)}
                    </span>
                  ))
                )}
              </span>
            </div>
          </div>
        ))}

      {/* ── COMISIONES ── */}
      {tab === "comisiones" &&
        (commissions.length === 0 ? (
          <EmptyState
            icon={Calculator}
            title="Sin ventas este mes"
            description="Las comisiones aparecen cuando se crean files en el mes."
          />
        ) : (
          <div className="flex flex-col gap-3 animate-fade-in">
            {/* cierre del período: lo que se generó, lo que se pagó, lo que falta */}
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
              <StatTile
                compact
                icon={TrendingUp}
                circle="bg-money-tint text-money-text"
                label="Utilidad"
                amounts={stats.utility}
                numberClass="text-ink"
                zeroCurrency={mainCurrency}
              />
              <StatTile
                compact
                icon={HandCoins}
                circle="bg-tone-violet-soft text-tone-violet-text"
                label="Comisiones"
                amounts={stats.commissionsDue}
                numberClass="text-ink"
                zeroCurrency={mainCurrency}
              />
              <StatTile
                compact
                icon={CheckCircle2}
                circle="bg-money-tint text-money-text"
                label="Pagadas"
                amounts={stats.commissionsPaid}
                numberClass="text-money-text"
                zeroCurrency={mainCurrency}
              />
              <StatTile
                compact
                icon={Clock}
                circle="bg-tone-amber-soft text-tone-amber-text"
                label="Pendiente"
                amounts={commissionsPending}
                numberClass={hasPendingCommissions ? "text-tone-amber-text" : "text-ink"}
                zeroCurrency={mainCurrency}
              />
            </div>

            {/* ── mobile: una tarjeta por vendedor ── */}
            <div
              className={cn(
                "flex flex-col gap-2.5 md:hidden",
                commissions.length <= 14 && "stagger-children",
              )}
            >
              {commissions.map((c) => {
                const pending = moneyEntries(c.pending);
                const paid = moneyEntries(c.paid);
                const hasMoney = moneyEntries(c.commission).length > 0 || paid.length > 0;
                return (
                  <div key={c.memberId} className="card flex flex-col gap-3 p-3.5">
                    <div className="flex items-start gap-3">
                      <Avatar name={c.name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{c.name}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ink-faint">
                          <span className="shrink-0">
                            {c.filesCount} {c.filesCount === 1 ? "file" : "files"}
                          </span>
                          <span aria-hidden>·</span>
                          <SchemeChip row={c} />
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] text-ink-faint">Comisión</p>
                        <MoneyMulti
                          amounts={c.commission}
                          className="font-display text-lg font-semibold text-ink"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 rounded-xl bg-sand-soft/70 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-[11px] text-ink-faint">Utilidad</p>
                        <MoneyMulti
                          amounts={c.utility}
                          className="text-[13px] font-medium text-ink-soft"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] text-ink-faint">Pagado</p>
                        <MoneyMulti
                          amounts={c.paid}
                          className={cn(
                            "text-[13px] font-medium",
                            paid.length > 0 ? "text-money-text" : "text-ink-faint",
                          )}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] text-ink-faint">Pendiente</p>
                        <MoneyMulti
                          amounts={c.pending}
                          className={cn(
                            "text-[13px] font-semibold",
                            pending.length > 0 ? "text-tone-amber-text" : "text-ink-soft",
                          )}
                        />
                      </div>
                    </div>
                    {isAdmin &&
                      c.payable &&
                      (pending.length > 0 ? (
                        <Button
                          variant="secondary"
                          size="lg"
                          className="w-full"
                          onClick={() => openCommission(c)}
                        >
                          <HandCoins />
                          Pagar {fmtMoney(pending[0][1], pending[0][0])}
                        </Button>
                      ) : hasMoney ? (
                        <SettledChip className="self-center" />
                      ) : null)}
                  </div>
                );
              })}
            </div>

            {/* ── desktop: tabla del cierre ── */}
            <div className="card hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-faint">
                    <th className="px-4 py-3 font-medium">Vendedor</th>
                    <th className="px-3 py-3 text-right font-medium">Files</th>
                    <th className="px-3 py-3 text-right font-medium">Utilidad</th>
                    <th className="px-3 py-3 font-medium">Esquema</th>
                    <th className="px-3 py-3 text-right font-medium">Comisión</th>
                    <th className="px-3 py-3 text-right font-medium">Pagado</th>
                    <th className="px-3 py-3 text-right font-medium">Pendiente</th>
                    {isAdmin && <th className="px-4 py-3 text-right font-medium">Acción</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {commissions.map((c) => {
                    const pending = moneyEntries(c.pending);
                    const paid = moneyEntries(c.paid);
                    const hasMoney = moneyEntries(c.commission).length > 0 || paid.length > 0;
                    return (
                      <tr key={c.memberId}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={c.name} className="size-8 text-[11px]" />
                            <span className="font-medium text-ink">{c.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-ink-soft">
                          {c.filesCount}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <MoneyMulti amounts={c.utility} className="text-ink-soft" />
                        </td>
                        <td className="px-3 py-3">
                          <SchemeChip row={c} />
                        </td>
                        <td className="px-3 py-3 text-right">
                          <MoneyMulti
                            amounts={c.commission}
                            className="font-semibold text-ink"
                          />
                        </td>
                        <td className="px-3 py-3 text-right">
                          <MoneyMulti
                            amounts={c.paid}
                            className={paid.length > 0 ? "text-money-text" : "text-ink-faint"}
                          />
                        </td>
                        <td className="px-3 py-3 text-right">
                          <MoneyMulti
                            amounts={c.pending}
                            className={cn(
                              "font-semibold",
                              pending.length > 0 ? "text-tone-amber-text" : "text-ink-faint",
                            )}
                          />
                        </td>
                        {isAdmin && (
                          <td className="px-4 py-3 text-right">
                            {c.payable &&
                              (pending.length > 0 ? (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => openCommission(c)}
                                >
                                  <HandCoins />
                                  Pagar
                                </Button>
                              ) : hasMoney ? (
                                <SettledChip />
                              ) : null)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="px-1 text-xs text-ink-faint">
              La comisión sale del esquema de cada file: un porcentaje de la utilidad o un
              monto fijo por venta. Se cuentan los files creados en el mes y lo que
              liquidaste dentro de ese mismo mes.
              {isAdmin ? " Cada pago que registres queda como movimiento de caja." : ""}
            </p>
          </div>
        ))}

      {/* ── dialogs ── */}
      <FilePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        files={chargeable}
        hasAnyFile={fileOptions.length > 0}
        onPick={openPaymentFor}
      />
      <SupplierPaymentDialog
        open={supplierOpen}
        onOpenChange={setSupplierOpen}
        suppliers={suppliers}
        files={fileOptions}
      />
      {isAdmin && (
        <CommissionPaymentDialog
          open={commissionOpen}
          onOpenChange={setCommissionOpen}
          sellers={sellers}
          preset={commissionPreset}
        />
      )}
      {paymentFile && (
        <PaymentDialog
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
          file={paymentFile}
        />
      )}

      {/* confirmación de borrado (solo admin) */}
      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent
          title="¿Eliminar este movimiento?"
          description={
            toDelete
              ? [
                  fmtMoney(toDelete.amount, toDelete.currency),
                  toDelete.receipt_code ? `recibo ${toDelete.receipt_code}` : null,
                  toDelete.file_code ? `file ${toDelete.file_code}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
          size="md"
        >
          <p className="text-sm text-ink-soft">
            {toDelete?.file_id
              ? "Se recalcula el saldo del file. Esta acción no se puede deshacer."
              : "Esta acción no se puede deshacer."}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setToDelete(null)}>
              Cancelar
            </Button>
            <Button variant="danger" loading={deleting} onClick={confirmDelete}>
              Eliminar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
