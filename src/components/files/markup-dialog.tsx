"use client";

import * as React from "react";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { updateFileMarkup } from "@/lib/actions/files";
import { round2 } from "@/lib/domain";
import { fmtMoney } from "@/lib/format";
import { numToInput, parseAmount } from "./helpers";

/**
 * Markup y descuento del paquete.
 *
 * No se prorratea en los servicios a propósito: si el sobreprecio se reparte,
 * ningún precio del file vuelve a coincidir con lo que realmente cuesta cada
 * cosa y no hay forma de auditar la venta.
 */
export function MarkupDialog({
  fileId,
  currency,
  totalCost,
  servicesSale,
  markup,
  discount,
  open,
  onOpenChange,
}: {
  fileId: string;
  currency: string;
  totalCost: number;
  servicesSale: number;
  markup: number;
  discount: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [markupInput, setMarkupInput] = React.useState(numToInput(markup));
  const [discountInput, setDiscountInput] = React.useState(numToInput(discount));
  const [loading, setLoading] = React.useState(false);

  const markupNum = parseAmount(markupInput);
  const discountNum = parseAmount(discountInput);
  const totalSale = round2(servicesSale + markupNum - discountNum);
  const utility = round2(totalSale - totalCost);

  const submit = async () => {
    if (markupNum < 0 || discountNum < 0) {
      toast.error("Los montos no pueden ser negativos.");
      return;
    }
    if (totalSale < 0) {
      toast.error("Con ese descuento la venta queda en negativo. Revisalo.");
      return;
    }
    setLoading(true);
    const res = await updateFileMarkup({
      fileId,
      markup: markupNum,
      discount: discountNum,
    });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Listo, actualizamos el markup");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Markup del paquete"
        description="El sobreprecio de la agencia sobre el costo de los servicios."
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="mk-markup">Markup ({currency})</Label>
              <Input
                id="mk-markup"
                inputMode="decimal"
                value={markupInput}
                onChange={(e) => setMarkupInput(e.target.value)}
                placeholder="0"
                className="text-right tabular-nums"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="mk-discount">Descuento ({currency})</Label>
              <Input
                id="mk-discount"
                inputMode="decimal"
                value={discountInput}
                onChange={(e) => setDiscountInput(e.target.value)}
                placeholder="0"
                className="text-right tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-1.5 rounded-xl bg-sand-soft/60 p-3.5">
            <Row label="Servicios" value={fmtMoney(servicesSale, currency)} />
            <Row label="Markup" value={`+ ${fmtMoney(markupNum, currency)}`} />
            {discountNum > 0 && (
              <Row label="Descuento" value={`− ${fmtMoney(discountNum, currency)}`} />
            )}
            <div className="flex items-center justify-between border-t border-line pt-1.5">
              <span className="text-sm font-semibold text-ink">Paga el cliente</span>
              <span className="text-lg font-bold tabular-nums text-ink">
                {fmtMoney(totalSale, currency)}
              </span>
            </div>
            <p className="pt-0.5 text-[11px] text-ink-faint">
              Utilidad visible para el vendedor: {fmtMoney(utility, currency)}. La comisión del
              mayorista va aparte.
            </p>
          </div>

          {/* con la utilidad en negativo el vendedor no cobra: mejor decirlo
              antes de guardar que descubrirlo al liquidar el mes */}
          {utility < -0.004 && (
            <p className="flex items-start gap-2 rounded-xl border border-tone-amber-line bg-tone-amber-soft px-3 py-2.5 text-[12px] leading-snug text-tone-amber-text">
              <TriangleAlert className="mt-px size-4 shrink-0" strokeWidth={2} />
              <span>
                Estás vendiendo por debajo del costo de los servicios. El vendedor no cobra
                comisión por esta venta; fijate si la comisión del mayorista alcanza para
                cubrirla.
              </span>
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={loading}>
              Guardar markup
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink-soft">{label}</span>
      <span className="font-medium tabular-nums text-ink-soft">{value}</span>
    </div>
  );
}
