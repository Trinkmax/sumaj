"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CalendarClock,
  ChevronRight,
  ExternalLink,
  MapPin,
  PencilLine,
  Plus,
  ReceiptText,
  Trophy,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch, Tooltip } from "@/components/ui/misc";
import { setNextAction, updateLeadStage } from "@/lib/actions/leads";
import { toggleFollowups } from "@/lib/actions/crm-panel";
import { QUOTE_STATUSES, STAGES, STAGE_BY_KEY } from "@/lib/domain";
import { fmtDue, fmtMoney, fmtPhone, fmtDate } from "@/lib/format";
import type { LeadStage } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { ContactLite, FileLite, PanelLead, QuoteLite, TagLite } from "./types";

const ACTIVE_STAGES = STAGES.filter((s) => s.active);
const PANEL_LEAD_SELECT =
  "id, destination, stage, next_action, next_action_at, followups_paused, won_file_id";

type PanelData = {
  lead: PanelLead | null;
  tags: TagLite[];
  quotes: QuoteLite[];
  file: FileLite | null;
};

/** ISO → valor para <input type="datetime-local"> en hora local. */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-wa-ink-faint">
      {children}
    </h3>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-6 px-4 py-6">
      <div className="flex flex-col items-center gap-3">
        <div className="size-24 animate-pulse rounded-full bg-wa-panel-alt" />
        <div className="h-4 w-36 animate-pulse rounded bg-wa-panel-alt" />
        <div className="h-3 w-28 animate-pulse rounded bg-wa-panel-alt" />
      </div>
      <div className="space-y-2.5">
        <div className="h-3 w-24 animate-pulse rounded bg-wa-panel-alt" />
        <div className="h-11 w-full animate-pulse rounded-lg bg-wa-panel-alt" />
        <div className="h-11 w-full animate-pulse rounded-lg bg-wa-panel-alt" />
      </div>
      <div className="space-y-2.5">
        <div className="h-3 w-28 animate-pulse rounded bg-wa-panel-alt" />
        <div className="h-14 w-full animate-pulse rounded-lg bg-wa-panel-alt" />
      </div>
    </div>
  );
}

/** Sin contacto no hay nada que cargar: se dice, no se deja girando el skeleton. */
function PanelNoContact() {
  return (
    <div className="px-4 py-6">
      <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-wa-line px-4 py-10 text-center">
        <span className="mb-1 flex size-12 items-center justify-center rounded-full bg-wa-panel-alt text-wa-ink-faint">
          <UserRound className="size-5" strokeWidth={1.75} />
        </span>
        <p className="text-[14px] font-medium text-wa-ink">No pudimos cargar el contacto</p>
        <p className="max-w-[240px] text-[12.5px] leading-relaxed text-wa-ink-faint">
          Puede que el chat ya no exista. Volvé a la lista y elegí otra conversación.
        </p>
      </div>
    </div>
  );
}

/**
 * Panel de herramientas del chat (estilo "info del contacto" de WhatsApp Web):
 * contacto + etiquetas, oportunidad con stepper de etapa, próxima acción,
 * seguimiento automático, presupuestos y file si el lead está ganado.
 * Carga sus datos client-side (con skeletons); no necesita realtime.
 */
export function ChatContextPanel({
  contact,
  onOpenLead,
  onQuoteRequest,
  onLeadStageChange,
  onClose,
  refreshKey = 0,
  showHeader = true,
  className,
}: {
  contact: ContactLite | null;
  onOpenLead?: (leadId: string) => void;
  onQuoteRequest?: () => void;
  /** sincroniza el chip de etapa del header del hilo */
  onLeadStageChange?: (leadId: string, stage: LeadStage) => void;
  onClose?: () => void;
  /** bump para refrescar (p. ej. después de guardar un presupuesto) */
  refreshKey?: number;
  /** false dentro del bottom sheet mobile (el Dialog ya tiene título y scroll) */
  showHeader?: boolean;
  className?: string;
}) {
  const [data, setData] = React.useState<PanelData | null>(null);
  const [savingNext, setSavingNext] = React.useState(false);
  const [editingNext, setEditingNext] = React.useState(false);
  const [nextText, setNextText] = React.useState("");
  const [nextAt, setNextAt] = React.useState("");

  const contactId = contact?.id ?? null;

  /* reset al cambiar de contacto (ajuste de estado durante el render) */
  const [prevContactId, setPrevContactId] = React.useState(contactId);
  if (prevContactId !== contactId) {
    setPrevContactId(contactId);
    setData(null);
    setEditingNext(false);
  }

  React.useEffect(() => {
    void refreshKey; // dep explícita: un bump refetchea sin flashear el skeleton
    if (!contactId) return;
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      const [tagsRes, activeLeadRes] = await Promise.all([
        supabase
          .from("contact_tags")
          .select("tag:tags(id, name, color)")
          .eq("contact_id", contactId),
        supabase
          .from("leads")
          .select(PANEL_LEAD_SELECT)
          .eq("contact_id", contactId)
          .in("stage", ["nuevo", "contactado", "presupuestado", "negociacion"])
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      // sin lead activo: mostramos el último (puede estar ganado → card del file)
      let lead = (activeLeadRes.data ?? null) as PanelLead | null;
      if (!lead) {
        const { data: lastLead } = await supabase
          .from("leads")
          .select(PANEL_LEAD_SELECT)
          .eq("contact_id", contactId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        lead = (lastLead ?? null) as PanelLead | null;
      }

      let quotes: QuoteLite[] = [];
      let file: FileLite | null = null;
      if (lead) {
        const [quotesRes, fileRes] = await Promise.all([
          supabase
            .from("quotes")
            .select(
              "id, code, destination, status, total_price, currency, public_token, valid_until, created_at",
            )
            .eq("lead_id", lead.id)
            .order("created_at", { ascending: false })
            .limit(6),
          lead.won_file_id
            ? supabase
                .from("files")
                .select("id, code, destination, status")
                .eq("id", lead.won_file_id)
                .maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        quotes = (quotesRes.data ?? []) as QuoteLite[];
        file = (fileRes.data ?? null) as FileLite | null;
      }

      if (cancelled) return;
      const tags = ((tagsRes.data ?? []) as unknown as { tag: TagLite | null }[])
        .map((r) => r.tag)
        .filter((t): t is TagLite => t != null);
      setData({ lead, tags, quotes, file });
    })();

    return () => {
      cancelled = true;
    };
  }, [contactId, refreshKey]);

  const lead = data?.lead ?? null;

  /* ── mover de etapa desde el stepper (optimista) ── */
  async function moveStage(stage: LeadStage) {
    if (!lead || stage === lead.stage) return;
    const prev = lead;
    setData((d) => (d ? { ...d, lead: { ...lead, stage } } : d));
    onLeadStageChange?.(lead.id, stage);
    const res = await updateLeadStage({ leadId: lead.id, stage });
    if (!res.ok) {
      setData((d) => (d ? { ...d, lead: prev } : d));
      onLeadStageChange?.(prev.id, prev.stage);
      toast.error(res.error);
      return;
    }
    toast.success(`Movido a ${STAGE_BY_KEY[stage].label}`);
  }

  /* ── próxima acción (edición inline) ── */
  function startEditNext() {
    if (!lead) return;
    setNextText(lead.next_action ?? "");
    setNextAt(toLocalInputValue(lead.next_action_at));
    setEditingNext(true);
  }

  async function saveNext() {
    if (!lead || savingNext) return;
    setSavingNext(true);
    const res = await setNextAction({
      leadId: lead.id,
      nextAction: nextText.trim() || null,
      nextActionAt: nextAt || null,
    });
    setSavingNext(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setData((d) =>
      d && d.lead
        ? {
            ...d,
            lead: {
              ...d.lead,
              next_action: nextText.trim() || null,
              next_action_at: nextAt ? new Date(nextAt).toISOString() : null,
            },
          }
        : d,
    );
    setEditingNext(false);
    toast.success("Seguimiento guardado");
  }

  /* ── seguimiento automático (optimista) ── */
  async function handleFollowups(active: boolean) {
    if (!lead) return;
    const paused = !active;
    const prev = lead.followups_paused;
    setData((d) =>
      d && d.lead ? { ...d, lead: { ...d.lead, followups_paused: paused } } : d,
    );
    const res = await toggleFollowups({ leadId: lead.id, paused });
    if (!res.ok) {
      setData((d) =>
        d && d.lead ? { ...d, lead: { ...d.lead, followups_paused: prev } } : d,
      );
      toast.error(res.error);
    }
  }

  const currentIdx = lead ? ACTIVE_STAGES.findIndex((s) => s.key === lead.stage) : -1;
  const due = lead?.next_action_at ? fmtDue(lead.next_action_at) : null;
  // skeleton SOLO mientras hay algo cargándose de verdad
  const loading = contact != null && data == null;

  return (
    <div className={cn("flex flex-col", className)}>
      {showHeader && (
        <header className="flex h-[59px] shrink-0 items-center gap-2 bg-wa-panel-alt px-3">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar panel de herramientas"
              className="flex size-10 items-center justify-center rounded-full text-wa-ink-soft transition-colors hover:bg-wa-hover active:scale-95 tap-highlight-none"
            >
              <X className="size-5" />
            </button>
          )}
          <p className="text-[16px] font-medium text-wa-ink">Herramientas</p>
        </header>
      )}

      <div className={cn(showHeader && "min-h-0 flex-1 overflow-y-auto overscroll-contain")}>
        {!contact ? (
          <PanelNoContact />
        ) : loading ? (
          <PanelSkeleton />
        ) : (
          <>
            {/* ── 1 · contacto ── */}
            <section className="flex flex-col items-center gap-1.5 px-6 pb-5 pt-6 text-center">
              <Avatar name={contact.full_name} className="mb-1 size-24 text-2xl" />
              <p className="text-[19px] font-medium leading-6 text-wa-ink">
                {contact.full_name}
              </p>
              <p className="text-[14px] tabular-nums text-wa-ink-soft">
                {fmtPhone(contact.phone)}
              </p>
              {(contact.is_client || contact.city) && (
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  {contact.is_client && <Badge color="emerald">Cliente</Badge>}
                  {contact.city && (
                    <span className="text-[12px] text-wa-ink-faint">{contact.city}</span>
                  )}
                </div>
              )}
              <Link
                href={`/clientes/${contact.id}`}
                className="mt-2 inline-flex h-10 items-center gap-1.5 rounded-full border border-wa-line px-4 text-[13px] font-medium text-wa-accent-deep transition-colors hover:bg-wa-hover active:scale-[0.98] tap-highlight-none"
              >
                <UserRound className="size-4" strokeWidth={1.9} />
                Ver ficha
              </Link>
              {data && data.tags.length > 0 && (
                <div className="mt-2.5 flex flex-wrap justify-center gap-1.5">
                  {data.tags.map((t) => (
                    <Badge key={t.id} color={t.color}>
                      {t.name}
                    </Badge>
                  ))}
                </div>
              )}
            </section>

            <div className="h-2 w-full bg-wa-panel-alt/70" aria-hidden />

            {/* ── 2 · oportunidad ── */}
            <section className="space-y-3 px-4 py-4">
              <div className="flex items-center justify-between gap-2">
                <SectionTitle>Oportunidad</SectionTitle>
                {lead && (
                  <button
                    type="button"
                    onClick={() => onOpenLead?.(lead.id)}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-wa-accent-deep transition-colors hover:bg-wa-hover tap-highlight-none"
                  >
                    Abrir lead
                    <ChevronRight className="size-3.5" />
                  </button>
                )}
              </div>

              {!lead ? (
                <p className="rounded-lg border border-dashed border-wa-line px-3 py-3 text-[13px] leading-relaxed text-wa-ink-faint">
                  Este contacto no tiene una oportunidad en el pipeline. Crealo desde la
                  vista Pipeline para seguirlo.
                </p>
              ) : lead.stage === "ganado" ? (
                /* ── 4 · lead ganado → card del file ── */
                <div className="flex items-center gap-3 rounded-xl border border-tone-emerald-line bg-tone-emerald-soft px-3.5 py-3 animate-fade-in">
                  <Trophy className="size-5 shrink-0 text-tone-emerald-text" strokeWidth={1.9} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-tone-emerald-text">
                      Lead ganado
                    </p>
                    <p className="truncate text-[12.5px] text-wa-ink-soft">
                      {data?.file
                        ? `File ${data.file.code} — ${data.file.destination}`
                        : (lead.destination ?? "Venta creada")}
                    </p>
                  </div>
                  {data?.file && (
                    <Link
                      href={`/files/${data.file.id}`}
                      className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-tone-emerald-line px-3 text-[12px] font-medium text-tone-emerald-text transition-colors hover:bg-tone-emerald-line/30 active:scale-[0.97] tap-highlight-none"
                    >
                      Ver file
                      <ExternalLink className="size-3.5" />
                    </Link>
                  )}
                </div>
              ) : lead.stage === "perdido" ? (
                <div className="flex items-center gap-3 rounded-xl border border-tone-stone-line bg-tone-stone-soft px-3.5 py-3">
                  <XCircle className="size-5 shrink-0 text-tone-stone-text" strokeWidth={1.9} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-tone-stone-text">
                      Lead perdido
                    </p>
                    <p className="truncate text-[12.5px] text-wa-ink-soft">
                      {lead.destination ?? "Sin destino"}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* stepper horizontal de etapas activas */}
                  <div className="flex items-center px-0.5" role="group" aria-label="Etapa del lead">
                    {ACTIVE_STAGES.map((s, i) => {
                      const state =
                        i < currentIdx ? "done" : i === currentIdx ? "current" : "todo";
                      return (
                        <React.Fragment key={s.key}>
                          {i > 0 && (
                            <div
                              className={cn(
                                "h-px min-w-3 flex-1",
                                i <= currentIdx ? "bg-wa-accent-deep/50" : "bg-wa-line",
                              )}
                              aria-hidden
                            />
                          )}
                          <Tooltip content={s.label}>
                            <button
                              type="button"
                              onClick={() => moveStage(s.key)}
                              aria-label={`Mover a ${s.label}`}
                              aria-current={state === "current" ? "step" : undefined}
                              className={cn(
                                "flex size-11 shrink-0 items-center justify-center rounded-full border transition-all active:scale-95 tap-highlight-none md:size-10",
                                state === "current" &&
                                  "border-transparent bg-wa-accent-deep text-white shadow-sm",
                                state === "done" &&
                                  "border-wa-accent-deep/40 bg-wa-accent/10 text-wa-accent-deep",
                                state === "todo" &&
                                  "border-wa-line bg-wa-panel text-wa-ink-faint hover:border-wa-ink-faint/40 hover:text-wa-ink-soft",
                              )}
                            >
                              <s.icon className="size-4.5 md:size-4" strokeWidth={2} />
                            </button>
                          </Tooltip>
                        </React.Fragment>
                      );
                    })}
                  </div>
                  <p className="text-center text-[12.5px] text-wa-ink-soft">
                    <span className="font-medium text-wa-ink">
                      {STAGE_BY_KEY[lead.stage].label}
                    </span>
                    {lead.destination && (
                      <span className="inline-flex items-center gap-1 pl-2">
                        <MapPin className="size-3.5 text-wa-ink-faint" />
                        {lead.destination}
                      </span>
                    )}
                  </p>

                  {/* próxima acción — editable inline */}
                  {!editingNext ? (
                    <button
                      type="button"
                      onClick={startEditNext}
                      className="group flex w-full items-start gap-2.5 rounded-lg border border-wa-line px-3 py-2.5 text-left transition-colors hover:bg-wa-hover tap-highlight-none"
                    >
                      <CalendarClock
                        className="mt-0.5 size-4 shrink-0 text-wa-ink-faint"
                        strokeWidth={1.9}
                      />
                      <span className="min-w-0 flex-1">
                        {lead.next_action ? (
                          <>
                            <span className="block truncate text-[13.5px] text-wa-ink">
                              {lead.next_action}
                            </span>
                            {due && (
                              <span
                                className={cn(
                                  "text-[12px]",
                                  due.overdue
                                    ? "font-medium text-tone-red-text"
                                    : "text-wa-ink-faint",
                                )}
                              >
                                {due.label}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-[13.5px] text-wa-ink-faint">
                            Agendar próxima acción…
                          </span>
                        )}
                      </span>
                      <PencilLine className="mt-0.5 size-3.5 shrink-0 text-wa-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  ) : (
                    <div className="space-y-2 rounded-lg border border-wa-line p-3 animate-fade-in">
                      <input
                        value={nextText}
                        onChange={(e) => setNextText(e.target.value)}
                        placeholder="Ej: Llamarla por el paquete a Río"
                        aria-label="Próxima acción"
                        maxLength={200}
                        className="h-10 w-full rounded-lg bg-wa-panel-alt px-3 text-[13.5px] text-wa-ink outline-none placeholder:text-wa-ink-faint focus:ring-2 focus:ring-wa-accent-deep/30"
                      />
                      <input
                        type="datetime-local"
                        value={nextAt}
                        onChange={(e) => setNextAt(e.target.value)}
                        aria-label="Fecha del seguimiento"
                        className="h-10 w-full rounded-lg bg-wa-panel-alt px-3 text-[13.5px] tabular-nums text-wa-ink outline-none focus:ring-2 focus:ring-wa-accent-deep/30"
                      />
                      <div className="flex items-center gap-2 pt-0.5">
                        <button
                          type="button"
                          onClick={() => setEditingNext(false)}
                          disabled={savingNext}
                          className="h-9 rounded-lg px-3 text-[13px] font-medium text-wa-ink-soft transition-colors hover:bg-wa-hover disabled:opacity-50 tap-highlight-none"
                        >
                          Cancelar
                        </button>
                        <Button
                          variant="whatsapp"
                          size="sm"
                          className="h-9 flex-1 rounded-lg"
                          loading={savingNext}
                          onClick={saveNext}
                        >
                          Guardar
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* seguimiento automático */}
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-wa-line px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium text-wa-ink">
                        Seguimiento automático
                      </p>
                      <p className="text-[12px] text-wa-ink-faint">
                        {lead.followups_paused
                          ? "Pausado para este lead"
                          : "Recordatorios activos"}
                      </p>
                    </div>
                    <Switch
                      checked={!lead.followups_paused}
                      onCheckedChange={handleFollowups}
                      aria-label="Seguimiento automático"
                    />
                  </div>
                </>
              )}
            </section>

            <div className="h-2 w-full bg-wa-panel-alt/70" aria-hidden />

            {/* ── 3 · presupuestos del lead ── */}
            <section className="space-y-2 px-4 py-4 pb-6">
              <div className="flex items-center justify-between gap-2">
                <SectionTitle>Presupuestos</SectionTitle>
                {data && data.quotes.length > 0 && (
                  <span className="text-[12px] tabular-nums text-wa-ink-faint">
                    {data.quotes.length}
                  </span>
                )}
              </div>

              {!lead || !data || data.quotes.length === 0 ? (
                <p className="px-0.5 text-[13px] text-wa-ink-faint">
                  {lead
                    ? "Todavía no le armaste un presupuesto."
                    : "Los presupuestos aparecen acá cuando el contacto tiene un lead."}
                </p>
              ) : (
                <div className="-mx-1">
                  {data.quotes.map((q) => {
                    const st = QUOTE_STATUSES[q.status];
                    return (
                      <Link
                        key={q.id}
                        href={`/presupuestos/${q.id}`}
                        className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-wa-hover active:bg-wa-active tap-highlight-none"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-wa-panel-alt text-wa-ink-soft">
                          <ReceiptText className="size-4" strokeWidth={1.9} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="text-[13.5px] font-medium text-wa-ink">
                              {q.code}
                            </span>
                            <span
                              className={cn(
                                "rounded-full border px-1.5 py-px text-[10px] font-medium leading-4",
                                st.chip,
                              )}
                            >
                              {st.label}
                            </span>
                          </span>
                          <span className="block truncate text-[12.5px] tabular-nums text-wa-ink-faint">
                            {fmtMoney(q.total_price, q.currency)} · {fmtDate(q.created_at)}
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-wa-ink-faint" />
                      </Link>
                    );
                  })}
                </div>
              )}

              {onQuoteRequest && lead && lead.stage !== "perdido" && (
                <button
                  type="button"
                  onClick={onQuoteRequest}
                  className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-wa-accent-deep/40 text-[13.5px] font-medium text-wa-accent-deep transition-colors hover:bg-wa-accent/10 active:scale-[0.99] tap-highlight-none"
                >
                  <Plus className="size-4" strokeWidth={2} />
                  Armar presupuesto
                </button>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
