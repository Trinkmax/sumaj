"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { Check, Copy, ImageDown, RotateCcw } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { waLink } from "@/lib/domain";
import { getQuoteBuilderData } from "@/lib/actions/quotes";
import { sendMessage } from "@/lib/actions/messages";
import type { QuoteBuilderData } from "@/components/quotes/types";
import type { QuoteSavedResult } from "@/components/quotes/quote-builder";

// Lazy: el cotizador no pesa en el bundle del tablero/chats hasta que se abre.
const QuoteBuilder = dynamic(
  () => import("@/components/quotes/quote-builder").then((m) => m.QuoteBuilder),
  { ssr: false, loading: () => <BuilderSkeleton /> },
);

/** Ícono de WhatsApp (lucide no lo trae) */
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2 22l5.3-1.39a9.87 9.87 0 0 0 4.74 1.21c5.46 0 9.9-4.44 9.9-9.9 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.32a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.23 8.24Zm4.52-6.16c-.25-.13-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.73-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.13.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
    </svg>
  );
}

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
        toast.success("Presupuesto enviado al chat 🧾✨");
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
          <div className="flex flex-col items-center gap-3 py-14 text-center animate-fade-in">
            <div className="text-4xl">😕</div>
            <p className="font-medium text-ink">No pudimos cargar el cotizador</p>
            <p className="max-w-sm text-sm text-ink-faint">{state.message}</p>
            <Button
              variant="secondary"
              className="mt-2"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              <RotateCcw /> Reintentar
            </Button>
          </div>
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
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(success.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar. Seleccioná el link a mano.");
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 py-8 animate-slide-up">
      <div className="text-center">
        <div className="text-4xl">🧾✨</div>
        <p className="mt-2 font-display text-lg font-semibold text-ink">
          Presupuesto {success.code} listo
        </p>
        <p className="mt-0.5 text-sm text-ink-soft">
          {success.contactName
            ? `Compartilo con ${success.contactName} por donde quieras.`
            : "Compartilo con tu cliente por donde quieras."}
        </p>
      </div>

      {/* link + copiar */}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate rounded-xl border border-line bg-sand-soft/60 px-3.5 py-2.5 text-[13px] text-ink-soft">
          {success.link}
        </div>
        <Button
          variant="secondary"
          size="icon"
          onClick={copy}
          aria-label="Copiar link"
          className="shrink-0"
        >
          {copied ? <Check className="animate-pop text-money-700" /> : <Copy />}
        </Button>
      </div>

      <div className="grid gap-2">
        {success.contactPhone && (
          <a
            href={waLink(
              success.contactPhone,
              `Te paso el presupuesto que armamos para vos ✨ ${success.link}`,
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            <Button variant="whatsapp" size="lg" className="w-full">
              <WhatsAppIcon className="size-4.5" />
              Enviar por WhatsApp
            </Button>
          </a>
        )}
        <a
          href={`/api/public/quote-image/${success.publicToken}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <Button variant="secondary" size="lg" className="w-full">
            <ImageDown />
            Descargar imagen
          </Button>
        </a>
        <Button variant="ghost" size="lg" onClick={onClose}>
          Listo
        </Button>
      </div>

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
