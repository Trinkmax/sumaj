"use client";

import * as React from "react";
import { Check, Copy, ExternalLink, ImageDown, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { waLink } from "@/lib/domain";
import { cn } from "@/lib/utils";
import { WhatsAppIcon } from "@/components/quotes/wa-icon";

/* ───────────── tile de acción grande (icono + label) ───────────── */

function ActionTile({
  icon: Icon,
  label,
  onClick,
  href,
  active,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  href?: string;
  active?: boolean;
}) {
  const cls =
    "flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-line bg-paper px-2 py-3 text-center transition-all tap-highlight-none hover:border-line-strong hover:bg-sand-soft/50 active:scale-[0.97]";
  const inner = (
    <>
      <Icon
        className={cn(
          "size-5",
          active ? "text-money-700 animate-check-pop" : "text-ink-soft",
        )}
        strokeWidth={1.9}
      />
      <span className="text-xs font-medium leading-tight text-ink">{label}</span>
    </>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

/* ───────────── acciones de compartir (reusadas por quote-dialog) ─────────────
   El TEXTO que viaja al cliente por WhatsApp conserva sus emojis (permitido). */

export function ShareActions({
  link,
  publicToken,
  contactPhone,
  waText,
}: {
  link: string;
  publicToken: string;
  contactPhone: string | null;
  waText: string;
}) {
  const [copied, setCopied] = React.useState(false);

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
    <div className="space-y-3">
      {/* link visible */}
      <div className="truncate rounded-xl border border-line bg-sand-soft/60 px-3.5 py-2.5 text-[13px] text-ink-soft">
        {link}
      </div>

      {contactPhone && (
        <a
          href={waLink(contactPhone, waText)}
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

      <div className="grid grid-cols-3 gap-2">
        <ActionTile
          icon={copied ? Check : Copy}
          label={copied ? "¡Copiado!" : "Copiar link"}
          onClick={copy}
          active={copied}
        />
        <ActionTile icon={ExternalLink} label="Ver página" href={link} />
        <ActionTile
          icon={ImageDown}
          label="Imagen"
          href={`/api/public/quote-image/${publicToken}`}
        />
      </div>
    </div>
  );
}

/* ───────────── diálogo de compartir ───────────── */

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
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (typeof window !== "undefined" ? window.location.origin : "");
  const link = `${base}/p/${publicToken}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Compartir presupuesto"
        description={`${code}${contactName ? ` · para ${contactName}` : ""}`}
      >
        <div className="space-y-4">
          <ShareActions
            link={link}
            publicToken={publicToken}
            contactPhone={contactPhone}
            waText={`Te paso el presupuesto que armamos para vos ✨ ${link}`}
          />
          <p className="text-center text-xs text-ink-faint">
            El link muestra solo lo que ve el cliente (sin costos ni comisiones).
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
