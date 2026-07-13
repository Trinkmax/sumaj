"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { History, SendHorizontal, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACTIVITY_TYPES } from "@/lib/domain";
import { fmtRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { addLeadNote } from "@/lib/actions/leads";
import type { LeadActivity } from "./types";

/**
 * Historial del lead + composer de nota rápida (optimista).
 * Línea vertical fina con el icono de cada tipo de actividad como nodo.
 */
export function LeadTimeline({
  leadId,
  activities,
  meName,
}: {
  leadId: string;
  activities: LeadActivity[];
  meName: string;
}) {
  const router = useRouter();
  const [items, setItems] = React.useState<LeadActivity[]>(activities);
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);

  // resync con el server (ajuste de estado durante el render)
  const [prevActivities, setPrevActivities] = React.useState(activities);
  if (prevActivities !== activities) {
    setPrevActivities(activities);
    setItems(activities);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;

    // optimista: la nota aparece YA
    const temp: LeadActivity = {
      id: `temp-${Date.now()}`,
      type: "nota",
      body,
      created_at: new Date().toISOString(),
      author: meName,
    };
    setItems((prev) => [temp, ...prev]);
    setDraft("");
    setSending(true);

    const res = await addLeadNote({ leadId, body });
    setSending(false);
    if (!res.ok) {
      setItems((prev) => prev.filter((a) => a.id !== temp.id));
      setDraft(body);
      toast.error(res.error);
      return;
    }
    setItems((prev) =>
      prev.map((a) =>
        a.id === temp.id ? { ...a, id: res.data.id, created_at: res.data.created_at } : a,
      ),
    );
    router.refresh();
  }

  return (
    <section className="card p-4">
      <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-ink">
        <History className="size-4 text-brand-600" strokeWidth={1.75} />
        Historial
      </h2>

      <form onSubmit={submit} className="mb-4 flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Agregar una nota…"
          aria-label="Nueva nota"
          maxLength={2000}
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Guardar nota"
          disabled={!draft.trim() || sending}
        >
          <SendHorizontal />
        </Button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          icon={StickyNote}
          title="Sin actividad todavía"
          description="Las notas, cambios de etapa y presupuestos van a aparecer acá."
          className="py-8"
        />
      ) : (
        <ol className="relative">
          {/* línea vertical fina detrás de los nodos */}
          <span
            aria-hidden
            className="absolute bottom-2 left-[13px] top-2 w-px bg-line"
          />
          {items.map((a) => {
            const meta = ACTIVITY_TYPES[a.type] ?? ACTIVITY_TYPES.nota;
            const isTemp = a.id.startsWith("temp-");
            return (
              <li
                key={a.id}
                className={cn("relative flex gap-3 pb-4 last:pb-0", isTemp && "animate-fade-in")}
              >
                <span
                  className="relative z-10 mt-px flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-sand-soft text-ink-faint"
                  title={meta.label}
                >
                  <meta.icon className="size-3.5" strokeWidth={1.75} />
                </span>
                <div className={cn("min-w-0 flex-1 pt-0.5", isTemp && "opacity-70")}>
                  <p className="whitespace-pre-wrap break-words text-[13.5px] leading-snug text-ink">
                    {a.body}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-faint">
                    {fmtRelative(a.created_at)}
                    {a.author ? ` · ${a.author}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
