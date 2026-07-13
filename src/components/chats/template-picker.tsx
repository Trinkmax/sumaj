"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fillTemplate } from "@/lib/domain";
import type { TemplateRow } from "./types";

/**
 * Reemplaza al composer cuando la conversación está fuera de la
 * ventana de 24 hs: elegir plantilla aprobada → preview con variables
 * reemplazadas → enviar.
 */
export function TemplatePicker({
  templates,
  vars,
  onSend,
}: {
  templates: TemplateRow[];
  vars: Record<string, string>;
  onSend: (template: TemplateRow, body: string) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<TemplateRow | null>(null);
  const [sending, setSending] = useState(false);

  if (templates.length === 0) {
    return (
      <p className="px-1 py-2 text-center text-[13px] text-ink-faint">
        No hay plantillas aprobadas todavía. Cargalas en{" "}
        <Link href="/config" className="font-medium text-brand-700 underline underline-offset-2">
          Configuración
        </Link>
        .
      </p>
    );
  }

  if (!selected) {
    return (
      <div>
        <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Elegí una plantilla
        </p>
        <div className="max-h-44 space-y-1 overflow-y-auto">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelected(t)}
              className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-cream px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-sand-soft tap-highlight-none"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{t.name}</span>
                <span className="block truncate text-xs text-ink-faint">
                  {fillTemplate(t.body, vars)}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-ink-faint" />
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
    const ok = await onSend(selected, filled);
    setSending(false);
    if (ok) setSelected(null);
  }

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
        <p className="truncate text-[13px] font-medium text-ink">{selected.name}</p>
        <span className="shrink-0 text-[11px] text-ink-faint">{selected.meta_name}</span>
      </div>
      <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-2xl rounded-br-md border border-dashed border-money-700/30 bg-[#dcf5c8] px-3.5 py-2.5 text-[14px] leading-snug text-ink">
        {filled}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setSelected(null)} disabled={sending}>
          <ChevronLeft />
          Elegir otra
        </Button>
        <Button variant="brand" size="sm" className="flex-1" loading={sending} onClick={handleSend}>
          {!sending && <Send />}
          Enviar plantilla
        </Button>
      </div>
    </div>
  );
}
