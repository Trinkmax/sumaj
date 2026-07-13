"use client";

import * as React from "react";
import { toast } from "sonner";
import { ArrowLeft, SquareUserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { ConversationList } from "@/components/chats/conversation-list";
import { EmbeddedChat } from "@/components/chats/embedded-chat";
import { CONVERSATION_SELECT, type ConversationRow } from "@/components/chats/types";
import { QuoteDialog } from "@/components/quotes/quote-dialog";
import { assignConversation } from "@/lib/actions/messages";
import { STAGE_BY_KEY } from "@/lib/domain";
import { fmtPhone } from "@/lib/format";
import type { LeadStage } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { MemberOption } from "./types";

/** Lo mínimo para el chip de etapa + "Ver lead" del header del hilo. */
type HeaderLead = { id: string; destination: string | null; stage: LeadStage };

/* md+ con useSyncExternalStore: evita montar DOS EmbeddedChat (pane desktop +
   overlay mobile) a la vez — duplicaría queries, realtime y marcado de leído. */
function subscribeMd(cb: () => void) {
  const mq = window.matchMedia("(min-width: 768px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function useMdUp(): boolean {
  return React.useSyncExternalStore(
    subscribeMd,
    () => window.matchMedia("(min-width: 768px)").matches,
    () => false, // SSR: mobile-first
  );
}

/**
 * Bandeja de chats embebida en el CRM: lista de conversaciones + hilo al lado,
 * operable sin salir del tablero. Desktop: card de dos paneles (como /chats).
 * Mobile: la lista ocupa todo y el hilo abre en overlay full-screen.
 */
export function ChatView({
  initialConversations,
  agencyId,
  meId,
  waConnected,
  members,
  initialConversationId,
  onSelectedChange,
  onOpenLead,
}: {
  initialConversations: ConversationRow[];
  agencyId: string;
  meId: string;
  waConnected: boolean;
  members: MemberOption[];
  initialConversationId?: string | null;
  /** El board sincroniza la conversación seleccionada a la URL (?c=). */
  onSelectedChange?: (conversationId: string | null) => void;
  /** Abre el LeadDrawer existente del board (o navega a /crm/{id} si no lo tiene). */
  onOpenLead?: (leadId: string) => void;
}) {
  const mdUp = useMdUp();
  const [selectedId, setSelectedId] = React.useState<string | null>(
    initialConversationId ?? null,
  );
  // conversación fresca (refetch al seleccionar) + lead activo del contacto
  const [conv, setConv] = React.useState<ConversationRow | null>(null);
  const [lead, setLead] = React.useState<HeaderLead | null>(null);
  const [quoteOpen, setQuoteOpen] = React.useState(false);

  const select = React.useCallback(
    (id: string | null) => {
      setSelectedId(id);
      onSelectedChange?.(id);
    },
    [onSelectedChange],
  );

  // reset al cambiar de conversación (ajuste de estado durante el render)
  const [prevSelectedId, setPrevSelectedId] = React.useState(selectedId);
  if (prevSelectedId !== selectedId) {
    setPrevSelectedId(selectedId);
    setConv(null);
    setLead(null);
  }

  /* Al seleccionar: refresca la conversación (asignado puede haber cambiado) y
     carga el lead más reciente en etapas activas del contacto. */
  React.useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .eq("id", selectedId)
        .maybeSingle();
      if (cancelled) return;
      const fresh = (data ?? null) as unknown as ConversationRow | null;
      setConv(fresh);
      if (!fresh?.contact_id) return;
      const { data: leadData } = await supabase
        .from("leads")
        .select("id, destination, stage")
        .eq("contact_id", fresh.contact_id)
        .in("stage", ["nuevo", "contactado", "presupuestado", "negociacion"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setLead(leadData ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // mientras carga el refetch, el header se pinta con la fila de la lista
  const listRow = selectedId
    ? (initialConversations.find((c) => c.id === selectedId) ?? null)
    : null;
  const active = conv ?? listRow;
  const contactName = active?.contact?.full_name ?? "Sin nombre";
  const phone = fmtPhone(active?.contact?.phone ?? active?.wa_id);

  async function handleAssign(memberId: string) {
    if (!selectedId || !active) return;
    const prev = conv;
    const next = memberId ? (members.find((m) => m.id === memberId) ?? null) : null;
    // optimista: el select cambia YA
    setConv({
      ...active,
      assigned_to: memberId || null,
      assignee: next
        ? { id: next.id, display_name: next.display_name, avatar_url: null }
        : null,
    });
    const res = await assignConversation({
      conversationId: selectedId,
      memberId: memberId || null,
    });
    if (!res.ok) {
      setConv(prev);
      toast.error(res.error);
      return;
    }
    toast.success(next ? `Asignada a ${next.display_name}` : "Quedó sin asignar");
  }

  const stageChip = lead && (
    <button
      type="button"
      onClick={() => onOpenLead?.(lead.id)}
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-transform hover:scale-105 tap-highlight-none",
        STAGE_BY_KEY[lead.stage].chip,
      )}
    >
      {STAGE_BY_KEY[lead.stage].label}
    </button>
  );

  return (
    <>
      {/* Altura desktop = 100dvh − offset del layout del CRM:
          PageHeader (md:pt-7 28px + título 30px·1.25 ≈ 38px + subtítulo mt-1 4px + 20px + pb-4 16px ≈ 106px)
          + toolbar (Segmented ≈ 38px + mb-3 12px = 50px) + padding inferior del main (md:pb-8 = 32px) ≈ 188px. */}
      <div className="md:h-[calc(100dvh-188px)] md:min-h-[420px] md:px-6">
        <div className="flex h-full md:overflow-hidden md:rounded-2xl md:border md:border-line md:bg-paper md:shadow-sm">
          {/* lista (mobile: pantalla completa · desktop: panel izquierdo) */}
          <aside className="flex w-full min-w-0 flex-col md:w-[360px] md:shrink-0 md:border-r md:border-line">
            <ConversationList
              initial={initialConversations}
              agencyId={agencyId}
              activeId={selectedId}
              onSelect={select}
            />
          </aside>

          {/* hilo (solo desktop) */}
          <div className="hidden min-w-0 flex-1 md:flex md:flex-col">
            {selectedId ? (
              <>
                <header className="flex shrink-0 items-center gap-2.5 border-b border-line bg-paper px-4 py-2.5">
                  <Avatar name={contactName} className="size-10" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold leading-5 text-ink">
                      {contactName}
                    </p>
                    <p className="truncate text-xs tabular-nums text-ink-faint">{phone}</p>
                  </div>
                  {stageChip}
                  {lead && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onOpenLead?.(lead.id)}
                    >
                      <SquareUserRound />
                      Ver lead
                    </Button>
                  )}
                  <Select
                    value={active?.assigned_to ?? ""}
                    onChange={(e) => handleAssign(e.target.value)}
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
                </header>
                {mdUp && (
                  <EmbeddedChat
                    conversationId={selectedId}
                    meId={meId}
                    waConnected={waConnected}
                    onQuoteRequest={() => setQuoteOpen(true)}
                    className="flex-1"
                  />
                )}
              </>
            ) : (
              /* sin conversación seleccionada */
              <div className="flex flex-1 items-center justify-center chat-bg">
                <div className="flex flex-col items-center gap-3 px-6 text-center animate-fade-in">
                  <div className="flex size-16 items-center justify-center rounded-full border border-line bg-paper text-3xl shadow-sm">
                    💬
                  </div>
                  <p className="font-display text-lg font-semibold text-ink">
                    Elegí una conversación
                  </p>
                  <p className="max-w-xs text-sm text-ink-soft">
                    Seleccioná un chat de la lista para leer y responder por WhatsApp sin
                    salir del CRM.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* mobile: hilo en overlay full-screen */}
      {selectedId && !mdUp && (
        <div className="fixed inset-0 z-50 flex h-dvh flex-col bg-cream animate-slide-up md:hidden">
          <header className="flex shrink-0 items-center gap-2 border-b border-line bg-paper px-2.5 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
            <button
              type="button"
              onClick={() => select(null)}
              aria-label="Volver a la lista de chats"
              className="-ml-0.5 flex size-10 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors active:bg-sand-soft tap-highlight-none"
            >
              <ArrowLeft className="size-5" />
            </button>
            <Avatar name={contactName} className="size-9" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold leading-5 text-ink">
                {contactName}
              </p>
              <p className="truncate text-xs tabular-nums text-ink-faint">{phone}</p>
            </div>
            {stageChip}
          </header>
          <EmbeddedChat
            conversationId={selectedId}
            meId={meId}
            waConnected={waConnected}
            onQuoteRequest={() => setQuoteOpen(true)}
            className="flex-1"
          />
        </div>
      )}

      {/* popup de presupuesto: armalo acá y mandalo a la conversación */}
      <QuoteDialog
        open={quoteOpen}
        onOpenChange={setQuoteOpen}
        leadId={lead?.id ?? null}
        contactId={active?.contact?.id ?? null}
        conversationId={selectedId}
      />
    </>
  );
}
