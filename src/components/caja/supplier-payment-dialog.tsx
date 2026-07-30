"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUpFromLine, Handshake, Luggage, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { ChoiceGrid } from "@/components/ui/misc";
import { registerSupplierPayment } from "@/lib/actions/payments";
import { PAYMENT_METHODS } from "@/lib/domain";
import type { PaymentMethod } from "@/lib/types";
import type { FileOption, SupplierOption } from "./types";

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

const METHOD_OPTIONS = (Object.keys(PAYMENT_METHODS) as PaymentMethod[]).map((k) => ({
  value: k,
  label: PAYMENT_METHODS[k].label,
  icon: PAYMENT_METHODS[k].icon,
}));

/** un combo con una sola opción vacía no explica nada: en su lugar, el estado real y el atajo */
function PickerEmpty({
  icon: Icon,
  text,
  href,
  cta,
}: {
  icon: LucideIcon;
  text: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line-strong/70 bg-sand-soft/30 px-3.5 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sand-soft text-ink-faint">
        <Icon className="size-4.5" strokeWidth={1.9} />
      </span>
      <p className="min-w-0 flex-1 text-[13px] text-ink-soft">{text}</p>
      <Link href={href}>
        <Button variant="secondary" size="sm">
          {cta}
        </Button>
      </Link>
    </div>
  );
}

/** Registrar un pago a proveedor (siempre en la moneda del file). */
export function SupplierPaymentDialog({
  open,
  onOpenChange,
  suppliers,
  files,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  suppliers: SupplierOption[];
  files: FileOption[];
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = React.useState("");
  const [fileId, setFileId] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<PaymentMethod>("transferencia");
  const [note, setNote] = React.useState("");
  const [paidAt, setPaidAt] = React.useState(todayStr());
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setSupplierId("");
    setFileId("");
    setAmount("");
    setMethod("transferencia");
    setNote("");
    setPaidAt(todayStr());
    setLoading(false);
  }, [open]);

  const selectedFile = files.find((f) => f.id === fileId);
  const amountNum = parseAmount(amount);
  const canSubmit = !!supplierId && !!fileId && amountNum > 0 && !loading;

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    const res = await registerSupplierPayment({
      supplierId,
      fileId,
      amount: amountNum,
      method,
      note: note || undefined,
      paidAt,
    });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Pago a proveedor registrado");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Pago a proveedor"
        description="Registrá una salida de plata"
        size="md"
      >
        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor={suppliers.length === 0 ? undefined : "sp-supplier"}>Proveedor</Label>
            {suppliers.length === 0 ? (
              <PickerEmpty
                icon={Handshake}
                text="Todavía no cargaste proveedores."
                href="/config/proveedores"
                cta="Cargar proveedores"
              />
            ) : (
              <Select
                id="sp-supplier"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">Elegí un proveedor…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <div>
            <Label htmlFor={files.length === 0 ? undefined : "sp-file"}>File</Label>
            {files.length === 0 ? (
              <PickerEmpty
                icon={Luggage}
                text="El pago va contra una venta y todavía no hay files."
                href="/files"
                cta="Ir a Files"
              />
            ) : (
              <Select id="sp-file" value={fileId} onChange={(e) => setFileId(e.target.value)}>
                <option value="">Elegí el file…</option>
                {files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code} · {f.contact_name} — {f.destination} ({f.currency})
                  </option>
                ))}
              </Select>
            )}
          </div>

          <div>
            <Label htmlFor="sp-amount">Monto</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-medium text-ink-faint">
                {selectedFile ? (selectedFile.currency === "ARS" ? "$" : selectedFile.currency) : "—"}
              </span>
              <Input
                id="sp-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                className="h-12 pl-12 text-lg font-semibold tabular-nums"
              />
            </div>
            {selectedFile && (
              <p className="mt-1.5 text-xs text-ink-faint animate-fade-in">
                Siempre en la moneda del file ({selectedFile.currency}).
              </p>
            )}
          </div>

          <div>
            <Label>Método</Label>
            <ChoiceGrid<PaymentMethod>
              options={METHOD_OPTIONS}
              value={method}
              onChange={setMethod}
              columns={3}
              size="sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sp-date">Fecha</Label>
              <Input
                id="sp-date"
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="sp-note">Nota (opcional)</Label>
              <Input
                id="sp-note"
                placeholder="Ej: hotelería Cancún"
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
            {!loading && <ArrowUpFromLine />}
            Registrar pago
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
