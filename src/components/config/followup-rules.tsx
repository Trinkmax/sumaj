"use client";

import * as React from "react";
import { toast } from "sonner";
import { MessageCircleReply } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch, EmptyState } from "@/components/ui/misc";
import { updateFollowupRule } from "@/lib/actions/settings";
import { STAGES } from "@/lib/domain";
import type { LeadStage, Tables } from "@/lib/types";
import { cn } from "@/lib/utils";

type Rule = Tables<"followup_rules">;

function fmtHours(h: number): string {
  if (h >= 72 && h % 24 === 0) return `${h / 24} días`;
  if (h >= 72) return `${Math.round(h / 24)} días`;
  return `${h} h`;
}

export function FollowupRules({ rules }: { rules: Rule[] }) {
  const [state, setState] = React.useState(
    rules.map((r) => ({
      ...r,
      hoursDraft: String(r.hours_after_silence),
    })),
  );

  function patch(id: string, p: Partial<(typeof state)[number]>) {
    setState((s) => s.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  async function saveHours(rule: (typeof state)[number]) {
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

  async function toggleStage(rule: (typeof state)[number], stage: LeadStage) {
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

  async function toggleActive(rule: (typeof state)[number], next: boolean) {
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
        emoji="⏰"
        title="No hay reglas de seguimiento"
        description="Las reglas se crean con la agencia. Si no las ves, avisale a soporte."
      />
    );
  }

  const activeSorted = [...state]
    .filter((r) => r.is_active)
    .sort((a, b) => a.touch_number - b.touch_number);

  return (
    <div className="space-y-4">
      {/* Cadencia: mini línea de tiempo */}
      <section className="card p-5 animate-slide-up">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <MessageCircleReply className="size-4.5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Cadencia de toques</h2>
            <p className="text-sm text-ink-soft">
              Si el cliente no responde, viajerOS reabre la charla solo con una plantilla según la etapa.
            </p>
          </div>
        </div>

        {activeSorted.length > 0 ? (
          <div className="mt-5 overflow-x-auto pb-1">
            <div className="flex min-w-max items-center px-1">
              <div className="flex flex-col items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-ink" />
                <span className="whitespace-nowrap text-xs font-medium text-ink">Silencio</span>
              </div>
              {activeSorted.map((r) => (
                <React.Fragment key={r.id}>
                  <span className="mx-1 h-px w-10 shrink-0 bg-line-strong sm:w-16" />
                  <div className="flex flex-col items-center gap-1.5">
                    <span className="size-2.5 rounded-full bg-brand-500" />
                    <span className="whitespace-nowrap text-xs font-medium text-ink tabular-nums">
                      {fmtHours(r.hours_after_silence)}
                    </span>
                    <span className="whitespace-nowrap text-[11px] text-ink-faint">
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
      <div className="space-y-3">
        {[...state]
          .sort((a, b) => a.touch_number - b.touch_number)
          .map((rule) => {
            const stageOptions = STAGES.filter(
              (s) => s.active || rule.applies_to_stages.includes(s.key),
            );
            return (
              <section
                key={rule.id}
                className={cn(
                  "card p-5 transition-opacity animate-fade-in",
                  !rule.is_active && "opacity-60",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium text-ink">
                    Toque {rule.touch_number}
                    <span className="ml-2 text-sm font-normal text-ink-faint">
                      a las {fmtHours(rule.hours_after_silence)} de silencio
                    </span>
                  </h3>
                  <Switch
                    checked={rule.is_active}
                    onCheckedChange={(v) => toggleActive(rule, v)}
                    aria-label={`Toque ${rule.touch_number} activo`}
                  />
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
              </section>
            );
          })}
      </div>

      <p className="px-1 text-xs text-ink-faint">
        Los toques se cancelan solos apenas el cliente responde. La plantilla que se envía es la de la
        etapa del lead (o una genérica).
      </p>
    </div>
  );
}
