"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/input";
import { updateFile } from "@/lib/actions/files";
import { cn } from "@/lib/utils";

type SaveState = "idle" | "dirty" | "saving" | "saved";

export function NotesCard({
  fileId,
  notes,
  className,
}: {
  fileId: string;
  notes: string | null;
  className?: string;
}) {
  const [value, setValue] = React.useState(notes ?? "");
  const [state, setState] = React.useState<SaveState>("idle");
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = React.useRef(notes ?? "");

  const save = React.useCallback(
    async (text: string) => {
      if (text === lastSavedRef.current) {
        setState("idle");
        return;
      }
      setState("saving");
      const res = await updateFile({ fileId, notes: text || null });
      if (!res.ok) {
        setState("dirty");
        toast.error(res.error);
        return;
      }
      lastSavedRef.current = text;
      setState("saved");
      setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 2000);
    },
    [fileId],
  );

  const onChange = (text: string) => {
    setValue(text);
    setState("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => save(text), 900);
  };

  const onBlur = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (value !== lastSavedRef.current) save(value);
  };

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <section className={cn("card animate-fade-in p-4 md:p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-ink">Notas</h2>
        <span className="flex items-center gap-1 text-xs text-ink-faint">
          {state === "saving" && (
            <>
              <Loader2 className="size-3 animate-spin" /> Guardando…
            </>
          )}
          {state === "saved" && (
            <span className="flex animate-check-pop items-center gap-1 text-money-text">
              <Check className="size-3" /> Guardado
            </span>
          )}
        </span>
      </div>

      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder="Anotá acá lo importante del file: pedidos especiales, upgrades, recordatorios…"
        className="min-h-[110px]"
        maxLength={4000}
      />
    </section>
  );
}
