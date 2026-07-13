import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Empty state compartido (icono lucide, nunca emoji).
 * SIN "use client": no usa hooks, así puede renderizarse también desde
 * Server Components pasándole `icon` sin cruzar el límite de serialización.
 * Los client components pueden importarlo desde acá o desde ui/misc.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong/70 px-6 py-12 text-center animate-fade-in",
        className,
      )}
    >
      {Icon && (
        <div className="mb-1 flex size-14 items-center justify-center rounded-full bg-sand-soft text-ink-faint ring-4 ring-sand-soft/40">
          <Icon className="size-6" strokeWidth={1.75} />
        </div>
      )}
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="max-w-sm text-sm text-ink-faint">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
