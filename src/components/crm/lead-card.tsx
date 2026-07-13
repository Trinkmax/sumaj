"use client";

import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHANNELS } from "@/lib/domain";
import { fmtDue, fmtRelative } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { BoardLead } from "./types";

/** "hace 5 min" → "5 min" (la tarjeta va justa de espacio) */
function shortRelative(date: string): string {
  const r = fmtRelative(date);
  return r.startsWith("hace ") ? r.slice(5) : r;
}

/**
 * Tarjeta del kanban. Presentacional: el drag lo maneja el wrapper sortable.
 */
export function LeadCard({
  lead,
  overlay,
  muted,
  onClick,
}: {
  lead: BoardLead;
  /** true cuando se renderiza en el DragOverlay */
  overlay?: boolean;
  /** columnas ganado/perdido, más apagadas */
  muted?: boolean;
  onClick?: () => void;
}) {
  const due = lead.next_action_at ? fmtDue(lead.next_action_at) : null;
  const pax = lead.pax_adults + lead.pax_children;

  const conv = lead.conversation;
  const hasMessage = conv?.last_message_preview != null && conv.last_message_at != null;
  // truco: si el último mensaje no coincide con el último entrante ⇒ fue saliente
  const outbound = hasMessage && conv!.last_message_at !== conv!.last_inbound_at;
  const unread = conv?.unread_count ?? 0;

  return (
    <article
      onClick={onClick}
      className={cn(
        "card cursor-grab select-none p-3 transition-all",
        "hover:-translate-y-px hover:border-line-strong hover:shadow-md",
        "active:cursor-grabbing",
        overlay && "rotate-2 scale-105 shadow-xl",
        muted && "opacity-80",
        lead._new && "animate-pop",
      )}
    >
      <p className="truncate text-sm font-medium text-ink">{lead.contact.full_name}</p>

      {lead.destination && (
        <p className="mt-0.5 truncate text-[13px] text-ink-soft">✈️ {lead.destination}</p>
      )}

      {/* último mensaje del chat: la tarjeta cuenta la conversación */}
      {hasMessage && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-[12px] leading-snug text-ink-faint">
            {outbound && <span className="font-medium text-ink-soft">Vos: </span>}
            {conv!.last_message_preview}
          </p>
          <span className="shrink-0 text-[10px] tabular-nums text-ink-faint/80">
            {shortRelative(conv!.last_message_at!)}
          </span>
          {unread > 0 && (
            <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold tabular-nums text-white animate-pop">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </div>
      )}

      {(!hasMessage || due) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {!hasMessage && (
            <Badge>{lead.origin_campaign ?? CHANNELS[lead.origin_channel].label}</Badge>
          )}
          {!hasMessage && lead.stage === "nuevo" && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-sky-700">
              <span className="inline-block size-1.5 rounded-full bg-sky-500 animate-pulse-dot" />
              {fmtRelative(lead.created_at)}
            </span>
          )}
          {due && (
            <span
              className={cn(
                "text-[11px] font-medium",
                due.overdue ? "text-red-600" : due.today ? "text-amber-600" : "text-ink-faint",
              )}
            >
              ⏰ {due.label}
            </span>
          )}
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between">
        {lead.assignee ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <Avatar name={lead.assignee.display_name} className="size-5 text-[9px]" />
            <span className="truncate text-[11px] text-ink-faint">
              {lead.assignee.display_name}
            </span>
          </span>
        ) : (
          <span className="text-[11px] italic text-ink-faint/80">Sin asignar</span>
        )}
        {pax > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-ink-faint">
            <Users className="size-3" />
            {lead.pax_adults}
            {lead.pax_children > 0 && `+${lead.pax_children}`}
          </span>
        )}
      </div>
    </article>
  );
}
