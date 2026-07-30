import Link from "next/link";
import { Clock, MessageCircle, Plus, Sparkles, Sun, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDue } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export type AgendaItem = {
  id: string;
  contactName: string;
  destination: string | null;
  nextAction: string | null;
  nextActionAt: string;
};

const TONE_CIRCLE: Record<"sky" | "amber" | "green", string> = {
  sky: "bg-tone-sky-soft text-tone-sky-text",
  amber: "bg-tone-amber-soft text-tone-amber-text",
  green: "bg-tone-green-soft text-tone-green-text",
};

/**
 * "Para hoy": 3 tarjetas de acción tappables + agenda compacta del día.
 * Server component: solo links, sin estado.
 */
export function TodaySection({
  newLeads,
  followupsCount,
  overdueCount,
  unread,
  agenda,
  emptyPipeline,
}: {
  newLeads: number;
  followupsCount: number;
  overdueCount: number;
  unread: number;
  agenda: AgendaItem[];
  /** true cuando no hay cartera todavía: el vacío invita a cargar, no a seguir */
  emptyPipeline: boolean;
}) {
  return (
    <section className="flex h-full flex-col">
      <h2 className="text-sm font-medium text-ink-soft">Para hoy</h2>

      {/* cards accionables */}
      <div className="mt-2 grid grid-cols-3 gap-2 md:gap-3 stagger-children">
        <ActionCard
          href="/crm"
          icon={Sparkles}
          tone="sky"
          count={newLeads}
          label="Leads sin atender"
          pulse={newLeads > 0 ? "brand" : undefined}
        />
        <ActionCard
          href="/crm"
          icon={Clock}
          tone="amber"
          count={followupsCount}
          label="Seguimientos"
          danger={overdueCount > 0}
          pulse={overdueCount > 0 ? "red" : undefined}
          hint={
            overdueCount > 0
              ? `${overdueCount} vencido${overdueCount === 1 ? "" : "s"}`
              : undefined
          }
        />
        <ActionCard
          href="/crm?vista=chats"
          icon={MessageCircle}
          tone="green"
          count={unread}
          label="Chats sin leer"
        />
      </div>

      {/* agenda del día */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col md:mt-4">
        {agenda.length === 0 ? (
          emptyPipeline ? (
            <EmptyState
              icon={Sparkles}
              title="Todo listo para arrancar"
              description="Cargá tu primer lead y acá te van a aparecer los seguimientos del día."
              action={
                <Link href="/crm">
                  <Button variant="brand">
                    <Plus /> Cargar el primer lead
                  </Button>
                </Link>
              }
              className="h-full flex-1 py-6"
            />
          ) : (
            <EmptyState
              icon={Sun}
              title="Día despejado"
              description="No tenés seguimientos pendientes. ¿Un toque a los presupuestados?"
              className="h-full flex-1 py-6"
            />
          )
        ) : (
          <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
            <p className="shrink-0 border-b border-line px-3.5 py-2 text-[13px] font-medium text-ink-soft">
              Agenda de hoy
            </p>
            <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto stagger-children">
              {agenda.slice(0, 5).map((item) => {
                const due = fmtDue(item.nextActionAt);
                return (
                  <Link
                    key={item.id}
                    href={`/crm/${item.id}`}
                    className="flex min-h-11 items-center gap-3 px-3.5 py-2 transition-colors hover:bg-sand-soft/60 active:bg-sand-soft tap-highlight-none"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        {item.contactName}
                        {item.destination && (
                          <span className="font-normal text-ink-faint">
                            {" "}
                            · {item.destination}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-ink-soft">
                        {item.nextAction ?? "Seguimiento"}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 text-xs font-medium tabular-nums",
                        due.overdue
                          ? "text-tone-red-text"
                          : due.today
                            ? "text-brand-text"
                            : "text-ink-faint",
                      )}
                    >
                      {due.label}
                    </span>
                  </Link>
                );
              })}
              {followupsCount > 5 && (
                <Link
                  href="/crm"
                  className="block px-3.5 py-2.5 text-center text-[13px] font-medium text-brand-text transition-colors hover:bg-brand-tint tap-highlight-none"
                >
                  Ver todos ({followupsCount})
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ActionCard({
  href,
  icon: Icon,
  tone,
  count,
  label,
  danger,
  hint,
  pulse,
}: {
  href: string;
  icon: LucideIcon;
  tone: keyof typeof TONE_CIRCLE;
  count: number;
  label: string;
  danger?: boolean;
  hint?: string;
  /** muestra un punto que late arriba a la derecha */
  pulse?: "brand" | "red";
}) {
  return (
    <Link
      href={href}
      className="card card-hover relative flex flex-col gap-2 p-3 transition-transform active:scale-[0.98] tap-highlight-none md:p-3.5"
    >
      {pulse && (
        <span
          className={cn(
            "absolute right-3 top-3 size-2 rounded-full animate-pulse-dot",
            pulse === "red" ? "bg-red-500" : "bg-brand-500",
          )}
        />
      )}
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          TONE_CIRCLE[tone],
        )}
      >
        <Icon className="size-4" strokeWidth={1.9} />
      </span>
      <div>
        <p
          className={cn(
            "text-2xl font-semibold leading-none tabular-nums md:text-[26px]",
            danger ? "text-tone-red-text" : "text-ink",
          )}
        >
          {count}
        </p>
        <p className="mt-1 text-[11px] leading-tight text-ink-soft md:text-xs">{label}</p>
        {hint && (
          <p className="mt-0.5 text-[10px] font-semibold text-tone-red-text">{hint}</p>
        )}
      </div>
    </Link>
  );
}
