"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  ChevronLeft,
  ChevronRight,
  Link2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented, EmptyState, Tooltip } from "@/components/ui/misc";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Avatar } from "@/components/ui/avatar";
import { PAYMENT_METHODS, waLink } from "@/lib/domain";
import { fmtMoney, fmtDate } from "@/lib/format";
import { deletePayment } from "@/lib/actions/payments";
import { cn } from "@/lib/utils";
import { PaymentDialog } from "./payment-dialog";
import { FilePickerDialog } from "./file-picker-dialog";
import { SupplierPaymentDialog } from "./supplier-payment-dialog";
import type {
  CajaStats,
  CajaTab,
  CommissionRow,
  DebtorFile,
  FileOption,
  Movement,
  MoneyByCurrency,
  PaymentFile,
  SupplierOption,
} from "./types";

/* ── helpers ── */

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
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

/** monto multimoneda: la principal grande, las demás chicas abajo */
function MoneyMulti({
  amounts,
  className,
  zeroCurrency = "USD",
}: {
  amounts: MoneyByCurrency;
  className?: string;
  zeroCurrency?: string;
}) {
  const entries = moneyEntries(amounts);
  if (entries.length === 0) {
    return (
      <span className={cn("tabular-nums", className)}>{fmtMoney(0, zeroCurrency)}</span>
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

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== "undefined" ? window.location.origin : "")
  );
}

const DIRECTION_META = {
  cobro: {
    icon: ArrowDownLeft,
    circle: "bg-money-50 text-money-700",
    sign: "+",
    amount: "text-money-700",
  },
  pago_proveedor: {
    icon: ArrowUpRight,
    circle: "bg-sand-soft text-ink-soft",
    sign: "−",
    amount: "text-ink",
  },
  reembolso: {
    icon: RotateCcw,
    circle: "bg-amber-50 text-amber-700",
    sign: "−",
    amount: "text-amber-700",
  },
} as const;

/* ── componente principal ── */

export function CajaClient({
  monthKey,
  monthLabel,
  initialTab,
  stats,
  movements,
  debtors,
  commissions,
  suppliers,
  fileOptions,
  isAdmin,
}: {
  monthKey: string;
  monthLabel: string;
  initialTab: CajaTab;
  stats: CajaStats;
  movements: Movement[];
  debtors: DebtorFile[];
  commissions: CommissionRow[];
  suppliers: SupplierOption[];
  fileOptions: FileOption[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState<CajaTab>(initialTab);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [supplierOpen, setSupplierOpen] = React.useState(false);
  const [paymentFile, setPaymentFile] = React.useState<PaymentFile | null>(null);
  const [paymentOpen, setPaymentOpen] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<Movement | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());

  function changeTab(t: CajaTab) {
    setTab(t);
    // persistimos el tab en la URL sin refetch
    window.history.replaceState(null, "", `/caja?m=${monthKey}&tab=${t}`);
  }

  function goMonth(delta: number) {
    router.push(`/caja?m=${shiftMonth(monthKey, delta)}&tab=${tab}`);
  }

  function openPaymentFor(d: DebtorFile) {
    setPickerOpen(false);
    setPaymentFile({
      id: d.id,
      code: d.code,
      currency: d.currency,
      contact_id: d.contact_id,
      contact_name: d.contact_name,
      balance: d.balance,
    });
    setPaymentOpen(true);
  }

  async function copyReceipt(m: Movement) {
    try {
      await navigator.clipboard.writeText(`${appUrl()}/r/${m.receipt_token}`);
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

  return (
    <div className="flex flex-col gap-4 px-4 md:px-6">
      {/* ── selector de mes ── */}
      <div className="flex items-center justify-center gap-1 animate-fade-in">
        <button
          type="button"
          onClick={() => goMonth(-1)}
          aria-label="Mes anterior"
          className="flex size-11 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none"
        >
          <ChevronLeft className="size-5" />
        </button>
        <span className="min-w-36 text-center font-display text-lg font-semibold capitalize text-ink">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => goMonth(1)}
          aria-label="Mes siguiente"
          className="flex size-11 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      {/* ── stat tiles ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 animate-slide-up">
        <div className="card p-4">
          <p className="text-xs text-ink-faint">Cobrado en el mes</p>
          <MoneyMulti
            amounts={stats.collected}
            className="mt-1 block font-display text-xl font-semibold text-money-700 md:text-2xl"
          />
        </div>
        <div className="card p-4">
          <p className="text-xs text-ink-faint">Pagado a proveedores</p>
          <MoneyMulti
            amounts={stats.supplierPaid}
            className="mt-1 block font-display text-xl font-semibold text-ink md:text-2xl"
          />
        </div>
        <div className="card p-4">
          <p className="text-xs text-ink-faint">Por cobrar (total)</p>
          <MoneyMulti
            amounts={stats.receivable}
            className="mt-1 block font-display text-xl font-semibold text-brand-700 md:text-2xl"
          />
        </div>
        <div className="card p-4">
          <p className="text-xs text-ink-faint">Utilidad del mes</p>
          <MoneyMulti
            amounts={stats.utility}
            className="mt-1 block font-display text-xl font-semibold text-ink md:text-2xl"
          />
        </div>
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
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setSupplierOpen(true)}>
            <ArrowUpRight />
            Pago a proveedor
          </Button>
          <Button variant="success" size="sm" onClick={() => setPickerOpen(true)}>
            💵 Registrar cobro
          </Button>
        </div>
      </div>

      {/* ── MOVIMIENTOS ── */}
      {tab === "movimientos" &&
        (visibleMovements.length === 0 ? (
          <EmptyState
            emoji="💤"
            title="Sin movimientos este mes"
            description="Cuando registres un cobro o un pago, aparece acá."
            action={
              <Button variant="success" size="sm" onClick={() => setPickerOpen(true)}>
                💵 Registrar cobro
              </Button>
            }
          />
        ) : (
          <div className="card divide-y divide-line animate-fade-in">
            {visibleMovements.map((m) => {
              const meta = DIRECTION_META[m.direction];
              const Icon = meta.icon;
              const who =
                m.direction === "pago_proveedor"
                  ? m.supplier_name ?? "Proveedor"
                  : m.contact_name ?? "Cliente";
              return (
                <div key={m.id} className="flex min-h-16 items-center gap-3 px-3.5 py-2.5">
                  <div
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-full",
                      meta.circle,
                    )}
                  >
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{who}</p>
                    <p className="truncate text-xs text-ink-faint">
                      <Link
                        href={`/files/${m.file_id}`}
                        className="font-medium text-ink-soft underline-offset-2 hover:text-brand-700 hover:underline"
                      >
                        {m.file_code}
                      </Link>
                      {" · "}
                      {PAYMENT_METHODS[m.method]}
                      {" · "}
                      {fmtDate(m.paid_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span
                      className={cn("text-sm font-semibold tabular-nums", meta.amount)}
                    >
                      {meta.sign} {fmtMoney(m.amount, m.currency)}
                    </span>
                    {m.direction === "cobro" && m.receipt_code && (
                      <Tooltip content={`Copiar recibo ${m.receipt_code}`}>
                        <button
                          type="button"
                          onClick={() => copyReceipt(m)}
                          aria-label={`Copiar link del recibo ${m.receipt_code}`}
                          className="flex size-8 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none"
                        >
                          <Link2 className="size-4" />
                        </button>
                      </Tooltip>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => setToDelete(m)}
                        aria-label="Eliminar movimiento"
                        className="flex size-8 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-red-50 hover:text-red-600 tap-highlight-none"
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
          <EmptyState
            emoji="🎉"
            title="Nadie debe nada"
            description="Todos los files están saldados. ¡A vender más viajes!"
          />
        ) : (
          <div className="flex flex-col gap-3 animate-fade-in">
            <div className="card divide-y divide-line">
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
                            className="font-medium text-ink-soft underline-offset-2 hover:text-brand-700 hover:underline"
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
                                  urgent && "font-semibold text-red-600",
                                )}
                              >
                                {urgent && "⚠️ "}
                                {days !== null && days < 0 ? "salió " : "sale "}
                                {fmtDate(d.departure_date)}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-display text-lg font-semibold tabular-nums text-ink">
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
                        className="h-full rounded-full bg-money-600 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs tabular-nums text-ink-faint">
                        Cobrado {fmtMoney(d.paid_total, d.currency)} ({Math.round(pct)}%)
                      </p>
                      <div className="flex items-center gap-2">
                        {reminder && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => window.open(reminder, "_blank")}
                          >
                            <Bell />
                            Recordar
                          </Button>
                        )}
                        <Button
                          variant="success"
                          size="sm"
                          onClick={() => openPaymentFor(d)}
                        >
                          Cobrar
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
                    {fmtMoney(0, "USD")}
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
            emoji="🧮"
            title="Sin ventas este mes"
            description="Las comisiones aparecen cuando se crean files en el mes."
          />
        ) : (
          <div className="flex flex-col gap-2 animate-fade-in">
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-faint">
                    <th className="px-4 py-3 font-medium">Vendedor</th>
                    <th className="px-3 py-3 text-right font-medium">Files</th>
                    <th className="px-3 py-3 text-right font-medium">Venta</th>
                    <th className="px-3 py-3 text-right font-medium">Utilidad</th>
                    <th className="px-3 py-3 text-right font-medium">%</th>
                    <th className="px-4 py-3 text-right font-medium">Comisión</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {commissions.map((c) => (
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
                        <MoneyMulti amounts={c.sale} className="text-ink-soft" />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <MoneyMulti amounts={c.utility} className="text-ink-soft" />
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink-soft">
                        {c.pct !== null ? (
                          `${c.pct}%`
                        ) : (
                          <Tooltip content="Según % de cada file">
                            <span className="cursor-default">—</span>
                          </Tooltip>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <MoneyMulti
                          amounts={c.commission}
                          className="font-semibold text-money-700"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="px-1 text-xs text-ink-faint">
              La comisión se calcula sobre la utilidad de los files creados en el mes.
            </p>
          </div>
        ))}

      {/* ── dialogs ── */}
      <FilePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        debtors={debtors}
        onPick={openPaymentFor}
      />
      <SupplierPaymentDialog
        open={supplierOpen}
        onOpenChange={setSupplierOpen}
        suppliers={suppliers}
        files={fileOptions}
      />
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
              ? `${fmtMoney(toDelete.amount, toDelete.currency)}${
                  toDelete.receipt_code ? ` · recibo ${toDelete.receipt_code}` : ""
                } · file ${toDelete.file_code}`
              : undefined
          }
          size="md"
        >
          <p className="text-sm text-ink-soft">
            Se recalcula el saldo del file. Esta acción no se puede deshacer.
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
