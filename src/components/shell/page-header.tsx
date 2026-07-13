import { cn } from "@/lib/utils";

/**
 * Header estándar de página. Usarlo en todas las páginas del app
 * para mantener consistencia de jerarquía y espaciado.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-3 px-4 pb-4 pt-5 md:px-6 md:pt-7",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="font-display text-[26px] font-semibold leading-tight tracking-tight text-ink md:text-[30px]">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
