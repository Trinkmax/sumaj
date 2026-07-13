import { cn } from "@/lib/utils";
import { TAG_COLORS } from "@/lib/domain";

export function Badge({
  className,
  color,
  children,
}: {
  className?: string;
  /** key de TAG_COLORS o clases directas via className */
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        color ? TAG_COLORS[color] ?? TAG_COLORS.gray : "border-line bg-sand-soft text-ink-soft",
        className,
      )}
    >
      {children}
    </span>
  );
}
