"use client";

import * as React from "react";
import Link from "next/link";
import {
  ChevronRight,
  CircleHelp,
  MessageSquareReply,
  MessagesSquare,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, Tooltip } from "@/components/ui/misc";
import { fmtPhone, fmtRelative } from "@/lib/format";
import type { BroadcastIntent, BroadcastRecipientStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export type BroadcastRecipientRow = {
  id: string;
  contactId: string;
  name: string;
  phone: string;
  status: BroadcastRecipientStatus;
  intent: BroadcastIntent | null;
  buttonLabel: string | null;
  replyText: string | null;
  repliedAt: string | null;
  conversationId: string | null;
  leadId: string | null;
  errorDetail: string | null;
};

type GroupKey = "interesado" | "tal_vez" | "sin_intencion" | "baja" | "fallido";

const GROUPS: {
  key: GroupKey;
  title: string;
  hint: string;
  icon: LucideIcon;
  tone: string;
}[] = [
  {
    key: "interesado",
    title: "Interesados",
    hint: "Escribiles hoy: la ventana de 24 horas ya está abierta.",
    icon: ThumbsUp,
    tone: "border-tone-emerald-line bg-tone-emerald-soft text-tone-emerald-text",
  },
  {
    key: "tal_vez",
    title: "Tal vez",
    hint: "No es un no. Guardalos para la próxima.",
    icon: CircleHelp,
    tone: "border-tone-amber-line bg-tone-amber-soft text-tone-amber-text",
  },
  {
    key: "sin_intencion",
    title: "Contestaron",
    hint: "Escribieron algo en vez de tocar un botón: hay que leerlos.",
    icon: MessageSquareReply,
    tone: "border-tone-violet-line bg-tone-violet-soft text-tone-violet-text",
  },
  {
    key: "baja",
    title: "Se dieron de baja",
    hint: "No reciben más difusiones. Respetarlo cuida el número.",
    icon: ThumbsDown,
    tone: "border-tone-stone-line bg-tone-stone-soft text-tone-stone-text",
  },
  {
    key: "fallido",
    title: "No llegaron",
    hint: "Meta los rechazó. Casi siempre es un número mal cargado.",
    icon: TriangleAlert,
    tone: "border-tone-red-line bg-tone-red-soft text-tone-red-text",
  },
];

function groupOf(row: BroadcastRecipientRow): GroupKey {
  if (row.status === "fallido") return "fallido";
  if (row.intent === "interesado") return "interesado";
  if (row.intent === "tal_vez") return "tal_vez";
  if (row.intent === "baja") return "baja";
  return "sin_intencion";
}

/**
 * Los que reaccionaron, agrupados por lo que quisieron decir. Los interesados
 * arriba de todo: es la lista de trabajo del vendedor y tiene que poder
 * atacarla sin pasar por el CRM.
 */
export function RecipientsList({ rows }: { rows: BroadcastRecipientRow[] }) {
  const grupos = React.useMemo(() => {
    const map = new Map<GroupKey, BroadcastRecipientRow[]>();
    for (const row of rows) {
      const key = groupOf(row);
      const list = map.get(key);
      if (list) list.push(row);
      else map.set(key, [row]);
    }
    return map;
  }, [rows]);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title="Todavía no contestó nadie"
        description="Cuando alguien toque un botón o responda, va a aparecer acá con su nombre y lo que dijo."
      />
    );
  }

  return (
    <div className="space-y-5">
      {GROUPS.map((g) => {
        const items = grupos.get(g.key);
        if (!items || items.length === 0) return null;
        const Icon = g.icon;
        return (
          <section key={g.key}>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] font-medium",
                  g.tone,
                )}
              >
                <Icon className="size-3.5" strokeWidth={2} />
                {g.title}
                <span className="tabular-nums">{items.length}</span>
              </span>
              <p className="text-xs text-ink-faint">{g.hint}</p>
            </div>
            <div
              className={cn("mt-2 space-y-2", items.length <= 14 && "stagger-children")}
            >
              {items.map((row) => (
                <RecipientRow key={row.id} row={row} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function RecipientRow({ row }: { row: BroadcastRecipientRow }) {
  // El vendedor quiere el chat: ahí está la ventana abierta. El lead queda a un
  // toque de distancia, pero no es el destino por default.
  const chatHref = row.conversationId ? `/crm?vista=chats&c=${row.conversationId}` : null;
  const leadHref = row.leadId ? `/crm/${row.leadId}` : null;
  const href = chatHref ?? leadHref ?? `/clientes/${row.contactId}`;

  return (
    <div className="flex items-stretch gap-2">
      <Link
        href={href}
        className="card card-hover flex min-w-0 flex-1 items-center gap-3 p-3 tap-highlight-none active:bg-sand-soft/50"
      >
        <Avatar name={row.name} className="size-9" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-ink">{row.name}</p>
          <p className="truncate text-[13px] text-ink-faint">{detalle(row)}</p>
        </div>
        {row.repliedAt && (
          <span className="hidden shrink-0 text-[11px] text-ink-faint sm:block">
            {fmtRelative(row.repliedAt)}
          </span>
        )}
        <ChevronRight className="size-4 shrink-0 text-ink-faint" strokeWidth={2} />
      </Link>

      {chatHref && leadHref && (
        <Tooltip content="Abrir el lead">
          <Link
            href={leadHref}
            aria-label={`Abrir el lead de ${row.name}`}
            className="flex w-11 shrink-0 items-center justify-center rounded-2xl border border-line bg-paper text-ink-faint transition-colors hover:border-line-strong hover:text-ink tap-highlight-none"
          >
            <UserRound className="size-4" strokeWidth={2} />
          </Link>
        </Tooltip>
      )}
    </div>
  );
}

/** La segunda línea: qué hizo esta persona, en criollo. */
function detalle(row: BroadcastRecipientRow): string {
  if (row.status === "fallido") {
    return row.errorDetail?.trim() || `No se pudo entregar a ${fmtPhone(row.phone)}`;
  }
  if (row.buttonLabel) return `Tocó "${row.buttonLabel}"`;
  if (row.replyText?.trim()) return row.replyText.trim();
  return "Respondió";
}
