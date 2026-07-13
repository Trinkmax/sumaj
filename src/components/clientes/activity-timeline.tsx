"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Send, StickyNote, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { fmtRelative } from "@/lib/format";
import { ACTIVITY_TYPES } from "@/lib/domain";
import { addContactNote } from "@/lib/actions/contacts";
import { cn } from "@/lib/utils";
import type { ActivityRow } from "./types";

export function ActivityTimeline({
  contactId,
  activities,
}: {
  contactId: string;
  activities: ActivityRow[];
}) {
  const router = useRouter();
  const [note, setNote] = React.useState("");
  const [sending, setSending] = React.useState(false);
  // notas optimistas que todavía no volvieron del server
  const [pending, setPending] = React.useState<{ id: string; body: string; at: string }[]>([]);

  React.useEffect(() => {
    // cuando llegan datos frescos del server, limpiamos las optimistas ya persistidas
    setPending((prev) => prev.filter((p) => !activities.some((a) => a.body === p.body)));
  }, [activities]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = note.trim();
    if (!body) return;

    // optimista: aparece ya
    const temp = { id: `tmp-${Date.now()}`, body, at: new Date().toISOString() };
    setPending((prev) => [temp, ...prev]);
    setNote("");
    setSending(true);

    const res = await addContactNote({ contactId, body });
    setSending(false);
    if (!res.ok) {
      setPending((prev) => prev.filter((p) => p.id !== temp.id));
      setNote(body);
      toast.error(res.error);
      return;
    }
    router.refresh();
  };

  return (
    <section className="card animate-fade-in p-4 md:p-5">
      <h2 className="font-display text-lg font-semibold text-ink">Actividad</h2>

      <form onSubmit={submit} className="mt-3">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Agregá una nota: llamados, pedidos, recordatorios…"
          className="min-h-[68px]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="mt-2 flex justify-end">
          <Button type="submit" size="sm" loading={sending} disabled={!note.trim()}>
            <Send /> Agregar nota
          </Button>
        </div>
      </form>

      {activities.length === 0 && pending.length === 0 ? (
        <p className="mt-4 text-sm text-ink-faint">
          Todavía no hay actividad. La historia de este contacto se va a ir armando sola.
        </p>
      ) : (
        <ol className="mt-4 space-y-0">
          {pending.map((p) => (
            <TimelineItem key={p.id} icon={StickyNote} body={p.body} meta="guardando…" pending />
          ))}
          {activities.map((a) => {
            const meta = ACTIVITY_TYPES[a.type] ?? ACTIVITY_TYPES.sistema;
            return (
              <TimelineItem
                key={a.id}
                icon={meta.icon}
                body={a.body}
                meta={[a.member?.display_name, fmtRelative(a.created_at)]
                  .filter(Boolean)
                  .join(" · ")}
              />
            );
          })}
        </ol>
      )}
    </section>
  );
}

function TimelineItem({
  icon: Icon,
  body,
  meta,
  pending,
}: {
  icon: LucideIcon;
  body: string;
  meta: string;
  pending?: boolean;
}) {
  return (
    <li className={cn("group", pending && "animate-slide-up opacity-70")}>
      <div className="relative flex gap-3 pb-4 group-last:pb-0">
        {/* icono + línea vertical fina */}
        <div className="flex flex-col items-center">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sand-soft text-ink-soft ring-1 ring-line/60">
            <Icon className="size-3.5" strokeWidth={1.9} />
          </span>
          <span className="mt-1 w-px flex-1 bg-line group-last:hidden" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="whitespace-pre-line text-sm text-ink">{body}</p>
          <p className="mt-0.5 text-xs text-ink-faint">{meta}</p>
        </div>
      </div>
    </li>
  );
}
