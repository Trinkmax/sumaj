import { cn } from "@/lib/utils";
import { avatarColor, initials } from "@/lib/format";

export function Avatar({
  name,
  className,
  src,
}: {
  name: string | null | undefined;
  className?: string;
  src?: string | null;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name ?? ""}
        className={cn("size-9 shrink-0 rounded-full object-cover", className)}
      />
    );
  }
  return (
    <div
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        avatarColor(name),
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}
