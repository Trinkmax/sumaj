"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { TAG_DOTS } from "@/lib/domain";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/misc";
import { toggleContactTag } from "@/lib/actions/leads";
import type { TagOption } from "./types";

/**
 * Chips de etiquetas del contacto + popover para agregar/quitar (optimista).
 */
export function ContactTags({
  contactId,
  leadId,
  initialTags,
  allTags,
}: {
  contactId: string;
  leadId: string;
  initialTags: TagOption[];
  allTags: TagOption[];
}) {
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(initialTags.map((t) => t.id)),
  );

  async function toggle(tag: TagOption) {
    const on = !selected.has(tag.id);
    // optimista
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(tag.id);
      else next.delete(tag.id);
      return next;
    });
    const res = await toggleContactTag({ contactId, tagId: tag.id, on, leadId });
    if (!res.ok) {
      // revertir
      setSelected((prev) => {
        const next = new Set(prev);
        if (on) next.delete(tag.id);
        else next.add(tag.id);
        return next;
      });
      toast.error(res.error);
    }
  }

  const activeTags = allTags.filter((t) => selected.has(t.id));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {activeTags.map((t) => (
        <Badge key={t.id} color={t.color}>
          {t.name}
        </Badge>
      ))}

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Editar etiquetas"
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2 py-0.5 text-[11px] font-medium text-ink-faint transition-colors hover:border-brand-300 hover:text-brand-text tap-highlight-none"
          >
            <Plus className="size-3" />
            Etiqueta
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60 p-2">
          {allTags.length === 0 ? (
            <p className="px-2 py-3 text-center text-[13px] text-ink-faint">
              Todavía no hay etiquetas creadas.
            </p>
          ) : (
            <div className="max-h-64 space-y-0.5 overflow-y-auto">
              {allTags.map((t) => {
                const on = selected.has(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggle(t)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sand-soft tap-highlight-none",
                      on && "bg-sand-soft/60",
                    )}
                  >
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        TAG_DOTS[t.color] ?? TAG_DOTS.gray,
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <Badge color={t.color}>{t.name}</Badge>
                    </span>
                    {on && <Check className="size-4 shrink-0 text-brand-600 animate-check-pop" />}
                  </button>
                );
              })}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
