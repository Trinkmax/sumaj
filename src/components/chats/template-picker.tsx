"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, NotebookText, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fillTemplate } from "@/lib/domain";
import type { TemplateRow } from "./types";

/**
 * Reemplaza al composer cuando la conversación está fuera de la
 * ventana de 24 hs: elegir plantilla aprobada → preview con variables
 * reemplazadas → enviar. Estilado como lista de WhatsApp Web.
 */
export function TemplatePicker({
  templates,
  vars,
  onSend,
}: {
  templates: TemplateRow[];
  vars: Record<string, string>;
  /**
   * Manda la plantilla. El texto NO viaja: lo arma el servidor con las mismas
   * variables, porque Meta arma el mensaje con los parámetros y no con el texto
   * que le pasemos. Acá `vars` es solo para la vista previa.
   */
  onSend: (template: TemplateRow) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<TemplateRow | null>(null);
  const [sending, setSending] = useState(false);

  if (templates.length === 0) {
    return (
      <p className="px-1 py-2 text-center text-[13px] text-wa-ink-faint">
        No hay plantillas aprobadas todavía. Cargalas en{" "}
        <Link
          href="/config/plantillas"
          className="font-medium text-wa-accent-deep underline underline-offset-2"
        >
          Configuración · Plantillas
        </Link>
        .
      </p>
    );
  }

  if (!selected) {
    return (
      <div className="animate-fade-in">
        <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-wa-ink-faint">
          Elegí una plantilla
        </p>
        <div className="max-h-48 divide-y divide-wa-line overflow-y-auto overscroll-contain rounded-lg border border-wa-line bg-wa-panel">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelected(t)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-wa-hover active:bg-wa-active tap-highlight-none"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-wa-accent/12 text-wa-accent-deep">
                <NotebookText className="size-4.5" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-wa-ink">
                  {t.name}
                </span>
                <span className="block truncate text-[12.5px] text-wa-ink-soft">
                  {fillTemplate(t.body, vars)}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-wa-ink-faint" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  const filled = fillTemplate(selected.body, vars);

  async function handleSend() {
    if (sending || !selected) return;
    setSending(true);
    const ok = await onSend(selected);
    setSending(false);
    if (ok) setSelected(null);
  }

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
        <p className="truncate text-[13px] font-medium text-wa-ink">{selected.name}</p>
        <span className="shrink-0 text-[11px] text-wa-ink-faint">{selected.meta_name}</span>
      </div>
      {/* preview como burbuja saliente de WA */}
      <div className="flex justify-end">
        <div className="relative max-h-40 w-full overflow-y-auto rounded-lg border border-dashed border-wa-accent-deep/50 bg-wa-bubble-out px-3.5 py-2.5 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
          <span className="block pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-wa-accent-deep">
            Plantilla
          </span>
          <p className="whitespace-pre-wrap text-[14.2px] leading-[19px] text-wa-bubble-ink">
            {filled}
          </p>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSelected(null)}
          disabled={sending}
          className="inline-flex h-9 items-center gap-1 rounded-lg px-3 text-[13px] font-medium text-wa-ink-soft transition-colors hover:bg-wa-hover active:scale-[0.98] disabled:opacity-50 tap-highlight-none"
        >
          <ChevronLeft className="size-4" />
          Elegir otra
        </button>
        <Button
          variant="whatsapp"
          size="sm"
          className="h-9 flex-1 rounded-lg"
          loading={sending}
          onClick={handleSend}
        >
          {!sending && <Send />}
          Enviar plantilla
        </Button>
      </div>
    </div>
  );
}
