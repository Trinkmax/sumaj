"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Check, MessageCircle, Search, type LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/avatar";
import { Select } from "@/components/ui/input";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  CONVERSATION_SELECT,
  conversationOrigin,
  INSTAGRAM_ORIGIN_KEY,
  type BranchOption,
  type ConversationRow,
} from "./types";

type Filter = "todos" | "mios" | "no_leidas" | "sin_asignar";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "mios", label: "Míos" },
  { value: "no_leidas", label: "No leídas" },
  { value: "sin_asignar", label: "Sin asignar" },
];

/* El freelance no tiene pool: la RLS le muestra solo lo suyo, así que "Sin
   asignar" sería una píldora que siempre filtra a cero. */
const FILTERS_SIN_POOL = FILTERS.filter((f) => f.value !== "sin_asignar");

const ALL_ORIGINS = "todos";

/** "hace 5 min" → "5 min" — hora corta para la fila */
function shortTime(iso: string | null): string {
  if (!iso) return "";
  return fmtRelative(iso).replace(/^hace /, "");
}

/** ¿El último mensaje de la fila fue nuestro? (para el tick del preview) */
function lastIsOutbound(c: ConversationRow): boolean {
  if (!c.last_message_at) return false;
  if (!c.last_inbound_at) return true;
  return new Date(c.last_message_at).getTime() > new Date(c.last_inbound_at).getTime();
}

/** Empty state del mundo WhatsApp (acá no van los tokens crema). */
function WaEmpty({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-8 py-14 text-center animate-fade-in">
      <div className="flex size-14 items-center justify-center rounded-full bg-wa-panel-alt text-wa-ink-faint">
        <Icon className="size-6" strokeWidth={1.75} />
      </div>
      <p className="text-[15px] font-medium text-wa-ink">{title}</p>
      <p className="max-w-[260px] text-[13px] leading-relaxed text-wa-ink-faint">
        {description}
      </p>
    </div>
  );
}

/**
 * Lista de conversaciones clonando WhatsApp Web: título "Chats",
 * búsqueda redondeada, filtros píldora y filas de 72px sobre wa-panel.
 */
export function ConversationList({
  initial,
  agencyId,
  meId,
  isAdmin = false,
  isStaff = false,
  branches = [],
  activeId,
  hiddenOnMobile = false,
  onSelect,
  toolbar,
}: {
  initial: ConversationRow[];
  agencyId: string;
  /** member.id actual: alimenta el filtro "Míos" */
  meId: string;
  /** el admin quiere ver todo; el vendedor arranca en "Míos" */
  isAdmin?: boolean;
  /** admin o vendedor (ven toda la agencia). El freelance ve solo lo suyo: sin "Sin asignar" */
  isStaff?: boolean;
  /** sucursales activas: alimentan el filtro por número (madre / sucursal) */
  branches?: BranchOption[];
  activeId?: string | null;
  /** true en pantallas donde la lista está oculta en mobile: sin suscripción ahí */
  hiddenOnMobile?: boolean;
  /** Si viene, las filas llaman onSelect(id); si no, navegan a /crm?vista=chats&c={id}. */
  onSelect?: (conversationId: string) => void;
  /** Acciones del CRM en el header del panel (switcher de vistas, nuevo lead). */
  toolbar?: React.ReactNode;
}) {
  const [conversations, setConversations] = useState<ConversationRow[]>(initial);
  const [search, setSearch] = useState("");
  /* Default: el admin ve todo, el vendedor arranca en lo suyo, y el freelance
     también en "Todos" — todo lo que la RLS le deja ver ya es suyo, y arrancar en
     "Míos" le escondería los chats que todavía no tienen lead. */
  const [filter, setFilter] = useState<Filter>(isAdmin || !isStaff ? "todos" : "mios");
  const filters = isStaff ? FILTERS : FILTERS_SIN_POOL;
  const [origin, setOrigin] = useState<string>(ALL_ORIGINS);

  /* md+ como store externo (SSR: false = mobile-first) */
  const subscribeMd = useCallback((cb: () => void) => {
    const mq = window.matchMedia("(min-width: 768px)");
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  }, []);
  const isDesktop = useSyncExternalStore(
    subscribeMd,
    () => window.matchMedia("(min-width: 768px)").matches,
    () => false,
  );

  /* Realtime: cualquier INSERT/UPDATE de conversations de la agencia
     refresca esa fila (con joins) en vivo. */
  useEffect(() => {
    if (hiddenOnMobile && !isDesktop) return;
    const supabase = createClient();
    const channel = supabase
      // sufijo único por montaje: reutilizar el nombre de un canal suscripto lanza excepción
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
          if (!data) {
            /* El evento llegó pero la fila ya no es visible: la reasignaron a
               otro (el trigger del lead mueve el dueño del chat). Dejarla sería
               una fila fantasma que al tocarla no abre nada. */
            const goneId = changed.id;
            setConversations((prev) => prev.filter((c) => c.id !== goneId));
            return;
          }
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
        // "Míos" = lo asignado a mí, sin el pool (mismo criterio que el pipeline:
        // lo que nadie tomó todavía vive en "Sin asignar", no acá)
        if (filter === "mios" && c.assigned_to !== meId) return false;
        if (filter === "no_leidas" && (c.unread_count === 0 || c.id === activeId)) return false;
        if (filter === "sin_asignar" && c.assigned_to != null) return false;
        if (origin !== ALL_ORIGINS && conversationOrigin(c)?.key !== origin) return false;
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
  }, [conversations, search, filter, origin, activeId, meId]);

  const hasAny = conversations.length > 0;
  /* La opción de Instagram en el filtro aparece cuando hay algo que filtrar.
     Se deduce de la bandeja y no de un prop: una agencia que todavía no conectó
     Instagram no tiene por qué ver un filtro que no le filtra nada. */
  const hasInstagram = useMemo(
    () => conversations.some((c) => c.channel_ref?.kind === "instagram"),
    [conversations],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-wa-panel">
      {/* título: como el header de WhatsApp Web (+ acciones del CRM a la derecha) */}
      <div
        className={cn(
          "h-[59px] shrink-0 items-center justify-between gap-2 px-4",
          toolbar ? "flex" : "hidden md:flex",
        )}
      >
        <h2 className="text-[22px] font-bold leading-none tracking-tight text-wa-ink">Chats</h2>
        {toolbar}
      </div>

      {/* búsqueda + filtros píldora */}
      <div className="shrink-0 space-y-2 px-3 pb-2 pt-2 md:pt-0">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-wa-ink-faint" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o teléfono"
            aria-label="Buscar conversaciones"
            className="h-[38px] w-full rounded-lg bg-wa-panel-alt pl-10 pr-3 text-[14px] text-wa-ink outline-none transition-shadow placeholder:text-wa-ink-faint focus:ring-2 focus:ring-wa-accent-deep/30"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          <div
            className="flex shrink-0 items-center gap-1.5"
            role="tablist"
            aria-label="Filtrar chats"
          >
            {filters.map((f) => {
              const active = filter === f.value;
              return (
                <button
                  key={f.value}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    "h-8 shrink-0 rounded-full border px-3 text-[13px] transition-colors tap-highlight-none active:scale-[0.97]",
                    active
                      ? "border-transparent bg-wa-accent/15 font-medium text-wa-accent-deep"
                      : "border-wa-line bg-wa-panel text-wa-ink-soft hover:bg-wa-hover",
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          {/* por dónde entró el chat: madre, sucursal o Instagram */}
          {(branches.length > 0 || hasInstagram) && (
            <Select
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              aria-label="Filtrar por canal"
              className={cn(
                "h-8 w-auto shrink-0 rounded-full border-wa-line bg-wa-panel pl-3 pr-8 text-[13px] text-wa-ink",
                origin !== ALL_ORIGINS && "border-transparent bg-wa-accent/15 text-wa-accent-deep",
              )}
            >
              <option value={ALL_ORIGINS}>Todos los canales</option>
              <option value="madre">Número madre</option>
              {hasInstagram && <option value={INSTAGRAM_ORIGIN_KEY}>Instagram</option>}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>

      {/* filas 72px estilo WA */}
      <div className="min-h-0 flex-1 md:overflow-y-auto">
        {filtered.length === 0 ? (
          hasAny ? (
            <WaEmpty
              icon={Search}
              title="Nada por acá"
              description="Probá con otra búsqueda u otro filtro."
            />
          ) : (
            <WaEmpty
              icon={MessageCircle}
              title="Todavía no hay chats"
              description="Cuando un cliente escriba por WhatsApp o por Instagram, la conversación aparece acá."
            />
          )
        ) : (
          <div className="divide-y divide-wa-line animate-fade-in">
            {filtered.map((c) => {
              const active = c.id === activeId;
              const unread = active ? 0 : c.unread_count;
              const name = c.contact?.full_name ?? "Sin nombre";
              const outTick = lastIsOutbound(c);
              const from = conversationOrigin(c);
              const FromIcon = from?.icon;
              const rowClass = cn(
                "flex h-[72px] items-center gap-3 px-3 transition-colors tap-highlight-none",
                active ? "bg-wa-active" : "hover:bg-wa-hover active:bg-wa-active",
                c.status === "cerrada" && !active && "opacity-70",
              );
              const rowContent = (
                <>
                  <Avatar name={name} className="size-[49px] text-base" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <p
                          className={cn(
                            "truncate text-[16px] leading-[21px] text-wa-ink",
                            unread > 0 ? "font-semibold" : "font-normal",
                          )}
                        >
                          {name}
                          {c.status === "cerrada" && (
                            <span className="ml-1.5 align-middle text-[10px] font-medium text-wa-ink-faint">
                              · cerrada
                            </span>
                          )}
                        </p>
                        {/* metadata, no protagonista: por dónde entró */}
                        {from && FromIcon && (
                          <span className="flex max-w-[104px] shrink-0 items-center gap-1 rounded bg-wa-panel-alt px-1.5 py-px text-[10px] font-medium leading-4 text-wa-ink-faint">
                            <FromIcon className="size-2.5 shrink-0" strokeWidth={2.25} />
                            <span className="truncate">{from.label}</span>
                          </span>
                        )}
                      </div>
                      <span
                        className={cn(
                          "shrink-0 text-[12px] leading-[14px] tabular-nums",
                          unread > 0
                            ? "font-medium text-wa-accent-deep"
                            : "text-wa-ink-faint",
                        )}
                      >
                        {shortTime(c.last_message_at)}
                      </span>
                    </div>
                    <div className="mt-[3px] flex min-h-5 items-center justify-between gap-2">
                      <p
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-1 text-[13.5px] leading-5",
                          unread > 0 ? "font-medium text-wa-ink" : "text-wa-ink-soft",
                        )}
                      >
                        {outTick && (
                          <Check className="size-4 shrink-0 text-wa-ink-faint" />
                        )}
                        <span className="truncate">
                          {c.last_message_preview ?? "Sin mensajes todavía"}
                        </span>
                      </p>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {unread > 0 && (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-wa-accent px-1.5 text-[11px] font-semibold leading-none text-white animate-pop">
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
                <Link key={c.id} href={`/crm?vista=chats&c=${c.id}`} className={rowClass}>
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
