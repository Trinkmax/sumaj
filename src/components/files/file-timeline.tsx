import { ACTIVITY_TYPES } from "@/lib/domain";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ActivityRow } from "./types";

export function FileTimeline({
  activities,
  className,
}: {
  activities: ActivityRow[];
  className?: string;
}) {
  return (
    <section className={cn("card animate-fade-in p-4 md:p-5", className)}>
      <h2 className="mb-3 font-display text-lg font-semibold text-ink">Historial</h2>

      {activities.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-ink-faint">
          Todavía no hay actividad en este file.
        </p>
      ) : (
        <ol className="relative space-y-4 before:absolute before:inset-y-1 before:left-[15px] before:w-px before:bg-line">
          {activities.map((a) => {
            const meta = ACTIVITY_TYPES[a.type];
            const Icon = meta.icon;
            return (
              <li key={a.id} className="relative flex gap-3">
                <span
                  className="z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-ink-faint"
                  title={meta.label}
                >
                  <Icon className="size-3.5" strokeWidth={1.9} />
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <p className="text-sm leading-snug text-ink">{a.body}</p>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {a.member_name ? `${a.member_name} · ` : ""}
                    {fmtRelative(a.created_at)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
