"use client";

import * as React from "react";
import { Check, Copy, ImageDown } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { waLink } from "@/lib/domain";

/** Ícono de WhatsApp (lucide no lo trae) */
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2 22l5.3-1.39a9.87 9.87 0 0 0 4.74 1.21c5.46 0 9.9-4.44 9.9-9.9 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.32a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.23 8.24Zm4.52-6.16c-.25-.13-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.73-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.13.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
    </svg>
  );
}

export function ShareDialog({
  open,
  onOpenChange,
  publicToken,
  code,
  contactPhone,
  contactName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publicToken: string;
  code: string;
  contactPhone: string | null;
  contactName: string | null;
}) {
  const [copied, setCopied] = React.useState(false);

  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (typeof window !== "undefined" ? window.location.origin : "");
  const link = `${base}/p/${publicToken}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("No se pudo copiar. Seleccioná el link a mano.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Compartir presupuesto"
        description={`${code}${contactName ? ` · para ${contactName}` : ""}`}
      >
        <div className="space-y-4">
          {/* link + copiar */}
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1 truncate rounded-xl border border-line bg-sand-soft/60 px-3.5 py-2.5 text-[13px] text-ink-soft">
              {link}
            </div>
            <Button
              variant="secondary"
              size="icon"
              onClick={copy}
              aria-label="Copiar link"
              className="shrink-0"
            >
              {copied ? (
                <Check className="animate-pop text-money-700" />
              ) : (
                <Copy />
              )}
            </Button>
          </div>

          {/* acciones */}
          <div className="grid gap-2">
            {contactPhone && (
              <a
                href={waLink(
                  contactPhone,
                  `Te paso el presupuesto que armamos para vos ✨ ${link}`,
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
              href={`/api/public/quote-image/${publicToken}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
            >
              <Button variant="secondary" size="lg" className="w-full">
                <ImageDown />
                Descargar imagen
              </Button>
            </a>
          </div>

          <p className="text-center text-xs text-ink-faint">
            El link muestra solo lo que ve el cliente (sin costos ni comisiones).
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
