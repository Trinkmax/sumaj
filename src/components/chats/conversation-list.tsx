"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { EmptyState, Segmented } from "@/components/ui/misc";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CONVERSATION_SELECT, type ConversationRow } from "./types";

type Filter = "todos" | "no_leidos" | "sin_asignar";

/** "hace 5 min" → "5 min" — hora corta para la fila */
function shortTime(iso: string | null): string {
  if (!iso) return "";
  return fmtRelative(iso).replace(/^hace /, "");
}

export function ConversationList({
  initial,
  agencyId,
  activeId,
  hiddenOnMobile = false,
  onSelect,
}: {
  initial: ConversationRow[];
  agencyId: string;
  activeId?: string | null;
  /** true en /chats/[id]: la lista está oculta en mobile y no debe suscribirse a realtime ahí */
  hiddenOnMobile?: boolean;
  /** Si viene, las filas llaman onSelect(id) en vez de navegar a /chats/{id} (reuso embebido, p. ej. CRM). */
  onSelect?: (conversationId: string) => void;
}) {
  const [conversations, setConversations] = useState<ConversationRow[]>(initial);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(min-width: 768px)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /* Realtime: cualquier INSERT/UPDATE de conversations de la agencia
     refresca esa fila (con joins) en vivo. */
  useEffect(() => {
    // en /chats/[id] mobile la lista no se ve: sin suscripción ni refetch
    if (hiddenOnMobile && !isDesktop) return;
    const supabase = createClient();
    const channel = supabase
      // sufijo único por montaje: la lista existe en /chats y /chats/[id] a la vez durante la navegación
      .channel(`conversations:${agencyId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `agency_id=eq.${agencyId}`,
        },
        async (payload) => {
          const changed = payload.new as { id?: string };
          if (!changed?.id) return;
          const { data } = await supabase
            .from("conversations")
            .select(CONVERSATION_SELECT)
            .eq("id", changed.id)
            .maybeSingle();
          if (!data) return;
          const full = data as unknown as ConversationRow;
          setConversations((prev) => [full, ...prev.filter((c) => c.id !== full.id)]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [agencyId, hiddenOnMobile, isDesktop]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return conversations
      .filter((c) => {
        if (filter === "no_leidos" && (c.unread_count === 0 || c.id === activeId)) return false;
        if (filter === "sin_asignar" && c.assigned_to != null) return false;
        if (!q) return true;
        const name = c.contact?.full_name?.toLowerCase() ?? "";
        const phone = (c.contact?.phone ?? c.wa_id ?? "").replace(/\D/g, "");
        return name.includes(q) || (qDigits.length > 2 && phone.includes(qDigits));
      })
      .sort((a, b) => {
        const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return tb - ta;
      });
  }, [conversations, search, filter, activeId]);

  const hasAny = conversations.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* búsqueda + filtros */}
      <div className="space-y-2.5 px-4 pb-3 md:px-3.5 md:pt-3.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o teléfono…"
            className="pl-9"
            aria-label="Buscar conversaciones"
          />
        </div>
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "todos", label: "Todos" },
            { value: "no_leidos", label: "No leídos" },
            { value: "sin_asignar", label: "Sin asignar" },
          ]}
        />
      </div>

      {/* filas */}
      <div className="min-h-0 flex-1 md:overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-4 pt-2 md:px-3.5">
            {hasAny ? (
              <EmptyState
                emoji="🔍"
                title="Nada por acá"
                description="Probá con otra búsqueda u otro filtro."
              />
            ) : (
              <EmptyState
                emoji="💬"
                title="Todavía no hay chats"
                description="Cuando un cliente te escriba por WhatsApp, la conversación aparece acá."
              />
            )}
          </div>
        ) : (
          <div className="mx-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper shadow-sm md:mx-0 md:rounded-none md:border-0 md:shadow-none">
            {filtered.map((c) => {
              const active = c.id === activeId;
              const unread = active ? 0 : c.unread_count;
              const name = c.contact?.full_name ?? "Sin nombre";
              const rowClass = cn(
                "flex items-center gap-3 px-3.5 py-3 transition-colors tap-highlight-none",
                active ? "bg-sand-soft" : "hover:bg-sand-soft/60 active:bg-sand-soft",
                c.status === "cerrada" && !active && "opacity-70",
              );
              const rowContent = (
                <>
                  <Avatar name={name} className="size-11 text-sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p
                        className={cn(
                          "truncate text-[15px] leading-5 text-ink",
                          unread > 0 ? "font-semibold" : "font-medium",
                        )}
                      >
                        {name}
                        {c.status === "cerrada" && (
                          <span className="ml-1.5 align-middle text-[10px] font-medium text-ink-faint">
                            · cerrada
                          </span>
                        )}
                      </p>
                      <span
                        className={cn(
                          "shrink-0 text-[11px] tabular-nums",
                          unread > 0 ? "font-semibold text-brand-700" : "text-ink-faint",
                        )}
                      >
                        {shortTime(c.last_message_at)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-end justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink-faint">
                        {c.last_message_preview ?? "Sin mensajes todavía"}
                      </p>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {unread > 0 && (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-bold leading-none text-white animate-pop">
                            {unread > 99 ? "99+" : unread}
                          </span>
                        )}
                        {c.assignee && (
                          <Avatar
                            name={c.assignee.display_name}
                            src={c.assignee.avatar_url}
                            className="size-5 text-[8px]"
                          />
                        )}
                      </span>
                    </div>
                  </div>
                </>
              );
              return onSelect ? (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className={cn(rowClass, "w-full text-left")}
                >
                  {rowContent}
                </button>
              ) : (
                <Link key={c.id} href={`/chats/${c.id}`} className={rowClass}>
                  {rowContent}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
