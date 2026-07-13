"use client";

import { AlarmClock, CheckCheck, Plane, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHANNELS, STAGE_BY_KEY } from "@/lib/domain";
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
 * Tarjeta del kanban v2. Presentacional: el drag lo maneja el wrapper sortable.
 * Hairline superior del color de etapa + la conversación como protagonista.
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
  const stageMeta = STAGE_BY_KEY[lead.stage];
  const channel = CHANNELS[lead.origin_channel];
  const ChannelIcon = channel.icon;

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
        "card card-hover relative cursor-grab select-none overflow-hidden p-3 pt-3.5",
        "active:cursor-grabbing",
        overlay && "rotate-2 scale-105 shadow-xl",
        muted && "opacity-80",
        lead._new && "animate-pop",
      )}
    >
      {/* hairline superior del color de etapa */}
      <span
        aria-hidden
        className={cn("absolute inset-x-0 top-0 h-0.5", stageMeta.headerBar, muted && "opacity-50")}
      />

      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          {lead.contact.full_name}
        </p>
        {/* canal de origen, siempre visible aunque haya chat */}
        <span
          title={channel.label}
          className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-sand-soft text-ink-faint"
        >
          <ChannelIcon className="size-3" strokeWidth={2} />
        </span>
      </div>

      {lead.destination && (
        <p className="mt-0.5 flex items-center gap-1 truncate text-[13px] text-ink-soft">
          <Plane className="size-3 shrink-0 text-ink-faint" strokeWidth={1.75} />
          <span className="truncate">{lead.destination}</span>
        </p>
      )}

      {/* último mensaje del chat: la tarjeta cuenta la conversación */}
      {hasMessage && (
        <div className="mt-1.5 flex items-center gap-1.5">
          {outbound && (
            <CheckCheck className="size-3.5 shrink-0 text-ink-faint/80" strokeWidth={2} />
          )}
          <p className="min-w-0 flex-1 truncate text-[12px] leading-snug text-ink-faint">
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

      {((!hasMessage && (lead.origin_campaign != null || lead.stage === "nuevo")) || due) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {!hasMessage && lead.origin_campaign && <Badge>{lead.origin_campaign}</Badge>}
          {!hasMessage && lead.stage === "nuevo" && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-tone-sky-text">
              <span className="inline-block size-1.5 rounded-full bg-sky-500 animate-pulse-dot" />
              {fmtRelative(lead.created_at)}
            </span>
          )}
          {due && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium",
                due.overdue
                  ? "bg-tone-red-soft text-tone-red-text"
                  : due.today
                    ? "bg-tone-amber-soft text-tone-amber-text"
                    : "text-ink-faint",
              )}
            >
              <AlarmClock className="size-3 shrink-0" strokeWidth={2} />
              {due.label}
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
            <Users className="size-3" strokeWidth={2} />
            {lead.pax_adults}
            {lead.pax_children > 0 && `+${lead.pax_children}`}
          </span>
        )}
      </div>
    </article>
  );
}
