"use client";

import * as React from "react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ChoiceGrid } from "@/components/ui/misc";
import { updateFileCommission } from "@/lib/actions/files";
import { COMMISSION_TYPES, fileCommission, type CommissionType } from "@/lib/domain";
import { fmtMoney } from "@/lib/format";
import { numToInput, parseAmount } from "./helpers";

const COMMISSION_ORDER: CommissionType[] = ["utilidad_pct", "monto_fijo"];

/**
 * Cómo cobra el vendedor esta venta. Lo abre el admin desde la tarjeta de
 * Rentabilidad; el vendedor ve su comisión pero no la toca.
 *
 * `utility` es la base: venta − costo (lo que el vendedor ve del file). La
 * comisión del mayorista queda afuera a propósito — es la parte de la agencia.
 */
export function CommissionDialog({
  fileId,
  currency,
  sellerName,
  utility,
  commissionType,
  commissionPct,
  commissionAmount,
  commissionLabel,
  open,
  onOpenChange,
}: {
  fileId: string;
  currency: string;
  sellerName: string;
  utility: number;
  commissionType: string;
  commissionPct: number;
  commissionAmount: number;
  commissionLabel: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [type, setType] = React.useState<CommissionType>(
    commissionType === "monto_fijo" ? "monto_fijo" : "utilidad_pct",
  );
  const [pct, setPct] = React.useState(numToInput(commissionPct));
  const [amount, setAmount] = React.useState(numToInput(commissionAmount));
  const [label, setLabel] = React.useState(commissionLabel ?? "");
  const [loading, setLoading] = React.useState(false);

  const pctNum = parseAmount(pct);
  const amountNum = parseAmount(amount);
  const preview = fileCommission({
    commission_type: type,
    commission_pct: pctNum,
    commission_amount: amountNum,
    utility,
  });

  const submit = async () => {
    if (type === "utilidad_pct" && (pctNum < 0 || pctNum > 100)) {
      toast.error("El porcentaje va de 0 a 100.");
      return;
    }
    if (type === "monto_fijo" && amountNum < 0) {
      toast.error("El monto no puede ser negativo.");
      return;
    }
    setLoading(true);
    const res = await updateFileCommission({
      fileId,
      commissionType: type,
      commissionPct: Math.min(100, Math.max(0, pctNum)),
      commissionAmount: Math.max(0, amountNum),
      commissionLabel: label.trim() || null,
    });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Listo, actualizamos la comisión");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Comisión del vendedor"
        description={`Cómo cobra ${sellerName} esta venta.`}
      >
        <div className="space-y-4">
          <ChoiceGrid<CommissionType>
            options={COMMISSION_ORDER.map((k) => ({
              value: k,
              label: COMMISSION_TYPES[k].label,
              icon: COMMISSION_TYPES[k].icon,
              hint: COMMISSION_TYPES[k].hint,
            }))}
            value={type}
            onChange={setType}
            columns={2}
          />

          {type === "utilidad_pct" ? (
            <div>
              <Label htmlFor="cm-pct">Porcentaje de la utilidad</Label>
              <div className="relative">
                <Input
                  id="cm-pct"
                  inputMode="decimal"
                  value={pct}
                  onChange={(e) => setPct(e.target.value)}
                  placeholder="0"
                  className="pr-8 text-right tabular-nums"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-ink-faint">
                  %
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-ink-faint">
                Utilidad de este file: {fmtMoney(utility, currency)} (venta − costo, sin la
                comisión del mayorista)
              </p>
            </div>
          ) : (
            <div>
              <Label htmlFor="cm-amount">Monto por venta</Label>
              <div className="relative">
                <Input
                  id="cm-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="pr-12 text-right tabular-nums"
                />
                <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-ink-faint">
                  {currency}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-ink-faint">
                Se paga igual, sin importar la utilidad del file.
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="cm-label">Etiqueta (opcional)</Label>
            <Input
              id="cm-label"
              value={label}
              maxLength={40}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ej: Grupal Europa"
            />
            <p className="mt-1.5 text-[11px] text-ink-faint">
              Queda al lado de la comisión, para acordarte por qué es así.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl bg-money-tint px-3.5 py-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-money-text">Cobra {sellerName}</p>
              <p className="text-[11px] text-ink-faint">con esta venta</p>
            </div>
            <span className="shrink-0 text-xl font-bold tabular-nums text-money-text">
              {fmtMoney(preview, currency)}
            </span>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} loading={loading}>
              Guardar comisión
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
