"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Botón de copiar de la ficha pública. El valor igual está escrito al lado en
 * texto plano: si el navegador no da permiso al portapapeles (pasa en http o en
 * webviews), se selecciona a mano y listo. Por eso el fallo es silencioso — un
 * cartel de error acá sería ruido sobre algo que el visitante puede resolver
 * solo.
 */
export function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? `${label} copiado` : `Copiar ${label}`}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-line",
        "text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink-soft",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
      )}
    >
      {copied ? (
        <Check className="size-4 text-money-700 animate-check-pop" aria-hidden />
      ) : (
        <Copy className="size-4" aria-hidden />
      )}
    </button>
  );
}
