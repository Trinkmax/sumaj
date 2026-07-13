"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Pencil, Send, Share2, ThumbsDown, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ShareDialog } from "@/components/quotes/share-dialog";
import {
  convertQuote,
  duplicateQuote,
  setQuoteStatus,
} from "@/lib/actions/quotes";
import type { QuoteStatus } from "@/lib/types";

export function QuoteDetailActions({
  quoteId,
  code,
  status,
  fileId,
  publicToken,
  contactName,
  contactPhone,
}: {
  quoteId: string;
  code: string;
  status: QuoteStatus;
  fileId: string | null;
  publicToken: string;
  contactName: string | null;
  contactPhone: string | null;
}) {
  const router = useRouter();
  const [shareOpen, setShareOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<
    "compartir" | "convertir" | "duplicar" | "rechazar" | null
  >(null);

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
    const res = await convertQuote({ quoteId });
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
          title="¿Convertir en venta?"
          description={`Se crea el file con los servicios del presupuesto ${code}.`}
        >
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
