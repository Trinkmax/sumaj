"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HandCoins, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { ChoiceGrid, Segmented } from "@/components/ui/misc";
import { Avatar } from "@/components/ui/avatar";
import { registerCommissionPayment } from "@/lib/actions/payments";
import { PAYMENT_METHODS } from "@/lib/domain";
import { fmtMoney } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";
import type { MoneyByCurrency, SellerOption } from "./types";

function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function parseAmount(s: string): number {
  const t = s.trim();
  // sin coma y con un solo punto de 1-2 decimales → es decimal (teclado iOS / valores JS)
  if (!t.includes(",") && /^\d+\.\d{1,2}$/.test(t)) {
    const n = parseFloat(t);
    return isNaN(n) ? 0 : n;
  }
  const n = parseFloat(t.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

/** 1200.5 → "1200,5" (coma decimal es-AR, como se tipea) */
function toInput(n: number): string {
  if (!n) return "";
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

/** lo pendiente del vendedor en la moneda principal (USD antes que ARS) */
function topPending(pending: MoneyByCurrency): [string, number] | null {
  const entries = Object.entries(pending).filter(([, v]) => v > 0.004);
  if (entries.length === 0) return null;
  entries.sort((a, b) => (a[0] === "USD" ? -1 : b[0] === "USD" ? 1 : 0));
  return entries[0];
}

const METHOD_OPTIONS = (Object.keys(PAYMENT_METHODS) as PaymentMethod[]).map((k) => ({
  value: k,
  label: PAYMENT_METHODS[k].label,
  icon: PAYMENT_METHODS[k].icon,
}));

/** vendedor + pendiente precargados desde la tabla de comisiones */
export type CommissionPreset = {
  memberId: string;
  name: string;
  amount: number;
  currency: string;
};

/**
 * Pagar la comisión de un vendedor.
 * Sin file asociado: es la liquidación del período.
 */
export function CommissionPaymentDialog({
  open,
  onOpenChange,
  sellers,
  preset,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sellers: SellerOption[];
  preset?: CommissionPreset | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Pagar comisión"
        description="Queda como salida de caja del período"
        size="md"
      >
        {/* el form se monta con el sheet: cada apertura arranca limpio */}
        <CommissionForm
          sellers={sellers}
          preset={preset ?? null}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function CommissionForm({
  sellers,
  preset,
  onDone,
}: {
  sellers: SellerOption[];
  preset: CommissionPreset | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [memberId, setMemberId] = React.useState(preset?.memberId ?? "");
  const [locked, setLocked] = React.useState(!!preset);
  const [amount, setAmount] = React.useState(preset ? toInput(preset.amount) : "");
  const [currency, setCurrency] = React.useState(preset?.currency ?? "USD");
  const [method, setMethod] = React.useState<PaymentMethod>("transferencia");
  const [note, setNote] = React.useState("");
  const [paidAt, setPaidAt] = React.useState(todayStr());
  const [loading, setLoading] = React.useState(false);
  const amountRef = React.useRef<HTMLInputElement>(null);

  // si el vendedor ya viene elegido, lo primero que se toca es el monto
  React.useEffect(() => {
    if (!preset) return;
    const t = setTimeout(() => amountRef.current?.focus(), 180);
    return () => clearTimeout(t);
  }, [preset]);

  const seller = sellers.find((s) => s.id === memberId);
  const sellerName = seller?.name ?? preset?.name ?? "";
  const pendingNow =
    locked && preset && preset.amount > 0
      ? ([preset.currency, preset.amount] as [string, number])
      : topPending(seller?.pending ?? {});
  const amountNum = parseAmount(amount);
  const canSubmit = !!memberId && amountNum > 0 && !loading;

  /** al elegir vendedor precargamos lo que le falta cobrar del mes */
  function pickSeller(id: string) {
    setMemberId(id);
    const top = topPending(sellers.find((s) => s.id === id)?.pending ?? {});
    setAmount(top ? toInput(top[1]) : "");
    if (top) setCurrency(top[0]);
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    const res = await registerCommissionPayment({
      memberId,
      amount: amountNum,
      currency,
      method,
      note: note || undefined,
      paidAt,
    });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    const firstName = (res.data.sellerName || sellerName).split(" ")[0];
    toast.success(`Comisión pagada a ${firstName}: ${fmtMoney(amountNum, currency)}`);
    onDone();
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {/* vendedor */}
      <div>
        <Label htmlFor={locked ? undefined : "cp-member"}>Vendedor</Label>
        {locked && sellerName ? (
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-sand-soft/60 px-3 py-2.5 animate-fade-in">
            <Avatar name={sellerName} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{sellerName}</p>
              {pendingNow && (
                <p className="truncate text-xs text-ink-faint">
                  Pendiente del mes: {fmtMoney(pendingNow[1], pendingNow[0])}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setLocked(false);
                setMemberId("");
              }}
              aria-label="Elegir otro vendedor"
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-sand-deep hover:text-ink tap-highlight-none active:scale-95"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <>
            <Select
              id="cp-member"
              value={memberId}
              onChange={(e) => pickSeller(e.target.value)}
            >
              <option value="">Elegí un vendedor…</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            {memberId && (
              <p className="mt-1.5 text-xs text-ink-faint animate-fade-in">
                {pendingNow
                  ? `Pendiente del mes: ${fmtMoney(pendingNow[1], pendingNow[0])}`
                  : "No le quedan comisiones pendientes este mes."}
              </p>
            )}
          </>
        )}
      </div>

      {/* monto */}
      <div>
        <Label htmlFor="cp-amount">Monto</Label>
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base font-medium text-ink-faint">
            {currency === "ARS" ? "$" : currency}
          </span>
          <Input
            id="cp-amount"
            ref={amountRef}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            className="h-16 pl-16 text-3xl font-semibold tabular-nums"
          />
        </div>
      </div>

      {/* moneda */}
      <div>
        <Label>Moneda</Label>
        <Segmented
          options={[
            { value: "USD", label: "USD" },
            { value: "ARS", label: "ARS" },
          ]}
          value={currency}
          onChange={setCurrency}
        />
      </div>

      {/* forma de pago */}
      <div>
        <Label>Forma de pago</Label>
        <ChoiceGrid<PaymentMethod>
          options={METHOD_OPTIONS}
          value={method}
          onChange={setMethod}
          columns={3}
          size="sm"
        />
      </div>

      {/* fecha + nota */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="cp-date">Fecha</Label>
          <Input
            id="cp-date"
            type="date"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="cp-note">Nota (opcional)</Label>
          <Input
            id="cp-note"
            placeholder="Liquidación de julio"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>

      <Button
        size="lg"
        className="w-full"
        loading={loading}
        disabled={!canSubmit}
        onClick={handleSubmit}
      >
        {!loading && <HandCoins />}
        Registrar pago
        {amountNum > 0 ? ` de ${fmtMoney(amountNum, currency)}` : ""}
      </Button>
    </div>
  );
}
