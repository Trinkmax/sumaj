"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlarmClock,
  MessageCircleOff,
  MessageCircleReply,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch, EmptyState } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/config/confirm-dialog";
import {
  createFollowupRule,
  deleteFollowupRule,
  updateFollowupRule,
} from "@/lib/actions/settings";
import { STAGES, STAGE_BY_KEY } from "@/lib/domain";
import type { LeadStage, Tables } from "@/lib/types";
import { cn } from "@/lib/utils";

type Rule = Tables<"followup_rules">;
type Row = Rule & { hoursDraft: string };

/** Etapas en las que app.enqueue_followups() encola (ver 0006_automation.sql). */
const ENQUEUED_STAGES: LeadStage[] = ["contactado", "presupuestado", "negociacion"];

/** Espejo del tope de createFollowupRule: no ofrecemos un botón que va a fallar. */
const MAX_TOUCHES = 6;

const toRow = (r: Rule): Row => ({ ...r, hoursDraft: String(r.hours_after_silence) });

function fmtHours(h: number): string {
  if (h >= 72 && h % 24 === 0) return `${h / 24} días`;
  if (h >= 72) return `${Math.round(h / 24)} días`;
  return `${h} h`;
}

/** "contactado y presupuestado" — para nombrar etapas dentro de una oración. */
function stageList(stages: LeadStage[]): string {
  const labels = stages.map((s) => STAGE_BY_KEY[s].label.toLowerCase());
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1]}`;
}

/** Aviso de que el toque, así configurado, no va a salir. */
function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 flex items-start gap-2 rounded-xl border border-tone-amber-line bg-tone-amber-soft px-3.5 py-2.5 text-[12px] leading-relaxed text-tone-amber-text animate-fade-in">
      <TriangleAlert className="mt-px size-3.5 shrink-0" strokeWidth={1.9} />
      <span>{children}</span>
    </p>
  );
}

export function FollowupRules({
  rules,
  approvedStages,
  hasGenericTemplate,
}: {
  rules: Rule[];
  /** etapas con al menos una plantilla aprobada */
  approvedStages: LeadStage[];
  /** hay una plantilla aprobada sin etapa: sirve para cualquier lead */
  hasGenericTemplate: boolean;
}) {
  const [state, setState] = React.useState(() => rules.map(toRow));
  const [adding, setAdding] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<Row | null>(null);

  /**
   * Etapas del toque que realmente se programan y, de esas, las que no tienen
   * plantilla aprobada: sin plantilla el seguimiento se encola con template_id
   * null y la edge function lo cancela, así que nunca le llega nada al cliente.
   */
  function alcance(rule: Row) {
    const programadas = rule.applies_to_stages.filter((s) => ENQUEUED_STAGES.includes(s));
    return {
      programadas,
      sinPlantilla: hasGenericTemplate
        ? []
        : programadas.filter((s) => !approvedStages.includes(s)),
    };
  }

  function patch(id: string, p: Partial<Row>) {
    setState((s) => s.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  async function addTouch() {
    // el toque nuevo entra después del último: 48 h el primero, ×3 de ahí en más
    const maxHours = state.reduce((m, r) => Math.max(m, r.hours_after_silence), 0);
    const hours = maxHours === 0 ? 48 : Math.min(maxHours * 3, 2160);

    setAdding(true);
    const res = await createFollowupRule({
      hours_after_silence: hours,
      applies_to_stages: ENQUEUED_STAGES,
    });
    setAdding(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setState((s) => [...s, toRow(res.data)]);
    toast.success(`Toque ${res.data.touch_number}: a las ${fmtHours(hours)} de silencio.`);
  }

  async function saveHours(rule: Row) {
    const n = Math.round(Number(rule.hoursDraft.replace(",", ".")));
    if (isNaN(n) || n < 1 || n > 2160) {
      toast.error("Poné una cantidad de horas entre 1 y 2160.");
      patch(rule.id, { hoursDraft: String(rule.hours_after_silence) });
      return;
    }
    if (n === rule.hours_after_silence) {
      patch(rule.id, { hoursDraft: String(n) });
      return;
    }
    const prev = rule.hours_after_silence;
    patch(rule.id, { hours_after_silence: n, hoursDraft: String(n) }); // optimista
    const res = await updateFollowupRule({ id: rule.id, hours_after_silence: n });
    if (!res.ok) {
      patch(rule.id, { hours_after_silence: prev, hoursDraft: String(prev) });
      toast.error(res.error);
      return;
    }
    toast.success(`Toque ${rule.touch_number}: ahora a las ${fmtHours(n)} de silencio.`);
  }

  async function toggleStage(rule: Row, stage: LeadStage) {
    const has = rule.applies_to_stages.includes(stage);
    const next = has
      ? rule.applies_to_stages.filter((s) => s !== stage)
      : [...rule.applies_to_stages, stage];
    if (next.length === 0) {
      toast.error("Dejá al menos una etapa.");
      return;
    }
    const prev = rule.applies_to_stages;
    patch(rule.id, { applies_to_stages: next }); // optimista
    const res = await updateFollowupRule({ id: rule.id, applies_to_stages: next });
    if (!res.ok) {
      patch(rule.id, { applies_to_stages: prev });
      toast.error(res.error);
    }
  }

  async function toggleActive(rule: Row, next: boolean) {
    const prev = rule.is_active;
    patch(rule.id, { is_active: next }); // optimista
    const res = await updateFollowupRule({ id: rule.id, is_active: next });
    if (!res.ok) {
      patch(rule.id, { is_active: prev });
      toast.error(res.error);
    }
  }

  if (state.length === 0) {
    return (
      <EmptyState
        icon={AlarmClock}
        title="Todavía no hay toques"
        description="Sin toques, un lead que deja de responder no vuelve a recibir nada. Armá el primero y después lo ajustás."
        action={
          <Button onClick={addTouch} loading={adding}>
            <Plus />
            Agregar el primer toque
          </Button>
        }
      />
    );
  }

  // la línea de tiempo va en orden cronológico: es un eje de horas, no de números
  const activeSorted = [...state]
    .filter((r) => r.is_active)
    .sort((a, b) => a.hours_after_silence - b.hours_after_silence || a.touch_number - b.touch_number);

  return (
    <div className="space-y-4">
      {/* Cadencia: línea de tiempo horizontal */}
      <section className="card p-5 animate-slide-up">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-text">
              <MessageCircleReply className="size-4.5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-ink">Cadencia de toques</h2>
              <p className="text-sm text-ink-soft">
                Si el cliente no responde, viajerOS reabre la charla solo con una plantilla según la etapa.
              </p>
            </div>
          </div>
          {state.length < MAX_TOUCHES ? (
            <Button onClick={addTouch} loading={adding} className="shrink-0">
              <Plus />
              <span className="hidden sm:inline">Agregar toque</span>
              <span className="sm:hidden">Agregar</span>
            </Button>
          ) : (
            <p className="shrink-0 text-xs text-ink-faint">
              Son {MAX_TOUCHES} toques: el máximo.
            </p>
          )}
        </div>

        {activeSorted.length > 0 ? (
          <div className="mt-5 overflow-x-auto pb-1 scrollbar-none">
            <div className="flex min-w-max items-start px-1 stagger-children">
              {/* Nodo inicial: el silencio del cliente */}
              <div className="flex w-[72px] shrink-0 flex-col items-center gap-1.5 text-center">
                <span className="flex size-9 items-center justify-center rounded-full border border-line bg-sand-soft text-ink-faint">
                  <MessageCircleOff className="size-4" strokeWidth={1.75} />
                </span>
                <span className="text-[11px] font-medium text-ink">Silencio</span>
                <span className="text-[10px] leading-tight text-ink-faint">del cliente</span>
              </div>

              {activeSorted.map((r) => (
                <React.Fragment key={r.id}>
                  <div className="mt-[17px] h-px w-8 shrink-0 bg-line-strong sm:w-14" aria-hidden />
                  <div className="flex w-[76px] shrink-0 flex-col items-center gap-1.5 text-center">
                    <span className="flex size-9 items-center justify-center rounded-full border border-brand-tint-line bg-brand-tint text-brand-text">
                      <AlarmClock className="size-4" strokeWidth={1.75} />
                    </span>
                    <span className="whitespace-nowrap text-xs font-semibold text-ink tabular-nums">
                      {fmtHours(r.hours_after_silence)}
                    </span>
                    <span className="whitespace-nowrap text-[10px] leading-tight text-ink-faint">
                      Toque {r.touch_number}
                    </span>
                  </div>
                </React.Fragment>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-faint">
            Todos los toques están apagados: nadie recibe seguimientos automáticos.
          </p>
        )}
      </section>

      {/* Reglas editables */}
      <div className="space-y-3 stagger-children">
        {[...state]
          .sort((a, b) => a.touch_number - b.touch_number)
          .map((rule) => {
            const stageOptions = STAGES.filter(
              (s) => s.active || rule.applies_to_stages.includes(s.key),
            );
            const { programadas, sinPlantilla } = alcance(rule);
            return (
              <section
                key={rule.id}
                className={cn(
                  "card p-5 transition-opacity",
                  !rule.is_active && "opacity-60",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
                        rule.is_active
                          ? "bg-brand-tint text-brand-text"
                          : "bg-sand-soft text-ink-faint",
                      )}
                    >
                      <AlarmClock className="size-4" strokeWidth={1.75} />
                    </span>
                    <h3 className="truncate font-medium text-ink">
                      Toque {rule.touch_number}
                      <span className="ml-2 text-sm font-normal text-ink-faint">
                        a las {fmtHours(rule.hours_after_silence)} de silencio
                      </span>
                    </h3>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      checked={rule.is_active}
                      onCheckedChange={(v) => toggleActive(rule, v)}
                      aria-label={`Toque ${rule.touch_number} activo`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 text-tone-red-text hover:bg-tone-red-soft sm:size-9"
                      onClick={() => setToDelete(rule)}
                      aria-label={`Quitar el toque ${rule.touch_number}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-4">
                  <div>
                    <label
                      htmlFor={`rule-h-${rule.id}`}
                      className="mb-1.5 block text-[13px] font-medium text-ink-soft"
                    >
                      Horas de silencio
                    </label>
                    <div className="relative">
                      <Input
                        id={`rule-h-${rule.id}`}
                        value={rule.hoursDraft}
                        onChange={(e) => patch(rule.id, { hoursDraft: e.target.value })}
                        onBlur={() => saveHours(rule)}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                        inputMode="numeric"
                        disabled={!rule.is_active}
                        className="h-10 w-[110px] pr-8 text-right tabular-nums"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-faint">
                        h
                      </span>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <p className="mb-1.5 text-[13px] font-medium text-ink-soft">Aplica en etapas</p>
                    <div className="flex flex-wrap gap-1.5">
                      {stageOptions.map((s) => {
                        const on = rule.applies_to_stages.includes(s.key);
                        return (
                          <button
                            key={s.key}
                            type="button"
                            disabled={!rule.is_active}
                            onClick={() => toggleStage(rule, s.key)}
                            aria-pressed={on}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-all tap-highlight-none active:scale-95 disabled:pointer-events-none",
                              on ? s.chip : "border-line bg-paper text-ink-faint hover:border-line-strong",
                            )}
                          >
                            <span className={cn("size-1.5 rounded-full", on ? s.dot : "bg-line-strong")} />
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {programadas.length === 0 ? (
                  <Aviso>
                    El seguimiento automático solo corre en {stageList(ENQUEUED_STAGES)}: con estas
                    etapas el toque no se programa nunca.
                  </Aviso>
                ) : sinPlantilla.length > 0 ? (
                  <Aviso>
                    No hay plantilla aprobada para {stageList(sinPlantilla)}: el toque se programa
                    pero no llega a salir.{" "}
                    <Link href="/config/plantillas" className="font-medium underline">
                      Cargar plantilla
                    </Link>
                  </Aviso>
                ) : null}
              </section>
            );
          })}
      </div>

      <p className="px-1 text-xs text-ink-faint">
        Los toques se cancelan solos apenas el cliente responde. La plantilla que se envía es la de la
        etapa del lead (o una genérica).
      </p>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={toDelete ? `¿Quitar el toque ${toDelete.touch_number}?` : ""}
        description="Dejamos de programarlo de acá en adelante. Los seguimientos que ya estaban en la cola salen igual."
        confirmLabel="Quitar"
        onConfirm={async () => {
          if (!toDelete) return;
          const res = await deleteFollowupRule({ id: toDelete.id });
          if (!res.ok) {
            toast.error(res.error);
          } else {
            setState((s) => s.filter((r) => r.id !== toDelete.id));
            toast.success(`Toque ${toDelete.touch_number} quitado.`);
          }
          setToDelete(null);
        }}
      />
    </div>
  );
}
