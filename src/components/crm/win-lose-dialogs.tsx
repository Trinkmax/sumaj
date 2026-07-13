"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { winLead, markLeadLost } from "@/lib/actions/leads";

/**
 * Dialog de confirmación "¿Marcar como ganado?".
 * Celebra: trofeo en círculo brand + copy cálido. Llama a winLead
 * (convertLeadToSale) y al éxito tira toast con "Ver file".
 */
export function WinLeadDialog({
  open,
  onOpenChange,
  lead,
  onWon,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lead: { id: string; name: string } | null;
  onWon?: (fileId: string, fileCode: string) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const doneRef = React.useRef(false);

  React.useEffect(() => {
    if (open) doneRef.current = false;
  }, [open]);

  async function confirm() {
    if (!lead) return;
    setLoading(true);
    const res = await winLead({ leadId: lead.id });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      doneRef.current = true;
      onOpenChange(false);
      onCancel?.();
      return;
    }
    doneRef.current = true;
    toast.success(`¡Lead ganado! Se creó el file ${res.data.fileCode}`, {
      action: {
        label: "Ver file",
        onClick: () => router.push(`/files/${res.data.fileId}`),
      },
      duration: 8000,
    });
    onWon?.(res.data.fileId, res.data.fileCode);
    onOpenChange(false);
  }

  function handleOpenChange(o: boolean) {
    onOpenChange(o);
    if (!o && !doneRef.current) onCancel?.();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent title="¿Marcar como ganado?">
        <div className="flex flex-col items-center gap-3 pb-1 pt-2 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-brand-tint text-brand-text ring-4 ring-brand-tint/40 animate-pop">
            <Trophy className="size-7" strokeWidth={1.75} />
          </span>
          {lead && (
            <p className="max-w-xs text-sm leading-relaxed text-ink-soft">
              ¡Qué bien! Se crea el file de la venta y{" "}
              <span className="font-medium text-ink">{lead.name}</span> pasa a ser cliente.
            </p>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 pt-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => handleOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button variant="success" onClick={confirm} loading={loading}>
            <Trophy />
            Marcar como ganado
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Motivos frecuentes: un toque y listo (se puede editar después) */
const QUICK_REASONS = [
  "Eligió otra agencia",
  "Se le fue de presupuesto",
  "Postergó el viaje",
  "Dejó de responder",
];

/**
 * Dialog "Marcar como perdido" con motivo (lost_reason):
 * chips de razones rápidas + textarea libre.
 */
export function LoseLeadDialog({
  open,
  onOpenChange,
  lead,
  position,
  onLost,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lead: { id: string; name: string } | null;
  /** posición en la columna perdido (si vino de un drag) */
  position?: number;
  onLost?: () => void;
  onCancel?: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const doneRef = React.useRef(false);

  // reset al abrir (ajuste de estado durante el render)
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) setReason("");
  }

  React.useEffect(() => {
    if (open) doneRef.current = false;
  }, [open]);

  async function confirm() {
    if (!lead) return;
    setLoading(true);
    const res = await markLeadLost({
      leadId: lead.id,
      reason: reason.trim() || null,
      position,
    });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      doneRef.current = true;
      onOpenChange(false);
      onCancel?.();
      return;
    }
    doneRef.current = true;
    toast("Lead marcado como perdido");
    onLost?.();
    onOpenChange(false);
  }

  function handleOpenChange(o: boolean) {
    onOpenChange(o);
    if (!o && !doneRef.current) onCancel?.();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        title="Marcar como perdido"
        description={lead ? `¿Qué pasó con ${lead.name}?` : undefined}
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="lost-reason">Motivo</Label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_REASONS.map((r) => {
                const selected = reason === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setReason(selected ? "" : r)}
                    aria-pressed={selected}
                    className={cn(
                      "min-h-8 rounded-full border px-3 py-1 text-[12px] font-medium transition-all active:scale-[0.97] tap-highlight-none",
                      selected
                        ? "border-tone-red-line bg-tone-red-soft text-tone-red-text"
                        : "border-line bg-paper text-ink-soft hover:border-line-strong hover:bg-sand-soft/60",
                    )}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
            <Textarea
              id="lost-reason"
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: eligió otra agencia, se le fue de presupuesto…"
              maxLength={300}
              className="min-h-[72px]"
            />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => handleOpenChange(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirm} loading={loading}>
              Marcar perdido
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
