"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { CircleAlert, ReceiptText, RotateCcw } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { getQuoteBuilderData } from "@/lib/actions/quotes";
import { sendMessage } from "@/lib/actions/messages";
import { ShareActions } from "@/components/quotes/share-dialog";
import type { QuoteBuilderData } from "@/components/quotes/types";
import type { QuoteSavedResult } from "@/components/quotes/quote-builder";

// Lazy: el cotizador no pesa en el bundle del tablero/chats hasta que se abre.
const QuoteBuilder = dynamic(
  () => import("@/components/quotes/quote-builder").then((m) => m.QuoteBuilder),
  { ssr: false, loading: () => <BuilderSkeleton /> },
);

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: QuoteBuilderData };

type SuccessState = {
  code: string;
  link: string;
  publicToken: string;
  contactPhone: string | null;
  contactName: string | null;
};

export function QuoteDialog({
  open,
  onOpenChange,
  leadId,
  contactId,
  conversationId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  leadId?: string | null;
  contactId?: string | null;
  conversationId?: string | null;
  onDone?: () => void;
}) {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [success, setSuccess] = React.useState<SuccessState | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ status: "loading" });
    setSuccess(null);
    getQuoteBuilderData({ leadId: leadId ?? null, contactId: contactId ?? null }).then((res) => {
      if (cancelled) return;
      if (res.ok) setState({ status: "ready", data: res.data });
      else setState({ status: "error", message: res.error });
    });
    return () => {
      cancelled = true;
    };
  }, [open, leadId, contactId, reloadKey]);

  const data = state.status === "ready" ? state.data : null;

  async function handleSaved(r: QuoteSavedResult) {
    if (!r.sent) {
      toast.success("Borrador guardado");
      onDone?.();
      onOpenChange(false);
      return;
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    const link = `${appUrl}/p/${r.publicToken}`;

    if (conversationId) {
      const res = await sendMessage({
        conversationId,
        body: `Te paso el presupuesto que armamos para vos ✨ ${link}`,
      });
      if (res.ok) {
        toast.success(`Presupuesto ${r.code} enviado al chat`);
      } else {
        // ventana de 24h cerrada (u otro error): dejamos el link a mano
        try {
          await navigator.clipboard.writeText(link);
        } catch {
          /* sin permiso de portapapeles: el toast igual explica qué hacer */
        }
        toast.error(
          "La ventana de 24 hs está cerrada — te copiamos el link para mandarlo con una plantilla o desde tu teléfono.",
        );
      }
      onDone?.();
      onOpenChange(false);
      return;
    }

    // sin conversación: pantalla de éxito con opciones de compartir
    const contact =
      data?.lead?.contact ?? (contactId ? data?.contacts.find((c) => c.id === contactId) : null);
    setSuccess({
      code: r.code,
      link,
      publicToken: r.publicToken,
      contactPhone: contact?.phone ?? null,
      contactName: contact?.full_name ?? null,
    });
    onDone?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="xl"
        title="Nuevo presupuesto"
        description="Armalo acá y mandalo por WhatsApp, sin salir de la conversación."
      >
        {success ? (
          <SuccessScreen success={success} onClose={() => onOpenChange(false)} />
        ) : state.status === "loading" ? (
          <BuilderSkeleton />
        ) : state.status === "error" ? (
          <EmptyState
            icon={CircleAlert}
            title="No pudimos cargar el cotizador"
            description={state.message}
            action={
              <Button variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
                <RotateCcw /> Reintentar
              </Button>
            }
            className="border-0 py-14"
          />
        ) : data ? (
          <QuoteBuilder
            initial={null}
            lead={data.lead}
            contacts={data.contacts}
            suppliers={data.suppliers}
            savedNotes={data.savedNotes}
            defaultTheme={data.defaultTheme}
            agency={data.agency}
            sellerName={data.sellerName}
            isAdmin={data.isAdmin}
            fees={data.fees}
            sellerCommissionPct={data.sellerCommissionPct}
            variant="dialog"
            onSaved={handleSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* ───────────── pantalla de éxito (sin conversación) ───────────── */

function SuccessScreen({
  success,
  onClose,
}: {
  success: SuccessState;
  onClose: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-6 animate-slide-up">
      <div className="text-center">
        <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-full bg-money-tint text-money-text ring-4 ring-money-tint/40 animate-pop">
          <ReceiptText className="size-6" strokeWidth={1.75} />
        </div>
        <p className="font-display text-lg font-semibold text-ink">
          Presupuesto {success.code} listo
        </p>
        <p className="mt-0.5 text-sm text-ink-soft">
          {success.contactName
            ? `Compartilo con ${success.contactName} por donde quieras.`
            : "Compartilo con tu cliente por donde quieras."}
        </p>
      </div>

      <ShareActions
        link={success.link}
        publicToken={success.publicToken}
        contactPhone={success.contactPhone}
        waText={`Te paso el presupuesto que armamos para vos ✨ ${success.link}`}
      />

      <Button variant="ghost" size="lg" onClick={onClose}>
        Listo
      </Button>

      <p className="text-center text-xs text-ink-faint">
        El link muestra solo lo que ve el cliente (sin costos ni comisiones).
      </p>
    </div>
  );
}

/* ───────────── skeleton fiel al layout del cotizador ───────────── */

function BuilderSkeleton() {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-44 rounded-2xl" />
        <Skeleton className="h-36 rounded-2xl" />
        <Skeleton className="h-36 rounded-2xl" />
      </div>
      <div className="hidden space-y-4 lg:block">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    </div>
  );
}
