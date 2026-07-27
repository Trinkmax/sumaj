"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, Pencil, Send, Share2, Sparkles, ThumbsDown, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ShareDialog } from "@/components/quotes/share-dialog";
import {
  convertQuote,
  duplicateQuote,
  setQuoteStatus,
} from "@/lib/actions/quotes";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { QuoteStatus } from "@/lib/types";

export type QuoteOptionChoice = {
  id: string;
  name: string;
  subtitle: string | null;
  isRecommended: boolean;
  perPerson: number;
  totalPrice: number;
};

export function QuoteDetailActions({
  quoteId,
  code,
  status,
  fileId,
  publicToken,
  contactName,
  contactPhone,
  currency = "USD",
  options = [],
  acceptedOptionId = null,
}: {
  quoteId: string;
  code: string;
  status: QuoteStatus;
  fileId: string | null;
  publicToken: string;
  contactName: string | null;
  contactPhone: string | null;
  currency?: string;
  /** si el presupuesto compara opciones, se elige con cuál cerró */
  options?: QuoteOptionChoice[];
  acceptedOptionId?: string | null;
}) {
  const router = useRouter();
  const [shareOpen, setShareOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<
    "compartir" | "convertir" | "duplicar" | "rechazar" | null
  >(null);
  const [chosenOption, setChosenOption] = React.useState<string | null>(
    acceptedOptionId ?? options.find((o) => o.isRecommended)?.id ?? options[0]?.id ?? null,
  );
  const multiOption = options.length > 1;

  const isOpen = status === "borrador" || status === "enviado" || status === "vencido";
  const isDraft = status === "borrador";

  /** Borrador → "Enviar": lo marca enviado y abre el compartir.
   *  Ya enviado → "Compartir": abre el diálogo directo, sin tocar el estado. */
  async function handleShare() {
    if (isDraft) {
      setBusy("compartir");
      const res = await setQuoteStatus({ quoteId, status: "enviado" });
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    }
    setShareOpen(true);
  }

  async function handleConvert() {
    setBusy("convertir");
    const res = await convertQuote({ quoteId, optionId: multiOption ? chosenOption : null });
    setBusy(null);
    setConfirmOpen(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`¡Venta creada! File ${res.data.fileCode}`);
    router.push(`/files/${res.data.fileId}`);
  }

  async function handleDuplicate() {
    setBusy("duplicar");
    const res = await duplicateQuote({ quoteId });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Copia creada: ${res.data.code}`);
    router.push(`/presupuestos/${res.data.quoteId}/editar`);
  }

  async function handleReject() {
    setBusy("rechazar");
    const res = await setQuoteStatus({ quoteId, status: "rechazado" });
    setBusy(null);
    setRejectOpen(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Presupuesto marcado como rechazado");
    router.refresh();
  }

  return (
    <div className="space-y-2 animate-slide-up">
      {isOpen && !fileId && (
        <Button
          variant="success"
          size="lg"
          className="w-full"
          loading={busy === "convertir"}
          disabled={busy !== null}
          onClick={() => setConfirmOpen(true)}
        >
          <Trophy /> Convertir en venta
        </Button>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant={isDraft ? "brand" : "secondary"}
          loading={busy === "compartir"}
          disabled={busy !== null}
          onClick={handleShare}
        >
          {isDraft ? (
            <>
              <Send /> Enviar
            </>
          ) : (
            <>
              <Share2 /> Compartir
            </>
          )}
        </Button>
        {status !== "aceptado" ? (
          <Link href={`/presupuestos/${quoteId}/editar`} className="block">
            <Button variant="secondary" className="w-full" disabled={busy !== null}>
              <Pencil /> Editar
            </Button>
          </Link>
        ) : (
          <Button
            variant="secondary"
            loading={busy === "duplicar"}
            disabled={busy !== null}
            onClick={handleDuplicate}
          >
            <Copy /> Duplicar
          </Button>
        )}
      </div>

      {status !== "aceptado" && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="ghost"
            loading={busy === "duplicar"}
            disabled={busy !== null}
            onClick={handleDuplicate}
          >
            <Copy /> Duplicar
          </Button>
          {isOpen ? (
            <Button
              variant="ghost"
              className="text-tone-red-text hover:bg-tone-red-soft hover:text-tone-red-text"
              loading={busy === "rechazar"}
              disabled={busy !== null}
              onClick={() => setRejectOpen(true)}
            >
              <ThumbsDown /> Marcar rechazado
            </Button>
          ) : (
            <span />
          )}
        </div>
      )}

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        publicToken={publicToken}
        code={code}
        contactPhone={contactPhone}
        contactName={contactName}
      />

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent
          title="¿Marcar este presupuesto como rechazado?"
          description={`El presupuesto ${code} queda como rechazado. Podés volver a editarlo cuando quieras.`}
        >
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setRejectOpen(false)} disabled={busy !== null}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              loading={busy === "rechazar"}
              disabled={busy !== null}
              onClick={handleReject}
            >
              <ThumbsDown /> Marcar rechazado
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          title={multiOption ? "¿Con qué opción cerró?" : "¿Convertir en venta?"}
          description={
            multiOption
              ? `Elegí la opción que compró el cliente. El file se arma con esos servicios.`
              : `Se crea el file con los servicios del presupuesto ${code}.`
          }
        >
          {multiOption && (
            <div className="mb-4 space-y-2">
              {options.map((o) => {
                const selected = chosenOption === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setChosenOption(o.id)}
                    aria-pressed={selected}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all tap-highlight-none active:scale-[0.99]",
                      selected
                        ? "border-brand-500 bg-brand-tint shadow-sm"
                        : "border-line hover:border-line-strong hover:bg-sand-soft/50",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        {o.isRecommended && (
                          <Sparkles
                            className="size-3.5 shrink-0 text-brand-600"
                            strokeWidth={2}
                            aria-label="Recomendada"
                          />
                        )}
                        <span className="truncate text-sm font-medium text-ink">{o.name}</span>
                      </span>
                      {o.subtitle && (
                        <span className="block truncate text-xs text-ink-faint">
                          {o.subtitle}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold tabular-nums text-ink">
                        {fmtMoney(o.totalPrice, currency)}
                      </span>
                      <span className="block text-[11px] tabular-nums text-ink-faint">
                        {fmtMoney(o.perPerson, currency)} por persona
                      </span>
                    </span>
                    {selected && (
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white animate-check-pop">
                        <Check className="size-3" strokeWidth={3} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={busy !== null}>
              Cancelar
            </Button>
            <Button
              variant="success"
              loading={busy === "convertir"}
              disabled={busy !== null}
              onClick={handleConvert}
            >
              <Trophy /> Sí, crear la venta
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
