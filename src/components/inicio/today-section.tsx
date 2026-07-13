import Link from "next/link";
import { cn } from "@/lib/utils";
import { fmtDue } from "@/lib/format";
import { EmptyState } from "@/components/ui/misc";

export type AgendaItem = {
  id: string;
  contactName: string;
  destination: string | null;
  nextAction: string | null;
  nextActionAt: string;
};

export function TodaySection({
  newLeads,
  followupsCount,
  overdueCount,
  unread,
  agenda,
}: {
  newLeads: number;
  followupsCount: number;
  overdueCount: number;
  unread: number;
  agenda: AgendaItem[];
}) {
  return (
    <section className="animate-slide-up">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        Para hoy
      </h2>

      {/* cards accionables */}
      <div className="mt-3 grid grid-cols-3 gap-2 md:gap-3">
        <ActionCard
          href="/crm"
          emoji="✨"
          count={newLeads}
          label="Leads sin atender"
          highlight={newLeads > 0}
        />
        <ActionCard
          href="/crm"
          emoji="⏰"
          count={followupsCount}
          label="Seguimientos"
          danger={overdueCount > 0}
          hint={
            overdueCount > 0
              ? `${overdueCount} vencido${overdueCount === 1 ? "" : "s"}`
              : undefined
          }
        />
        <ActionCard href="/crm?vista=chats" emoji="💬" count={unread} label="Chats sin leer" />
      </div>

      {/* agenda del día */}
      <div className="mt-4">
        <p className="mb-2 text-[13px] font-medium text-ink-soft">Agenda de hoy</p>
        {agenda.length === 0 ? (
          <EmptyState
            emoji="☀️"
            title="Día despejado"
            description="No tenés seguimientos pendientes. ¿Un toque a los presupuestados?"
            className="py-8"
          />
        ) : (
          <div className="card divide-y divide-line overflow-hidden">
            {agenda.slice(0, 6).map((item) => {
              const due = fmtDue(item.nextActionAt);
              return (
                <Link
                  key={item.id}
                  href={`/crm/${item.id}`}
                  className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-sand-soft/60 tap-highlight-none"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {item.contactName}
                      {item.destination && (
                        <span className="font-normal text-ink-faint"> · {item.destination}</span>
                      )}
                    </p>
                    <p className="truncate text-[13px] text-ink-soft">
                      {item.nextAction ?? "Seguimiento"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 text-xs font-medium tabular-nums",
                      due.overdue
                        ? "text-red-600"
                        : due.today
                          ? "text-brand-700"
                          : "text-ink-faint",
                    )}
                  >
                    {due.label}
                  </span>
                </Link>
              );
            })}
            {followupsCount > 6 && (
              <Link
                href="/crm"
                className="block px-4 py-3 text-center text-[13px] font-medium text-brand-700 transition-colors hover:bg-brand-50 tap-highlight-none"
              >
                Ver todos ({followupsCount})
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ActionCard({
  href,
  emoji,
  count,
  label,
  highlight,
  danger,
  hint,
}: {
  href: string;
  emoji: string;
  count: number;
  label: string;
  highlight?: boolean;
  danger?: boolean;
  hint?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "card relative flex flex-col p-3 transition-all hover:-translate-y-px hover:border-line-strong hover:shadow-md tap-highlight-none md:p-4",
        highlight && "border-brand-300",
        danger && "border-red-200",
      )}
    >
      {highlight && (
        <span className="absolute right-3 top-3 size-2 rounded-full bg-brand-500 animate-pulse-dot" />
      )}
      <span className="text-base leading-none md:text-lg">{emoji}</span>
      <p
        className={cn(
          "mt-1.5 text-2xl font-semibold leading-none tabular-nums md:text-3xl",
          danger ? "text-red-600" : "text-ink",
        )}
      >
        {count}
      </p>
      <p className="mt-1 text-[11px] leading-tight text-ink-soft md:text-xs">{label}</p>
      {hint && <p className="mt-0.5 text-[10px] font-medium text-red-600">{hint}</p>}
    </Link>
  );
}
