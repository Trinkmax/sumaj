"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ChartNoAxesColumn, Kanban, MessageCircle, Plus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/misc";
import {
  CONVERSATION_SELECT,
  type BranchOption,
  type ConversationRow,
} from "@/components/chats/types";
import type { Tables } from "@/lib/types";
import { KanbanBoard } from "./kanban-board";
import { FunnelView } from "./funnel-view";
import { ChatView } from "./chat-view";
import { NewLeadDialog } from "./new-lead-dialog";
import { LeadDrawer } from "./lead-drawer";
import type { BoardLead, MemberOption } from "./types";

export type CrmView = "pipeline" | "chats" | "embudo";
type Scope = "mios" | "todos";

const VIEW_STORAGE_KEY = "crm:vista";

function isView(v: string | null): v is CrmView {
  return v === "pipeline" || v === "chats" || v === "embudo";
}

export function CrmBoard({
  initialLeads,
  initialConversations,
  members,
  branches,
  meId,
  isAdmin,
  agencyId,
  waConnected,
  initialView,
  initialConversationId,
}: {
  initialLeads: BoardLead[];
  initialConversations: ConversationRow[];
  members: MemberOption[];
  /** sucursales activas con su número de WhatsApp */
  branches: BranchOption[];
  meId: string;
  isAdmin: boolean;
  agencyId: string;
  waConnected: boolean;
  /** null = la URL no trae ?vista= → se usa la última vista guardada en localStorage */
  initialView: CrmView | null;
  initialConversationId: string | null;
}) {
  const router = useRouter();
  const [leads, setLeads] = React.useState<BoardLead[]>(initialLeads);
  const [conversations, setConversations] =
    React.useState<ConversationRow[]>(initialConversations);
  const [view, setView] = React.useState<CrmView>(initialView ?? "pipeline");
  const [chatConvId, setChatConvId] = React.useState<string | null>(
    initialView === "chats" ? initialConversationId : null,
  );
  const [scope, setScope] = React.useState<Scope>(isAdmin ? "todos" : "mios");
  const [query, setQuery] = React.useState("");
  const [newOpen, setNewOpen] = React.useState(false);
  // el drawer sigue al lead del estado local: los patches optimistas se ven al instante
  const [openLeadId, setOpenLeadId] = React.useState<string | null>(null);

  const knownIds = React.useRef(new Set(initialLeads.map((l) => l.id)));
  const knownConvIds = React.useRef(new Set(initialConversations.map((c) => c.id)));

  // resync cuando el server revalida (ajuste de estado durante el render)
  const [prevInitial, setPrevInitial] = React.useState(initialLeads);
  if (prevInitial !== initialLeads) {
    setPrevInitial(initialLeads);
    // conservamos los que llegaron por realtime y todavía no están en el fetch
    const fresh = new Set(initialLeads.map((l) => l.id));
    const extras = leads.filter((l) => l._new && !fresh.has(l.id));
    setLeads([...extras, ...initialLeads]);
  }
  const [prevConvInitial, setPrevConvInitial] = React.useState(initialConversations);
  if (prevConvInitial !== initialConversations) {
    setPrevConvInitial(initialConversations);
    setConversations(initialConversations);
  }

  React.useEffect(() => {
    for (const l of initialLeads) knownIds.current.add(l.id);
  }, [initialLeads]);
  React.useEffect(() => {
    for (const c of initialConversations) knownConvIds.current.add(c.id);
  }, [initialConversations]);

  /* última vista usada: default cuando la URL no trae ?vista=
     (el vendedor mobile cae donde trabaja) */
  React.useEffect(() => {
    try {
      if (initialView != null) {
        localStorage.setItem(VIEW_STORAGE_KEY, initialView);
        return;
      }
      const saved = localStorage.getItem(VIEW_STORAGE_KEY);
      // lectura única de un sistema externo (localStorage) al montar:
      // no puede ir en el initializer porque el primer render es SSR
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (isView(saved)) setView(saved);
    } catch {
      // sin localStorage no pasa nada: queda el default
    }
    // solo al montar: después manda la interacción del usuario
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* la vista y la conversación viven en la URL (deep links) sin refetch */
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("vista", view);
    if (view === "chats" && chatConvId) params.set("c", chatConvId);
    else params.delete("c");
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }, [view, chatConvId]);

  /* navegaciones del router estando YA en /crm (⌘K, redirects de /chats):
     el componente no se remonta, así que la URL nueva se aplica acá.
     El replaceState de arriba NO cambia useSearchParams → sin loop. */
  const searchParams = useSearchParams();
  React.useEffect(() => {
    const vista = searchParams.get("vista");
    const c = searchParams.get("c");
    if (isView(vista)) {
      setView(vista);
      if (vista === "chats" && c) setChatConvId(c);
    } else if (c) {
      setView("chats");
      setChatConvId(c);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const changeView = React.useCallback((v: CrmView) => {
    setView(v);
    setChatConvId(null); // al cambiar de vista, ?c= se limpia
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      // ignorar (modo privado, etc.)
    }
  }, []);

  // realtime: leads nuevos aparecen solos + las tarjetas, el badge de Chats
  // y la bandeja reflejan el chat al instante (una sola suscripción acá)
  React.useEffect(() => {
    const supabase = createClient();

    // conversación tocada (mensaje nuevo, leída, asignada, etc.)
    const onConversationChange = async (payload: { new: unknown }) => {
      const row = payload.new as Tables<"conversations">;

      // 1) tarjetas del kanban (solo whatsapp: es lo que muestran)
      if (row.channel === "whatsapp") {
        setLeads((prev) =>
          prev.map((l) =>
            l.contact.id === row.contact_id
              ? {
                  ...l,
                  conversation: {
                    id: row.id,
                    last_message_preview: row.last_message_preview,
                    last_message_at: row.last_message_at,
                    last_inbound_at: row.last_inbound_at,
                    unread_count: row.unread_count,
                  },
                }
              : l,
          ),
        );
      }

      // 2) bandeja + badge de no leídos
      if (knownConvIds.current.has(row.id)) {
        // fila conocida: merge conservando los joins (contact/assignee)
        setConversations((prev) =>
          prev.map((c) => (c.id === row.id ? { ...c, ...row } : c)),
        );
        return;
      }
      // conversación nueva: refetch con joins para tenerla completa en la lista
      knownConvIds.current.add(row.id);
      const { data } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .eq("id", row.id)
        .maybeSingle();
      if (!data) return;
      const full = data as unknown as ConversationRow;
      setConversations((prev) => [full, ...prev.filter((c) => c.id !== full.id)]);
    };

    const channel = supabase
      // sufijo único por montaje: reutilizar el nombre de un canal ya suscripto lanza excepción
      .channel(`crm-board-${agencyId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "leads",
          filter: `agency_id=eq.${agencyId}`,
        },
        async (payload) => {
          const row = payload.new as Tables<"leads">;
          if (knownIds.current.has(row.id)) return;
          knownIds.current.add(row.id);

          const [{ data: contact }, assigneeRes, convRes] = await Promise.all([
            supabase
              .from("contacts")
              .select("id, full_name, phone")
              .eq("id", row.contact_id)
              .maybeSingle(),
            row.assigned_to
              ? supabase
                  .from("members")
                  .select("id, display_name")
                  .eq("id", row.assigned_to)
                  .maybeSingle()
              : Promise.resolve({ data: null }),
            supabase
              .from("conversations")
              .select(
                "id, last_message_preview, last_message_at, last_inbound_at, unread_count",
              )
              .eq("contact_id", row.contact_id)
              .eq("channel", "whatsapp")
              .maybeSingle(),
          ]);
          if (!contact) return;

          const newLead: BoardLead = {
            id: row.id,
            stage: row.stage,
            position: Number(row.position),
            destination: row.destination,
            origin_channel: row.origin_channel,
            origin_campaign: row.origin_campaign,
            next_action_at: row.next_action_at,
            created_at: row.created_at,
            pax_adults: row.pax_adults,
            pax_children: row.pax_children,
            assigned_to: row.assigned_to,
            won_file_id: row.won_file_id,
            contact,
            assignee: assigneeRes.data,
            conversation: convRes.data ?? null,
            _new: true,
          };

          setLeads((prev) =>
            prev.some((l) => l.id === row.id) ? prev : [newLead, ...prev],
          );
          toast.success(`Nuevo lead: ${contact.full_name}`);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `agency_id=eq.${agencyId}`,
        },
        onConversationChange,
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversations",
          filter: `agency_id=eq.${agencyId}`,
        },
        onConversationChange,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [agencyId]);

  const patchLead = React.useCallback((id: string, patch: Partial<BoardLead>) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch, _new: false } : l)));
  }, []);

  const addLead = React.useCallback((lead: BoardLead) => {
    knownIds.current.add(lead.id);
    setLeads((prev) => (prev.some((l) => l.id === lead.id) ? prev : [lead, ...prev]));
  }, []);

  /* "Ver lead" desde la vista Chats: reusa el drawer del board;
     si el lead no está en el estado (caso raro), va al detalle */
  const openLeadFromChat = React.useCallback(
    (leadId: string) => {
      if (leads.some((l) => l.id === leadId)) setOpenLeadId(leadId);
      else router.push(`/crm/${leadId}`);
    },
    [leads, router],
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((l) => {
      if (scope === "mios" && l.assigned_to !== null && l.assigned_to !== meId) return false;
      if (!q) return true;
      return (
        l.contact.full_name.toLowerCase().includes(q) ||
        (l.destination ?? "").toLowerCase().includes(q)
      );
    });
  }, [leads, scope, query, meId]);

  const totalUnread = React.useMemo(
    () => conversations.reduce((sum, c) => sum + c.unread_count, 0),
    [conversations],
  );

  const openLead = openLeadId ? (leads.find((l) => l.id === openLeadId) ?? null) : null;

  /* switcher de vistas: versión completa (toolbar crema) y compacta (header del panel WA) */
  const viewOptions: { value: CrmView; label: React.ReactNode }[] = [
    {
      value: "pipeline",
      label: (
        <span className="flex items-center gap-1.5">
          <Kanban className="size-4" strokeWidth={1.9} />
          Pipeline
        </span>
      ),
    },
    {
      value: "chats",
      label: (
        <span className="flex items-center gap-1.5">
          <MessageCircle className="size-4" strokeWidth={1.9} />
          Chats
          {totalUnread > 0 && (
            <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-wa-accent px-1 text-[10px] font-bold leading-none text-white animate-pop">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </span>
      ),
    },
    {
      value: "embudo",
      label: (
        <span className="flex items-center gap-1.5">
          <ChartNoAxesColumn className="size-4" strokeWidth={1.9} />
          Embudo
        </span>
      ),
    },
  ];

  return (
    <>
      {/* ── barra única del CRM: idéntica en las tres vistas ──
          El título, el switcher y "Nuevo lead" NUNCA cambian de lugar. */}
      <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2 md:px-6">
        <h1 className="font-display text-xl font-semibold tracking-tight text-ink">CRM</h1>
        <Segmented<CrmView> value={view} onChange={changeView} options={viewOptions} />
        {view !== "chats" && (
          <>
            <Segmented<Scope>
              value={scope}
              onChange={setScope}
              options={[
                { value: "mios", label: "Míos" },
                { value: "todos", label: "Todos" },
              ]}
            />
            <div className="relative hidden min-w-[160px] flex-1 sm:block sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nombre o destino…"
                className="h-9 rounded-full pl-9 text-[13px]"
                aria-label="Buscar leads"
              />
            </div>
          </>
        )}
        <Button
          size="sm"
          className="ml-auto hidden md:inline-flex"
          onClick={() => setNewOpen(true)}
        >
          <Plus />
          Nuevo lead
        </Button>
      </div>

      {view === "pipeline" ? (
        <div className="pt-3">
          <KanbanBoard
            leads={filtered}
            onPatch={patchLead}
            onOpenLead={(lead) => setOpenLeadId(lead.id)}
          />
        </div>
      ) : view === "chats" ? (
        /* debajo de la barra, el clon de WhatsApp ocupa TODO el resto de la pantalla */
        <ChatView
          initialConversations={conversations}
          agencyId={agencyId}
          meId={meId}
          isAdmin={isAdmin}
          waConnected={waConnected}
          members={members}
          branches={branches}
          initialConversationId={chatConvId}
          onSelectedChange={setChatConvId}
          onOpenLead={openLeadFromChat}
        />
      ) : (
        <div className="pt-3">
          <FunnelView leads={filtered} />
        </div>
      )}

      {/* FAB mobile: nuevo lead al alcance del pulgar */}
      <button
        onClick={() => setNewOpen(true)}
        aria-label="Nuevo lead"
        className="fixed bottom-[calc(64px+env(safe-area-inset-bottom)+16px)] right-4 z-40 flex size-14 items-center justify-center rounded-full bg-ink text-cream shadow-lg transition-transform active:scale-95 md:hidden"
      >
        <Plus className="size-6" />
      </button>

      <NewLeadDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        members={members}
        meId={meId}
        isAdmin={isAdmin}
        onCreated={addLead}
      />

      <LeadDrawer
        lead={openLead}
        open={openLead != null}
        onOpenChange={(o) => {
          if (!o) setOpenLeadId(null);
        }}
        members={members}
        meId={meId}
        isAdmin={isAdmin}
        waConnected={waConnected}
        onLeadChanged={patchLead}
      />
    </>
  );
}
