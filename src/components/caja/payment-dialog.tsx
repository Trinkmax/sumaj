"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Segmented } from "@/components/ui/misc";
import { createClient } from "@/lib/supabase/client";
import { registerPayment } from "@/lib/actions/payments";
import { PAYMENT_METHODS, round2, waLink } from "@/lib/domain";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AgencySettings, PaymentMethod } from "@/lib/types";

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

/** base para links públicos (recibos) */
function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== "undefined" ? window.location.origin : "")
  );
}

type SuccessInfo = {
  receiptCode: string;
  receiptToken: string;
  newBalance: number;
};

/**
 * Registrar un cobro en 10 segundos.
 * Contrato compartido: files/[id] lo importa con estas props exactas.
 */
export function PaymentDialog({
  open,
  onOpenChange,
  file,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  file: {
    id: string;
    code: string;
    currency: string;
    contact_id: string | null;
    contact_name: string;
    balance: number;
  };
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = React.useState("");
  const [currency, setCurrency] = React.useState(file.currency);
  const [rate, setRate] = React.useState("");
  const [method, setMethod] = React.useState<PaymentMethod>("transferencia");
  const [note, setNote] = React.useState("");
  const [paidAt, setPaidAt] = React.useState(todayStr());
  const [loading, setLoading] = React.useState(false);
  const [success, setSuccess] = React.useState<SuccessInfo | null>(null);
  const [phone, setPhone] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const amountRef = React.useRef<HTMLInputElement>(null);

  const isCross = currency !== file.currency;
  const amountNum = parseAmount(amount);
  const rateNum = parseAmount(rate);
  const converted = isCross && rateNum > 0 ? round2(amountNum / rateNum) : amountNum;
  const canSubmit = amountNum > 0 && (!isCross || rateNum > 0) && !loading;

  // reset + traer cotización default y teléfono del cliente al abrir
  React.useEffect(() => {
    if (!open) return;
    setAmount("");
    setCurrency(file.currency);
    setMethod("transferencia");
    setNote("");
    setPaidAt(todayStr());
    setSuccess(null);
    setCopied(false);
    setLoading(false);

    const supabase = createClient();
    supabase
      .from("agencies")
      .select("settings")
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        const settings = data?.settings as AgencySettings | null;
        if (settings?.usd_rate) setRate(String(settings.usd_rate));
      });
    if (file.contact_id) {
      supabase
        .from("contacts")
        .select("phone")
        .eq("id", file.contact_id)
        .maybeSingle()
        .then(({ data }) => setPhone(data?.phone ?? null));
    } else {
      setPhone(null);
    }
    // autofocus del monto (después de la animación del sheet)
    const t = setTimeout(() => amountRef.current?.focus(), 180);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, file.id]);

  function fillFullBalance() {
    // coma decimal es-AR: el input se parsea con parseAmount
    const v = isCross && rateNum > 0 ? round2(file.balance * rateNum) : round2(file.balance);
    setAmount(String(v).replace(".", ","));
    amountRef.current?.focus();
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    const res = await registerPayment({
      fileId: file.id,
      amount: amountNum,
      currency,
      exchangeRate: isCross ? rateNum : null,
      method,
      note: note || undefined,
      paidAt,
    });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setSuccess(res.data);
    toast.success(`💵 Cobro registrado — recibo ${res.data.receiptCode}`);
    onSuccess?.();
    router.refresh();
  }

  const receiptUrl = success ? `${appUrl()}/r/${success.receiptToken}` : "";

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(receiptUrl);
      setCopied(true);
      toast.success("Link del recibo copiado");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar. Copialo a mano.");
    }
  }

  const settled = success ? success.newBalance <= 0 : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={success ? "Cobro registrado" : "Registrar cobro"}
        description={success ? undefined : `${file.contact_name} · file ${file.code}`}
        size="md"
      >
        {success ? (
          /* ── pantalla de éxito ── */
          <div className="animate-pop flex flex-col items-center gap-1 py-2 text-center">
            <div className="text-5xl">{settled ? "🎉" : "💵"}</div>
            <p className="mt-2 font-display text-xl font-semibold text-ink">
              {settled ? "¡File saldado!" : "Cobro registrado"}
            </p>
            <p className="text-sm text-ink-soft">
              Recibo <span className="font-semibold text-ink">{success.receiptCode}</span>
            </p>
            {settled ? (
              <p className="mt-1 rounded-full bg-money-50 px-3 py-1 text-sm font-medium text-money-700">
                {file.contact_name} no debe nada más ✨
              </p>
            ) : (
              <p className="mt-1 text-sm text-ink-soft">
                Saldo restante{" "}
                <span className="font-semibold tabular-nums text-ink">
                  {fmtMoney(success.newBalance, file.currency)}
                </span>
              </p>
            )}

            <div className="mt-5 flex w-full flex-col gap-2">
              {phone && (
                <Button
                  variant="whatsapp"
                  size="lg"
                  className="w-full"
                  onClick={() =>
                    window.open(
                      waLink(phone, `Te paso el recibo de tu pago 🧾 ${receiptUrl}`),
                      "_blank",
                    )
                  }
                >
                  Enviar por WhatsApp
                </Button>
              )}
              <Button variant="secondary" size="lg" className="w-full" onClick={copyLink}>
                {copied ? <Check /> : <Copy />}
                {copied ? "Copiado" : "Copiar link del recibo"}
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="w-full"
                onClick={() => onOpenChange(false)}
              >
                Listo
              </Button>
            </div>
          </div>
        ) : (
          /* ── formulario ── */
          <div className="flex flex-col gap-4">
            {/* saldo pendiente */}
            <div className="flex items-center justify-between rounded-2xl border border-line bg-sand-soft/60 px-4 py-3">
              <span className="text-[13px] text-ink-soft">Saldo pendiente</span>
              <span className="font-display text-xl font-semibold tabular-nums text-ink">
                {fmtMoney(file.balance, file.currency)}
              </span>
            </div>

            {/* monto */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <Label className="mb-0" htmlFor="pd-amount">
                  Monto
                </Label>
                <button
                  type="button"
                  onClick={fillFullBalance}
                  className="rounded-full border border-line bg-paper px-2.5 py-1 text-xs font-medium text-brand-700 transition-colors hover:border-brand-300 hover:bg-brand-50 tap-highlight-none"
                >
                  Saldo total
                </button>
              </div>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-medium text-ink-faint">
                  {currency === "ARS" ? "$" : currency}
                </span>
                <Input
                  id="pd-amount"
                  ref={amountRef}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  className="h-14 pl-14 text-2xl font-semibold tabular-nums"
                />
              </div>
            </div>

            {/* moneda */}
            {file.currency !== "ARS" && (
              <div>
                <Label>Moneda</Label>
                <div className="flex flex-wrap items-center gap-3">
                  <Segmented
                    options={[
                      { value: file.currency, label: file.currency },
                      { value: "ARS", label: "ARS" },
                    ]}
                    value={currency}
                    onChange={setCurrency}
                  />
                  {isCross && amountNum > 0 && rateNum > 0 && (
                    <span className="animate-fade-in text-sm font-medium tabular-nums text-money-700">
                      = {fmtMoney(converted, file.currency)}
                    </span>
                  )}
                </div>
                {isCross && (
                  <div className="mt-3">
                    <Label htmlFor="pd-rate">Cotización (ARS por {file.currency})</Label>
                    <Input
                      id="pd-rate"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="1200"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      className="tabular-nums"
                    />
                  </div>
                )}
              </div>
            )}

            {/* método */}
            <div>
              <Label>Método</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {(Object.keys(PAYMENT_METHODS) as PaymentMethod[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setMethod(k)}
                    className={cn(
                      "flex min-h-11 items-center justify-center rounded-xl border px-2 text-[13px] font-medium transition-all tap-highlight-none active:scale-[0.98]",
                      method === k
                        ? "border-ink bg-ink text-cream shadow-sm"
                        : "border-line bg-paper text-ink-soft hover:border-line-strong",
                    )}
                  >
                    {PAYMENT_METHODS[k]}
                  </button>
                ))}
              </div>
            </div>

            {/* fecha + nota */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pd-date">Fecha</Label>
                <Input
                  id="pd-date"
                  type="date"
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="pd-note">Nota (opcional)</Label>
                <Input
                  id="pd-note"
                  placeholder="Seña, 2da cuota…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>

            <Button
              variant="success"
              size="lg"
              className="w-full"
              loading={loading}
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              💵 Registrar cobro
              {amountNum > 0 ? ` de ${fmtMoney(amountNum, currency)}` : ""}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
