"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Forward,
  Globe,
  MessageCircle,
  PanelRightClose,
  PanelRightOpen,
  PlugZap,
  Store,
  Unplug,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState, Switch, Tooltip } from "@/components/ui/misc";
import { ConversationList } from "@/components/chats/conversation-list";
import { EmbeddedChat, type WaSendCapability } from "@/components/chats/embedded-chat";
import { ChatContextPanel } from "@/components/chats/chat-context-panel";
import {
  CONVERSATION_SELECT,
  conversationOrigin,
  type BranchOption,
  type ConversationOrigin,
  type ConversationRow,
} from "@/components/chats/types";
import { QuoteDialog } from "@/components/quotes/quote-dialog";
import { WhatsAppIcon } from "@/components/quotes/wa-icon";
import {
  assignConversation,
  bridgeToWhatsapp,
  deriveToBranch,
  getWhatsappBridgeDraft,
  type BridgeDraft,
} from "@/lib/actions/messages";
import { STAGE_BY_KEY, TAG_DOTS } from "@/lib/domain";
import { fmtPhone, fmtRelative } from "@/lib/format";
import type { LeadStage } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { MemberOption } from "./types";

/** Lo mínimo para el chip de etapa del header del hilo. */
type HeaderLead = { id: string; destination: string | null; stage: LeadStage };

const PANEL_KEY = "crm:chat-panel";

const ASSIGN_ADMIN_HINT = "La asignación la maneja un admin";

/** Qué implica el canal por el que está abierta la conversación. */
function originHint(
  kind: ConversationOrigin["kind"],
  label: string,
  canDerive: boolean,
): string {
  if (kind === "instagram")
    return `Entra por los mensajes de ${label}: se puede contestar hasta 24 hs después del último mensaje de la persona. Pasala a WhatsApp para seguir sin límite.`;
  if (kind === "madre")
    return canDerive
      ? "Entra por el número madre: solo se puede escribir dentro de las 24 hs del último mensaje del cliente. Derivá a una sucursal para seguir sin límite."
      : "Entra por el número madre: solo se puede escribir dentro de las 24 hs del último mensaje del cliente. Pedile a un admin que la derive a una sucursal.";
  if (kind === "sucursal")
    return `Hablás desde el número de ${label}: sin ventana de 24 hs ni plantillas pagas.`;
  return `Conversación por ${label}.`;
}

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
  isAdmin,
  waSend,
  members,
  branches,
  initialConversationId,
  onSelectedChange,
  onOpenLead,
  toolbar,
}: {
  initialConversations: ConversationRow[];
  agencyId: string;
  meId: string;
  /** la asignación de vendedores y la derivación son solo de admins */
  isAdmin: boolean;
  /** capacidad real de enviar por WhatsApp (worker / Cloud API) */
  waSend: WaSendCapability;
  members: MemberOption[];
  /** sucursales activas con su número (filtro de la lista + derivar) */
  branches: BranchOption[];
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
  const [deriveOpen, setDeriveOpen] = React.useState(false);
  const [bridgeOpen, setBridgeOpen] = React.useState(false);
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
      /* ?c= de un chat que ya no existe (bookmark viejo): sin esto el header
         quedaba vacío para siempre esperando una conversación fantasma */
      if (!fresh) {
        toast.error("Ese chat ya no existe. Elegí otra conversación de la lista.");
        select(null);
        return;
      }
      setConv(fresh);
      if (!fresh.contact_id) return;
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
  }, [selectedId, select]);

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

  /* por qué canal está abierta la conversación (y si se puede derivar).
     Se deriva todo lo que NO esté ya en el número de una sucursal: el madre,
     otro canal y también los hilos viejos sin canal asignado. Instagram queda
     afuera: derivar abre un hilo de WhatsApp con el teléfono del contacto, y un
     contacto que llegó por DM no tiene teléfono — para eso está el puente. */
  const from = active ? conversationOrigin(active) : null;
  const isInstagram = from?.kind === "instagram";
  const canDerive =
    isAdmin && active != null && from?.kind !== "sucursal" && !isInstagram;
  const FromIcon = from?.icon ?? Globe;

  const originChip = from && (
    <Tooltip content={originHint(from.kind, from.label, canDerive)}>
      {/* con poco ancho queda solo el icono: el tooltip explica el resto */}
      <span
        tabIndex={0}
        className="flex shrink-0 items-center gap-1.5 rounded-full bg-wa-panel px-2 py-1 text-[11px] font-medium text-wa-ink-soft outline-none focus-visible:ring-2 focus-visible:ring-wa-accent-deep/30 lg:px-2.5"
      >
        <FromIcon className="size-3.5 shrink-0" strokeWidth={2} />
        <span className="hidden max-w-[130px] truncate lg:inline">{from.label}</span>
      </span>
    </Tooltip>
  );

  const deriveButton = canDerive && (
    <Tooltip content="Derivar a una sucursal">
      <button
        type="button"
        onClick={() => setDeriveOpen(true)}
        aria-label="Derivar a sucursal"
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-wa-ink-soft transition-colors hover:bg-wa-hover active:scale-95 tap-highlight-none"
      >
        <Forward className="size-5" strokeWidth={1.9} />
      </button>
    </Tooltip>
  );

  const bridgeHeaderButton = isInstagram && (
    <Tooltip content="Seguir la charla por WhatsApp">
      <button
        type="button"
        onClick={() => setBridgeOpen(true)}
        aria-label="Pasar a WhatsApp"
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-wa-accent transition-colors hover:bg-wa-hover active:scale-95 tap-highlight-none"
      >
        <WhatsAppIcon className="size-5" />
      </button>
    </Tooltip>
  );

  const assignSelect = (
    <Select
      value={active?.assigned_to ?? ""}
      onChange={(e) => handleAssign(e.target.value)}
      aria-label={
        isAdmin ? "Vendedor asignado" : `Vendedor asignado — ${ASSIGN_ADMIN_HINT}`
      }
      disabled={!isAdmin}
      className={cn(
        "h-9 w-auto max-w-[150px] rounded-lg border-wa-line bg-wa-panel px-2.5 pr-8 text-[12px] text-wa-ink",
        // deshabilitado no dispara eventos de mouse: sin esto el tooltip del
        // wrapper nunca se abre y el vendedor no entiende por qué no lo puede tocar
        !isAdmin && "pointer-events-none",
      )}
    >
      <option value="">Sin asignar</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.display_name}
          {m.id === meId ? " (yo)" : ""}
        </option>
      ))}
    </Select>
  );

  /* se ve siempre a quién está asignada; solo el admin la cambia */
  const assignControl = isAdmin ? (
    assignSelect
  ) : (
    <Tooltip content={ASSIGN_ADMIN_HINT}>
      <span className="inline-flex shrink-0 cursor-not-allowed">{assignSelect}</span>
    </Tooltip>
  );

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
              meId={meId}
              isAdmin={isAdmin}
              branches={branches}
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
                  {originChip}
                  {stageChip}
                  {bridgeHeaderButton}
                  {deriveButton}
                  {assignControl}
                  {panelToggle}
                </header>
                {mdUp && (
                  <EmbeddedChat
                    conversationId={selectedId}
                    meId={meId}
                    waSend={waSend}
                    onQuoteRequest={() => setQuoteOpen(true)}
                    onBridgeRequest={() => setBridgeOpen(true)}
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
              {/* en mobile el número/sucursal va en la meta: no roba ancho al nombre */}
              <p className="flex items-center gap-1 truncate text-[12px] text-wa-ink-soft">
                {from && <FromIcon className="size-3 shrink-0" strokeWidth={2} />}
                <span className="truncate">
                  {from ? `${from.label} · ${headerMeta}` : headerMeta}
                </span>
              </p>
            </div>
            {stageChip}
            {isInstagram && (
              <button
                type="button"
                onClick={() => setBridgeOpen(true)}
                aria-label="Pasar a WhatsApp"
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-wa-accent transition-colors active:bg-wa-active tap-highlight-none"
              >
                <WhatsAppIcon className="size-5" />
              </button>
            )}
            {canDerive && (
              <button
                type="button"
                onClick={() => setDeriveOpen(true)}
                aria-label="Derivar a sucursal"
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-wa-ink-soft transition-colors active:bg-wa-active tap-highlight-none"
              >
                <Forward className="size-5" strokeWidth={1.9} />
              </button>
            )}
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
            waSend={waSend}
            onQuoteRequest={() => setQuoteOpen(true)}
            onBridgeRequest={() => setBridgeOpen(true)}
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

      {/* derivar del número madre a una sucursal (admin) */}
      {selectedId && (
        <DeriveDialog
          open={deriveOpen}
          onOpenChange={setDeriveOpen}
          conversationId={selectedId}
          contactName={contactName}
          branches={branches}
          onDerived={select}
        />
      )}

      {/* pasar la charla de Instagram a WhatsApp */}
      {selectedId && (
        <BridgeDialog
          open={bridgeOpen}
          onOpenChange={setBridgeOpen}
          conversationId={selectedId}
          onBridged={select}
        />
      )}

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

/* ───────────────────────────────────────────
   Pasar de Instagram a WhatsApp.

   El movimiento más importante del canal: la consulta entró por un DM y la
   venta se trabaja por WhatsApp. Lo único que falta es el teléfono, así que
   el diálogo es literalmente eso — el teléfono y el primer mensaje, con todo
   pre-cargado para que sea un click.

   Al confirmar saltamos al hilo de WhatsApp: el vendedor sigue escribiendo
   donde tiene que estar, sin buscar nada.
   ─────────────────────────────────────────── */
function BridgeDialog({
  open,
  onOpenChange,
  conversationId,
  onBridged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  conversationId: string;
  onBridged: (conversationId: string) => void;
}) {
  const [draft, setDraft] = React.useState<BridgeDraft | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [phone, setPhone] = React.useState("");
  const [text, setText] = React.useState("");
  const [greet, setGreet] = React.useState(true);
  const [sending, setSending] = React.useState(false);

  /* limpieza al abrir (ajuste de estado durante el render, no en un efecto) */
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setDraft(null);
      setError(null);
      setSending(false);
    }
  }

  /* al abrir se pide el borrador: el teléfono que ya tengamos, el saludo de la
     agencia y por qué sucursal saldría */
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const res = await getWhatsappBridgeDraft({ conversationId });
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDraft(res.data);
      setPhone(res.data.phone ?? "");
      setText(res.data.text);
      setGreet(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, conversationId]);

  // el estado de carga se deduce, así no hace falta un setState sincrónico
  // adentro del efecto (que dispara renders en cascada)
  const loading = !draft && !error;

  async function confirm() {
    if (sending) return;
    setSending(true);
    const res = await bridgeToWhatsapp({
      conversationId,
      phone,
      text: greet ? text : undefined,
    });
    setSending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(
      res.data.sent ? "Listo, ya le escribiste por WhatsApp." : "Chat de WhatsApp abierto.",
    );
    onOpenChange(false);
    onBridged(res.data.conversationId);
  }

  const blocked = draft?.blocked ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Seguir por WhatsApp"
        description={
          draft
            ? `${draft.contactName} pasa a WhatsApp: sin ventana de 24 hs y con el número de la sucursal.`
            : "Pasá la charla al WhatsApp de la sucursal."
        }
        size="md"
      >
        {loading ? (
          <div className="space-y-3">
            <div className="h-11 w-full animate-pulse rounded-xl bg-sand-soft" />
            <div className="h-24 w-full animate-pulse rounded-xl bg-sand-soft" />
          </div>
        ) : error ? (
          <p className="rounded-xl border border-tone-amber-line bg-tone-amber-soft px-3 py-2.5 text-[13px] leading-snug text-tone-amber-text">
            {error}
          </p>
        ) : (
          <>
            <div>
              <Label htmlFor="bridge-phone">WhatsApp del cliente</Label>
              <Input
                id="bridge-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="381 555-4433"
                inputMode="tel"
                autoComplete="off"
                className="h-11 tabular-nums"
              />
              <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
                {draft?.phone
                  ? "Lo dejó en el chat de Instagram. Corregilo si hace falta."
                  : "Escribilo con característica, sin el 0 ni el 15. Queda guardado en su ficha."}
              </p>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="bridge-text" className="mb-0">
                  Primer mensaje
                </Label>
                <Switch
                  checked={greet}
                  onCheckedChange={setGreet}
                  aria-label="Mandar el primer mensaje ahora"
                />
              </div>
              <Textarea
                id="bridge-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                disabled={!greet}
                className="mt-1.5 min-h-[88px]"
              />
              <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
                {greet
                  ? `Sale ahora mismo${draft?.branchName ? ` desde ${draft.branchName}` : ""}.`
                  : "Apagado: se abre el chat vacío y le escribís vos."}
              </p>
            </div>

            {blocked && (
              <p className="mt-3 rounded-xl border border-tone-amber-line bg-tone-amber-soft px-3 py-2 text-[12px] leading-snug text-tone-amber-text animate-fade-in">
                {blocked}
              </p>
            )}

            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={sending}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="whatsapp"
                onClick={confirm}
                loading={sending}
                disabled={phone.trim().length < 6 || !!blocked}
              >
                <WhatsAppIcon className="size-4" />
                {greet ? "Escribirle por WhatsApp" : "Abrir el chat"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────────────────────────
   Derivar a sucursal: el handoff del número madre
   al número propio de la sucursal (sin ventana de
   24 hs). Al confirmar, saltamos al hilo nuevo.
   ─────────────────────────────────────────── */
function DeriveDialog({
  open,
  onOpenChange,
  conversationId,
  contactName,
  branches,
  onDerived,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  conversationId: string;
  contactName: string;
  branches: BranchOption[];
  onDerived: (conversationId: string) => void;
}) {
  const [picked, setPicked] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  /* al abrir: preseleccionamos la primera sucursal con el número vinculado
     (ajuste de estado durante el render). Una sucursal sin canal creado no se
     puede elegir: deriveToBranch la rechaza. */
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setLoading(false);
      setPicked(
        branches.find((b) => b.channel?.status === "conectado")?.id ??
          branches.find((b) => b.channel != null)?.id ??
          null,
      );
    }
  }

  const pickedBranch = branches.find((b) => b.id === picked) ?? null;
  /* vinculado pero caído: se deriva igual (el operador queda avisado) */
  const pickedOffline =
    pickedBranch?.channel != null && pickedBranch.channel.status !== "conectado";
  const noneUsable = branches.length > 0 && branches.every((b) => b.channel == null);

  async function confirm() {
    if (!picked || loading) return;
    if (pickedBranch?.channel == null) {
      toast.error("Esa sucursal todavía no tiene número. Crealo en Configuración.");
      return;
    }
    setLoading(true);
    const res = await deriveToBranch({ conversationId, branchId: picked });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Derivado a ${res.data.branchName}`);
    onOpenChange(false);
    onDerived(res.data.conversationId);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Derivar a sucursal"
        description={`${contactName} pasa a hablar por el número de la sucursal, sin ventana de 24 hs.`}
        size="md"
      >
        {branches.length === 0 ? (
          <EmptyState
            icon={Store}
            title="Todavía no hay sucursales"
            description="Creá una en Configuración y vinculale su WhatsApp para derivar consultas."
            className="py-6"
          />
        ) : (
          <>
            <div className="space-y-2 stagger-children">
              {branches.map((b) => {
                const connected = b.channel?.status === "conectado";
                // sin fila de canal no hay a dónde derivar: la action lo rechaza
                const noChannel = b.channel == null;
                const selected = picked === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setPicked(b.id)}
                    disabled={noChannel}
                    aria-pressed={selected}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-2xl border p-3 text-left transition-all duration-150 tap-highlight-none",
                      noChannel
                        ? "cursor-not-allowed border-line bg-sand-soft/40 opacity-60"
                        : "active:scale-[0.99]",
                      !noChannel &&
                        (selected
                          ? "border-brand-500 bg-brand-tint shadow-sm"
                          : "border-line bg-paper hover:border-line-strong hover:bg-sand-soft/50"),
                    )}
                  >
                    <span
                      className={cn(
                        "size-2.5 shrink-0 rounded-full",
                        TAG_DOTS[b.color] ?? TAG_DOTS.gray,
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {b.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-ink-faint">
                        {b.channel?.phone
                          ? fmtPhone(b.channel.phone)
                          : noChannel
                            ? "Sin número: crealo en Configuración"
                            : "Sin número cargado"}
                      </span>
                    </span>
                    <Badge color={connected ? "emerald" : "gray"} className="shrink-0">
                      {connected ? (
                        <PlugZap className="size-3" strokeWidth={2} />
                      ) : (
                        <Unplug className="size-3" strokeWidth={2} />
                      )}
                      {connected ? "Conectado" : noChannel ? "Sin número" : "Sin vincular"}
                    </Badge>
                  </button>
                );
              })}
            </div>

            {pickedOffline && (
              <p className="mt-3 rounded-xl border border-tone-amber-line bg-tone-amber-soft px-3 py-2 text-[12px] leading-snug text-tone-amber-text animate-fade-in">
                Esa sucursal todavía no tiene el WhatsApp vinculado. El lead se mueve igual
                y el operador queda avisado.
              </p>
            )}

            {noneUsable && (
              <p className="mt-3 rounded-xl border border-tone-amber-line bg-tone-amber-soft px-3 py-2 text-[12px] leading-snug text-tone-amber-text animate-fade-in">
                Ninguna sucursal tiene su número creado todavía. Andá a Configuración ·
                Sucursales y creale el WhatsApp a la que va a atender.
              </p>
            )}

            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={confirm}
                loading={loading}
                disabled={!picked || pickedBranch?.channel == null}
              >
                <Forward />
                Derivar
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
