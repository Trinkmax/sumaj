"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlarmClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDue } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { setNextAction } from "@/lib/actions/leads";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function NextActionCard({
  leadId,
  nextAction,
  nextActionAt,
}: {
  leadId: string;
  nextAction: string | null;
  nextActionAt: string | null;
}) {
  const router = useRouter();
  const [text, setText] = React.useState(nextAction ?? "");
  const [at, setAt] = React.useState(toLocalInput(nextActionAt));
  const [saving, setSaving] = React.useState(false);

  const dirty = text !== (nextAction ?? "") || at !== toLocalInput(nextActionAt);
  const due = nextActionAt ? fmtDue(nextActionAt) : null;

  function quick(compute: (now: Date) => Date) {
    const d = compute(new Date());
    setAt(toLocalInput(d.toISOString()));
  }

  async function save() {
    setSaving(true);
    const res = await setNextAction({
      leadId,
      nextAction: text.trim() || null,
      nextActionAt: at ? new Date(at).toISOString() : null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(at ? "Seguimiento agendado ⏰" : "Seguimiento guardado");
    router.refresh();
  }

  async function clear() {
    setText("");
    setAt("");
    setSaving(true);
    const res = await setNextAction({ leadId, nextAction: null, nextActionAt: null });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      setText(nextAction ?? "");
      setAt(toLocalInput(nextActionAt));
      return;
    }
    router.refresh();
  }

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <AlarmClock className="size-4 text-brand-600" />
          Próxima acción
        </h2>
        {due && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[12px] font-medium",
              due.overdue
                ? "bg-red-50 text-red-600"
                : due.today
                  ? "bg-amber-50 text-amber-700"
                  : "bg-sand-soft text-ink-soft",
            )}
          >
            {due.label}
          </span>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <Label htmlFor="na-text">Qué hay que hacer</Label>
          <Input
            id="na-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ej: llamarla para cerrar el paquete"
            maxLength={200}
          />
        </div>
        <div>
          <Label htmlFor="na-at">Cuándo</Label>
          <Input
            id="na-at"
            type="datetime-local"
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <QuickChip onClick={() => quick((n) => new Date(n.getTime() + 2 * 3600_000))}>
              +2 h
            </QuickChip>
            <QuickChip
              onClick={() =>
                quick((n) => {
                  const d = new Date(n);
                  d.setDate(d.getDate() + 1);
                  d.setHours(10, 0, 0, 0);
                  return d;
                })
              }
            >
              Mañana 10:00
            </QuickChip>
            <QuickChip
              onClick={() =>
                quick((n) => {
                  const d = new Date(n);
                  d.setDate(d.getDate() + 7);
                  return d;
                })
              }
            >
              +1 semana
            </QuickChip>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          {(nextAction || nextActionAt) && (
            <Button variant="ghost" size="sm" onClick={clear} disabled={saving}>
              Limpiar
            </Button>
          )}
          <Button size="sm" onClick={save} loading={saving} disabled={!dirty && !saving}>
            Guardar
          </Button>
        </div>
      </div>
    </section>
  );
}

function QuickChip({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-line bg-paper px-2.5 py-1 text-[12px] font-medium text-ink-soft transition-all hover:border-brand-300 hover:text-brand-700 active:scale-[0.97] tap-highlight-none"
    >
      {children}
    </button>
  );
}
