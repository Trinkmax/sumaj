"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  MessageCircle,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/avatar";
import { Select } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/misc";
import { ConversationList } from "@/components/chats/conversation-list";
import { EmbeddedChat } from "@/components/chats/embedded-chat";
import { ChatContextPanel } from "@/components/chats/chat-context-panel";
import { CONVERSATION_SELECT, type ConversationRow } from "@/components/chats/types";
import { QuoteDialog } from "@/components/quotes/quote-dialog";
import { assignConversation } from "@/lib/actions/messages";
import { STAGE_BY_KEY } from "@/lib/domain";
import { fmtPhone, fmtRelative } from "@/lib/format";
import type { LeadStage } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { MemberOption } from "./types";

/** Lo mínimo para el chip de etapa del header del hilo. */
type HeaderLead = { id: string; destination: string | null; stage: LeadStage };

const PANEL_KEY = "crm:chat-panel";

/* Breakpoints con useSyncExternalStore: evita montar DOS EmbeddedChat
   (pane desktop + overlay mobile) a la vez — duplicaría queries, realtime
   y marcado de leído. SSR devuelve false = mobile-first. */
function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const subscribe = React.useCallback(
    (cb: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    [query],
  );
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Vista Chats del CRM: clon de WhatsApp Web en tres zonas edge-to-edge
 * (lista · hilo con wallpaper · panel de herramientas), con los tokens wa-*.
 * Desktop: panel colapsable persistido. Mobile: lista full-screen, hilo en
 * overlay y herramientas en bottom sheet.
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
  toolbar,
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
  /** Acciones del CRM para el header del panel de chats (switcher de vistas, etc.). */
  toolbar?: React.ReactNode;
}) {
  const mdUp = useMinWidth(768);
  const lgUp = useMinWidth(1024);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    initialConversationId ?? null,
  );
  // conversación fresca (refetch al seleccionar) + lead activo del contacto
  const [conv, setConv] = React.useState<ConversationRow | null>(null);
  const [lead, setLead] = React.useState<HeaderLead | null>(null);
  const [quoteOpen, setQuoteOpen] = React.useState(false);
  // panel de herramientas: aside colapsable en lg+, bottom sheet abajo
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [panelRefresh, setPanelRefresh] = React.useState(0);

  /* preferencia persistida del panel (default: abierto en pantallas anchas) */
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(PANEL_KEY);
      const shouldOpen =
        saved === "open" ||
        (saved == null && window.matchMedia("(min-width: 1280px)").matches);
      // lectura única de un sistema externo al montar (el primer render es SSR)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (shouldOpen) setPanelOpen(true);
    } catch {
      // sin localStorage queda cerrado
    }
  }, []);

  const togglePanel = React.useCallback(() => {
    if (!lgUp) {
      setSheetOpen(true);
      return;
    }
    setPanelOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem(PANEL_KEY, next ? "open" : "closed");
      } catch {
        // ignorar (modo privado, etc.)
      }
      return next;
    });
  }, [lgUp]);

  const select = React.useCallback(
    (id: string | null) => {
      setSelectedId(id);
      onSelectedChange?.(id);
    },
    [onSelectedChange],
  );

  /* navegación externa (⌘K, redirects) mientras el board ya está montado:
     si cambia el prop, la selección lo sigue (ajuste durante el render) */
  const [prevInitialConv, setPrevInitialConv] = React.useState(
    initialConversationId ?? null,
  );
  if ((initialConversationId ?? null) !== prevInitialConv) {
    setPrevInitialConv(initialConversationId ?? null);
    if (initialConversationId) setSelectedId(initialConversationId);
  }

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
  const headerMeta = active?.last_message_at
    ? `últ. mensaje ${fmtRelative(active.last_message_at)}`
    : phone;

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

  /* el stepper del panel mueve la etapa → el chip del header acompaña */
  const syncLeadStage = React.useCallback((leadId: string, stage: LeadStage) => {
    setLead((l) => (l && l.id === leadId ? { ...l, stage } : l));
  }, []);

  const stageChip = lead && (
    <button
      type="button"
      onClick={() => onOpenLead?.(lead.id)}
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-transform hover:scale-105 tap-highlight-none animate-fade-in",
        STAGE_BY_KEY[lead.stage].chip,
      )}
    >
      {STAGE_BY_KEY[lead.stage].label}
    </button>
  );

  const panelShown = lgUp && panelOpen;

  const panelToggle = (
    <Tooltip content={panelShown ? "Ocultar herramientas" : "Herramientas del lead"}>
      <button
        type="button"
        onClick={togglePanel}
        aria-pressed={panelShown}
        aria-label="Panel de herramientas"
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full transition-colors active:scale-95 tap-highlight-none",
          panelShown
            ? "bg-wa-active text-wa-ink"
            : "text-wa-ink-soft hover:bg-wa-hover",
        )}
      >
        {panelShown ? (
          <PanelRightClose className="size-5" strokeWidth={1.9} />
        ) : (
          <PanelRightOpen className="size-5" strokeWidth={1.9} />
        )}
      </button>
    </Tooltip>
  );

  const activeContact = active?.contact ?? null;

  return (
    <>
      {/* Debajo de la barra del CRM (57px), el clon ocupa todo el resto de la
          pantalla. El -mb-8 absorbe el padding inferior del main. */}
      <div className="md:-mb-8 md:h-[calc(100dvh-57px)]">
        <div className="flex h-full bg-wa-panel max-md:min-h-[calc(100dvh-190px)] md:overflow-hidden">
          {/* ── zona 1 · lista (mobile: pantalla completa · desktop: 340–380px) ── */}
          <aside className="flex w-full min-w-0 flex-col md:w-[340px] md:shrink-0 md:border-r md:border-wa-line xl:w-[380px]">
            <ConversationList
              initial={initialConversations}
              agencyId={agencyId}
              activeId={selectedId}
              onSelect={select}
              toolbar={toolbar}
            />
          </aside>

          {/* ── zona 2 · hilo (solo desktop) ── */}
          <div className="hidden min-w-0 flex-1 md:flex md:flex-col">
            {selectedId ? (
              <>
                <header className="flex h-[59px] shrink-0 items-center gap-2.5 border-b border-wa-line bg-wa-panel-alt px-3 lg:px-4">
                  <Avatar name={contactName} className="size-10" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium leading-5 text-wa-ink">
                      {contactName}
                    </p>
                    <p className="truncate text-[12px] text-wa-ink-soft">{headerMeta}</p>
                  </div>
                  {stageChip}
                  <Select
                    value={active?.assigned_to ?? ""}
                    onChange={(e) => handleAssign(e.target.value)}
                    aria-label="Vendedor asignado"
                    className="h-9 w-auto max-w-[150px] rounded-lg border-wa-line bg-wa-panel px-2.5 pr-8 text-[12px] text-wa-ink"
                  >
                    <option value="">Sin asignar</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.display_name}
                        {m.id === meId ? " (yo)" : ""}
                      </option>
                    ))}
                  </Select>
                  {panelToggle}
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
              /* landing sin conversación — como la portada de WhatsApp Web */
              <div className="flex flex-1 flex-col items-center justify-center gap-5 border-b-[6px] border-wa-accent bg-wa-panel-alt px-8 text-center">
                <div className="flex size-20 items-center justify-center rounded-full bg-wa-panel shadow-sm animate-fade-in">
                  <MessageCircle className="size-9 text-wa-ink-faint" strokeWidth={1.25} />
                </div>
                <div className="animate-fade-in">
                  <p className="text-[28px] font-light leading-9 text-wa-ink">
                    Elegí una conversación
                  </p>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-wa-ink-faint">
                    Leé y respondé WhatsApp con las herramientas de la agencia al lado:
                    etapas, seguimientos y presupuestos sin salir del CRM.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ── zona 3 · panel de herramientas (lg+, colapsable) ── */}
          {selectedId && panelShown && (
            <aside className="hidden w-[340px] shrink-0 overflow-hidden border-l border-wa-line bg-wa-panel animate-slide-in-right lg:flex lg:flex-col">
              <ChatContextPanel
                key={selectedId}
                contact={activeContact}
                onOpenLead={onOpenLead}
                onQuoteRequest={() => setQuoteOpen(true)}
                onLeadStageChange={syncLeadStage}
                onClose={togglePanel}
                refreshKey={panelRefresh}
                className="h-full"
              />
            </aside>
          )}
        </div>
      </div>

      {/* ── mobile: hilo en overlay full-screen ── */}
      {selectedId && !mdUp && (
        <div className="fixed inset-0 z-50 flex h-dvh flex-col bg-wa-panel pb-[env(safe-area-inset-bottom)] animate-slide-up md:hidden">
          <header className="flex shrink-0 items-center gap-1.5 border-b border-wa-line bg-wa-panel-alt px-1.5 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))]">
            <button
              type="button"
              onClick={() => select(null)}
              aria-label="Volver a la lista de chats"
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-wa-ink-soft transition-colors active:bg-wa-active tap-highlight-none"
            >
              <ArrowLeft className="size-5" />
            </button>
            <Avatar name={contactName} className="size-9" />
            <div className="min-w-0 flex-1 pl-1">
              <p className="truncate text-[15px] font-medium leading-5 text-wa-ink">
                {contactName}
              </p>
              <p className="truncate text-[12px] text-wa-ink-soft">{headerMeta}</p>
            </div>
            {stageChip}
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-label="Herramientas del lead"
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-wa-ink-soft transition-colors active:bg-wa-active tap-highlight-none"
            >
              <PanelRightOpen className="size-5" strokeWidth={1.9} />
            </button>
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

      {/* ── herramientas como bottom sheet (mobile y tablets sin lugar) ── */}
      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogContent title="Herramientas" description={contactName} size="md">
          <ChatContextPanel
            key={`sheet-${selectedId}`}
            contact={activeContact}
            showHeader={false}
            onOpenLead={(leadId) => {
              setSheetOpen(false);
              onOpenLead?.(leadId);
            }}
            onQuoteRequest={() => {
              setSheetOpen(false);
              setQuoteOpen(true);
            }}
            onLeadStageChange={syncLeadStage}
            refreshKey={panelRefresh}
          />
        </DialogContent>
      </Dialog>

      {/* popup de presupuesto: armalo acá y mandalo a la conversación */}
      <QuoteDialog
        open={quoteOpen}
        onOpenChange={setQuoteOpen}
        leadId={lead?.id ?? null}
        contactId={active?.contact?.id ?? null}
        conversationId={selectedId}
        onDone={() => setPanelRefresh((k) => k + 1)}
      />
    </>
  );
}
