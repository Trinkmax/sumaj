"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SendHorizontal } from "lucide-react";
import { ACTIVITY_TYPES } from "@/lib/domain";
import { fmtRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { addLeadNote } from "@/lib/actions/leads";
import type { LeadActivity } from "./types";

/**
 * Historial del lead + composer de nota rápida (optimista).
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
      <h2 className="mb-3 text-[15px] font-semibold text-ink">Historial</h2>

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
          emoji="📝"
          title="Sin actividad todavía"
          description="Las notas, cambios de etapa y presupuestos van a aparecer acá."
          className="py-8"
        />
      ) : (
        <ol className="space-y-3">
          {items.map((a) => {
            const meta = ACTIVITY_TYPES[a.type] ?? ACTIVITY_TYPES.nota;
            return (
              <li key={a.id} className="flex gap-2.5">
                <span className="mt-0.5 shrink-0 text-base leading-none" aria-hidden>
                  {meta.emoji}
                </span>
                <div className="min-w-0 flex-1 border-b border-line/60 pb-3 last:border-0">
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
