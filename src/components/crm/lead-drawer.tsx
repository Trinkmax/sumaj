"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { ChevronRight, MessageCircle, ReceiptText, Trophy, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { ACTIVITY_TYPES, QUOTE_STATUSES, STAGES, STAGE_BY_KEY, TRIP_TYPES } from "@/lib/domain";
import { fmtDate, fmtMoney, fmtPhone, fmtRelative, nightsBetween } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { EmptyState, Segmented, Skeleton } from "@/components/ui/misc";
import { EmbeddedChat } from "@/components/chats/embedded-chat";
import { QuoteDialog } from "@/components/quotes/quote-dialog";
import { getLeadConversationId, reassignLead, updateLeadStage } from "@/lib/actions/leads";
import type { LeadStage, TripType } from "@/lib/types";
import { NextActionCard } from "./next-action-card";
import { WinLeadDialog, LoseLeadDialog } from "./win-lose-dialogs";
import type { BoardLead, LeadActivity, LeadQuote, MemberOption } from "./types";

type Tab = "chat" | "ficha";

type FichaData = {
  next_action: string | null;
  next_action_at: string | null;
  trip_date_from: string | null;
  trip_date_to: string | null;
  trip_type: TripType | null;
  budget_estimate: number | null;
  budget_currency: string;
  quotes: LeadQuote[];
  activities: LeadActivity[];
};

/**
 * Drawer operativo del lead: chat de WhatsApp embebido + acciones,
 * sin salir del tablero. Desktop: panel lateral derecho. Mobile: pantalla completa.
 */
export function LeadDrawer({
  lead,
  open,
  onOpenChange,
  members,
  meId,
  isStaff,
  waConnected,
  onLeadChanged,
}: {
  lead: BoardLead | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: MemberOption[];
  meId: string;
  isStaff: boolean;
  waConnected: boolean;
  onLeadChanged: (id: string, patch: Partial<BoardLead>) => void;
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState<Tab>("chat");
  const [conversationId, setConversationId] = React.useState<string | null>(
    lead?.conversation?.id ?? null,
  );
  const [chatLoading, setChatLoading] = React.useState(false);
  const [ficha, setFicha] = React.useState<FichaData | null>(null);
  const [quoteOpen, setQuoteOpen] = React.useState(false);
  const [winOpen, setWinOpen] = React.useState(false);
  const [loseOpen, setLoseOpen] = React.useState(false);

  // reset al cambiar de lead (ajuste de estado durante el render)
  const [prevLeadId, setPrevLeadId] = React.useState<string | null>(lead?.id ?? null);
  if ((lead?.id ?? null) !== prevLeadId) {
    setPrevLeadId(lead?.id ?? null);
    setTab("chat");
    setFicha(null);
    setConversationId(lead?.conversation?.id ?? null);
  }
  // si la conversación aparece por realtime mientras el drawer está abierto
  if (lead?.conversation?.id && conversationId == null) {
    setConversationId(lead.conversation.id);
  }

  // ficha: carga lazy la primera vez que se abre el tab
  React.useEffect(() => {
    if (tab !== "ficha" || ficha != null || !lead) return;
    let cancelled = false;
    const leadId = lead.id;
    (async () => {
      const supabase = createClient();
      const [leadRes, quotesRes, actsRes] = await Promise.all([
        supabase
          .from("leads")
          .select(
            "next_action, next_action_at, trip_date_from, trip_date_to, trip_type, budget_estimate, budget_currency",
          )
          .eq("id", leadId)
          .maybeSingle(),
        supabase
          .from("quotes")
          .select("id, code, total_price, currency, status, created_at")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("activities")
          .select("id, type, body, created_at, member:members(display_name)")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);
      if (cancelled) return;
      setFicha({
        next_action: leadRes.data?.next_action ?? null,
        next_action_at: leadRes.data?.next_action_at ?? null,
        trip_date_from: leadRes.data?.trip_date_from ?? null,
        trip_date_to: leadRes.data?.trip_date_to ?? null,
        trip_type: leadRes.data?.trip_type ?? null,
        budget_estimate:
          leadRes.data?.budget_estimate != null ? Number(leadRes.data.budget_estimate) : null,
        budget_currency: leadRes.data?.budget_currency ?? "USD",
        quotes: (quotesRes.data ?? []).map((q) => ({
          id: q.id,
          code: q.code,
          total_price: Number(q.total_price),
          currency: q.currency,
          status: q.status,
          created_at: q.created_at,
        })),
        activities: (actsRes.data ?? []).map((a) => ({
          id: a.id,
          type: a.type,
          body: a.body,
          created_at: a.created_at,
          author: a.member?.display_name ?? null,
        })),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, ficha, lead]);

  async function changeStage(next: LeadStage) {
    if (!lead || next === lead.stage) return;
    // cierres siempre con confirmación (mismo flujo que el kanban)
    if (next === "ganado") {
      setWinOpen(true);
      return;
    }
    if (next === "perdido") {
      setLoseOpen(true);
      return;
    }
    const prev = lead.stage;
    onLeadChanged(lead.id, { stage: next }); // optimista
    const res = await updateLeadStage({ leadId: lead.id, stage: next });
    if (!res.ok) {
      onLeadChanged(lead.id, { stage: prev });
      toast.error(res.error);
      return;
    }
    toast.success(`Etapa: ${STAGE_BY_KEY[next].label}`);
  }

  async function reassign(memberId: string) {
    if (!lead) return;
    const prevAssigned = lead.assigned_to;
    const prevAssignee = lead.assignee;
    const m = members.find((x) => x.id === memberId) ?? null;
    onLeadChanged(lead.id, {
      assigned_to: memberId || null,
      assignee: m ? { id: m.id, display_name: m.display_name } : null,
    }); // optimista
    const res = await reassignLead({ leadId: lead.id, memberId: memberId || null });
    if (!res.ok) {
      onLeadChanged(lead.id, { assigned_to: prevAssigned, assignee: prevAssignee });
      toast.error(res.error);
    }
  }

  async function openChat() {
    if (!lead) return;
    setChatLoading(true);
    const res = await getLeadConversationId({ contactId: lead.contact.id });
    setChatLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setConversationId(res.data.conversationId);
    if (!lead.conversation) {
      onLeadChanged(lead.id, {
        conversation: {
          id: res.data.conversationId,
          last_message_preview: null,
          last_message_at: null,
          last_inbound_at: null,
          unread_count: 0,
        },
      });
    }
  }

  const stageMeta = lead ? STAGE_BY_KEY[lead.stage] : null;

  return (
    <DialogPrimitive.Root open={open && lead != null} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/30 data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "fixed z-50 flex flex-col bg-cream shadow-2xl focus:outline-none",
            // mobile: pantalla completa
            "inset-0 h-dvh data-[state=open]:animate-slide-up",
            // desktop: panel lateral derecho con slide-in suave
            "md:inset-y-0 md:left-auto md:right-0 md:w-[520px] md:max-w-[92vw] md:border-l md:border-line",
            "md:data-[state=open]:animate-[drawer-in_0.28s_cubic-bezier(0.16,1,0.3,1)_both]",
          )}
        >
          <style>{`@keyframes drawer-in{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>

          {lead && stageMeta && (
            <>
              {/* header */}
              <header className="shrink-0 border-b border-line bg-paper px-4 pb-3 pt-4 md:px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <DialogPrimitive.Title className="truncate font-display text-xl font-semibold tracking-tight text-ink">
                      {lead.contact.full_name}
                    </DialogPrimitive.Title>
                    <DialogPrimitive.Description className="mt-0.5 truncate text-[13px] text-ink-soft">
                      {fmtPhone(lead.contact.phone)}
                      {lead.destination ? ` · ✈️ ${lead.destination}` : ""}
                    </DialogPrimitive.Description>
                  </div>
                  <DialogPrimitive.Close className="-mr-1 shrink-0 rounded-full p-2 text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink">
                    <X className="size-5" />
                    <span className="sr-only">Cerrar</span>
                  </DialogPrimitive.Close>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <Badge className={stageMeta.chip}>{stageMeta.label}</Badge>
                  <Select
                    value={lead.stage}
                    onChange={(e) => changeStage(e.target.value as LeadStage)}
                    aria-label="Cambiar etapa"
                    className="h-8 w-auto rounded-lg px-2.5 pr-8 text-[12px]"
                  >
                    {STAGES.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                  {isStaff && (
                    <Select
                      value={lead.assigned_to ?? ""}
                      onChange={(e) => reassign(e.target.value)}
                      aria-label="Vendedor asignado"
                      className="h-8 w-auto max-w-[150px] rounded-lg px-2.5 pr-8 text-[12px]"
                    >
                      <option value="">Sin asignar</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.display_name}
                          {m.id === meId ? " (yo)" : ""}
                        </option>
                      ))}
                    </Select>
                  )}
                  <Link
                    href={`/crm/${lead.id}`}
                    className="ml-auto shrink-0 text-[12px] font-medium text-brand-700 transition-colors hover:text-brand-800 tap-highlight-none"
                  >
                    Ver ficha completa →
                  </Link>
                </div>
              </header>

              {/* tabs */}
              <div className="shrink-0 border-b border-line bg-paper px-4 py-2 md:px-5">
                <Segmented<Tab>
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: "chat", label: "💬 Chat" },
                    { value: "ficha", label: "📋 Ficha" },
                  ]}
                />
              </div>

              {/* cuerpo */}
              <div className="flex min-h-0 flex-1 flex-col">
                {/* chat: queda montado al cambiar de tab (conserva scroll y realtime) */}
                <div
                  className={cn(
                    "min-h-0 flex-1 flex-col",
                    tab === "chat" ? "flex" : "hidden",
                  )}
                >
                  {conversationId ? (
                    <EmbeddedChat
                      conversationId={conversationId}
                      meId={meId}
                      waConnected={waConnected}
                      onQuoteRequest={() => setQuoteOpen(true)}
                      className="flex-1"
                    />
                  ) : (
                    <div className="flex flex-1 items-center justify-center p-6">
                      <EmptyState
                        emoji="💬"
                        title="Todavía no hay chat"
                        description="Abrí la conversación de WhatsApp y escribile sin salir del tablero."
                        className="w-full"
                        action={
                          <Button variant="whatsapp" onClick={openChat} loading={chatLoading}>
                            <MessageCircle />
                            Abrir chat de WhatsApp
                          </Button>
                        }
                      />
                    </div>
                  )}
                </div>

                {/* ficha compacta */}
                {tab === "ficha" && (
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 md:px-5">
                    {ficha == null ? (
                      <FichaSkeleton />
                    ) : (
                      <>
                        <NextActionCard
                          leadId={lead.id}
                          nextAction={ficha.next_action}
                          nextActionAt={ficha.next_action_at}
                        />

                        {/* datos del viaje (solo lectura) */}
                        <section className="card p-4 animate-fade-in">
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <h3 className="text-[15px] font-semibold text-ink">Datos del viaje</h3>
                            <Link
                              href={`/crm/${lead.id}`}
                              className="text-[13px] font-medium text-brand-700 transition-colors hover:text-brand-800"
                            >
                              Editar →
                            </Link>
                          </div>
                          <dl className="space-y-2.5 text-sm">
                            <FichaRow label="Destino" value={lead.destination} />
                            <FichaRow
                              label="Fechas"
                              value={
                                ficha.trip_date_from
                                  ? `${fmtDate(ficha.trip_date_from)} → ${fmtDate(ficha.trip_date_to)}${
                                      nightsBetween(ficha.trip_date_from, ficha.trip_date_to)
                                        ? ` · ${nightsBetween(ficha.trip_date_from, ficha.trip_date_to)} noches`
                                        : ""
                                    }`
                                  : null
                              }
                            />
                            <FichaRow
                              label="Pasajeros"
                              value={
                                lead.pax_adults + lead.pax_children > 0 ? (
                                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                                    <Users className="size-3.5 text-ink-faint" />
                                    {lead.pax_adults} adultos
                                    {lead.pax_children > 0 && ` + ${lead.pax_children} menores`}
                                  </span>
                                ) : null
                              }
                            />
                            <FichaRow
                              label="Tipo de viaje"
                              value={ficha.trip_type ? TRIP_TYPES[ficha.trip_type] : null}
                            />
                            <FichaRow
                              label="Presupuesto estimado"
                              value={
                                ficha.budget_estimate != null
                                  ? fmtMoney(ficha.budget_estimate, ficha.budget_currency)
                                  : null
                              }
                            />
                          </dl>
                        </section>

                        {/* presupuestos */}
                        <section className="card p-4 animate-fade-in">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <h3 className="text-[15px] font-semibold text-ink">Presupuestos</h3>
                            <button
                              onClick={() => setQuoteOpen(true)}
                              className="text-[13px] font-medium text-brand-700 transition-colors hover:text-brand-800 tap-highlight-none"
                            >
                              + Nuevo
                            </button>
                          </div>
                          {ficha.quotes.length === 0 ? (
                            <p className="py-3 text-center text-[13px] text-ink-faint">
                              Sin presupuestos todavía. Armale uno desde acá 🧾
                            </p>
                          ) : (
                            <ul className="divide-y divide-line/60">
                              {ficha.quotes.map((q) => (
                                <li key={q.id}>
                                  <Link
                                    href={`/presupuestos/${q.id}`}
                                    className="flex min-h-11 items-center justify-between gap-3 py-2 transition-colors hover:bg-sand-soft/50 tap-highlight-none"
                                  >
                                    <span className="text-sm font-medium text-ink">{q.code}</span>
                                    <span className="flex shrink-0 items-center gap-2">
                                      <span className="text-sm font-semibold tabular-nums text-ink">
                                        {fmtMoney(q.total_price, q.currency)}
                                      </span>
                                      <Badge className={QUOTE_STATUSES[q.status].chip}>
                                        {QUOTE_STATUSES[q.status].label}
                                      </Badge>
                                      <ChevronRight className="size-4 text-ink-faint" />
                                    </span>
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>

                        {/* últimas actividades */}
                        <section className="card p-4 animate-fade-in">
                          <h3 className="mb-2 text-[15px] font-semibold text-ink">
                            Última actividad
                          </h3>
                          {ficha.activities.length === 0 ? (
                            <p className="py-3 text-center text-[13px] text-ink-faint">
                              Todavía no pasó nada con este lead.
                            </p>
                          ) : (
                            <ul className="space-y-2.5">
                              {ficha.activities.map((a) => {
                                const meta = ACTIVITY_TYPES[a.type] ?? ACTIVITY_TYPES.nota;
                                return (
                                  <li key={a.id} className="flex items-start gap-2.5">
                                    <span className="mt-px shrink-0 text-[15px] leading-5">
                                      {meta.emoji}
                                    </span>
                                    <div className="min-w-0">
                                      <p className="line-clamp-2 text-[13px] leading-snug text-ink">
                                        {a.body}
                                      </p>
                                      <p className="mt-0.5 text-[11px] text-ink-faint">
                                        {a.author ? `${a.author} · ` : ""}
                                        {fmtRelative(a.created_at)}
                                      </p>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </section>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* footer sticky de acciones */}
              <footer className="shrink-0 border-t border-line bg-paper px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:px-5">
                {lead.stage === "ganado" ? (
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 animate-fade-in">
                    <p className="text-sm font-medium text-emerald-800">🎉 Lead ganado</p>
                    {lead.won_file_id ? (
                      <Link
                        href={`/files/${lead.won_file_id}`}
                        className={buttonVariants({ variant: "success", size: "sm" })}
                      >
                        Ver file
                        <ChevronRight />
                      </Link>
                    ) : null}
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    <Button variant="secondary" onClick={() => setQuoteOpen(true)}>
                      <ReceiptText />
                      <span className="hidden sm:inline">Presupuestar</span>
                      <span className="sm:hidden">Cotizar</span>
                    </Button>
                    <Button variant="success" onClick={() => setWinOpen(true)}>
                      <Trophy />
                      Ganar
                    </Button>
                    <Button
                      variant="secondary"
                      className="text-red-600 hover:border-red-200 hover:bg-red-50"
                      onClick={() => setLoseOpen(true)}
                    >
                      <X />
                      Perder
                    </Button>
                  </div>
                )}
              </footer>

              {/* popups de operación */}
              <QuoteDialog
                open={quoteOpen}
                onOpenChange={setQuoteOpen}
                leadId={lead.id}
                contactId={lead.contact.id}
                conversationId={conversationId}
                onDone={() => {
                  setFicha(null); // la ficha se recarga con el presupuesto nuevo
                  router.refresh();
                }}
              />
              <WinLeadDialog
                open={winOpen}
                onOpenChange={setWinOpen}
                lead={{ id: lead.id, name: lead.contact.full_name }}
                onWon={(fileId) => {
                  onLeadChanged(lead.id, { stage: "ganado", won_file_id: fileId });
                }}
              />
              <LoseLeadDialog
                open={loseOpen}
                onOpenChange={setLoseOpen}
                lead={{ id: lead.id, name: lead.contact.full_name }}
                onLost={() => {
                  onLeadChanged(lead.id, { stage: "perdido" });
                }}
              />
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function FichaRow({ label, value }: { label: string; value: React.ReactNode | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[13px] text-ink-faint">{label}</dt>
      <dd className={cn("text-right", value ? "font-medium text-ink" : "text-ink-faint/60")}>
        {value ?? "—"}
      </dd>
    </div>
  );
}

function FichaSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-40 rounded-2xl" />
      <Skeleton className="h-36 rounded-2xl" />
      <Skeleton className="h-24 rounded-2xl" />
    </div>
  );
}
