"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Popover ── */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 rounded-2xl border border-line bg-paper p-3 shadow-lg shadow-ink/5 outline-none",
          "origin-[var(--radix-popover-content-transform-origin)] data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

/* ── Tooltip ── */
export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className="z-50 rounded-lg bg-ink px-2.5 py-1.5 text-xs text-cream shadow-md animate-scale-in"
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

/* ── Switch ── */
export function Switch({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
        "data-[state=checked]:bg-money-700 data-[state=unchecked]:bg-line-strong",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
}

/* ── Checkbox ── */
export function Checkbox({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer size-5 shrink-0 rounded-md border border-line-strong bg-paper transition-colors",
        "data-[state=checked]:border-ink data-[state=checked]:bg-ink data-[state=checked]:text-cream",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center animate-check-pop">
        <Check className="size-3.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/* ── Skeleton ── */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

/* ── Segmented control (filtros tipo Todos / No leídos) ──
   Con "thumb" deslizante: la píldora activa viaja entre opciones. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = React.useState<{ left: number; width: number } | null>(null);

  const update = React.useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(`[data-seg="${CSS.escape(value)}"]`);
    if (!el) return;
    const c = container.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setThumb({ left: r.left - c.left, width: r.width });
  }, [value]);

  React.useLayoutEffect(update, [update, options.length]);
  React.useEffect(() => {
    window.addEventListener("resize", update);
    // labels que cambian de ancho sin cambiar value (contadores) también realinean
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      window.removeEventListener("resize", update);
      ro.disconnect();
    };
  }, [update]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative inline-flex items-center gap-0.5 rounded-full border border-line bg-sand-soft/70 p-0.5",
        className,
      )}
      role="tablist"
    >
      {thumb && (
        <span
          aria-hidden
          className="absolute rounded-full bg-paper shadow-sm transition-[left,width] duration-200 ease-out"
          style={{ left: thumb.left, width: thumb.width, top: 3, bottom: 3 }}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          data-seg={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative z-10 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors tap-highlight-none",
            value === o.value
              ? cn("text-ink", !thumb && "bg-paper shadow-sm")
              : "text-ink-faint hover:text-ink-soft",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── ChoiceGrid: selector visual (iconos + label) ──
   Para tipos de servicio, formas de pago, tipos de viaje, canales…
   Reemplaza <Select> donde las opciones son pocas y conocidas. */
const CHOICE_COLS: Record<2 | 3 | 4 | 5, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
};

/**
 * Cualquier icono que se pueda pintar en un tile: los de lucide y los de marca
 * que van a mano (`ui/brand-icons`), que lucide dejó de traer en la v1.
 */
export type TileIcon = React.ComponentType<{ className?: string; strokeWidth?: number }>;

export function ChoiceGrid<T extends string>({
  options,
  value,
  onChange,
  columns = 3,
  size = "md",
  className,
}: {
  options: { value: T; label: string; icon?: TileIcon; hint?: string }[];
  value: T | null | undefined;
  onChange: (v: T) => void;
  columns?: 2 | 3 | 4 | 5;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div className={cn("grid gap-2", CHOICE_COLS[columns], className)} role="radiogroup">
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative flex flex-col items-center justify-center gap-1.5 rounded-xl border text-center transition-all duration-150 tap-highlight-none active:scale-[0.97]",
              size === "sm" ? "px-2 py-2.5" : "px-2 py-3",
              selected
                ? "border-brand-500 bg-brand-tint text-brand-text shadow-sm"
                : "border-line bg-paper text-ink-soft hover:border-line-strong hover:bg-sand-soft/50",
            )}
          >
            {selected && (
              <span className="absolute -right-1.5 -top-1.5 flex size-4.5 items-center justify-center rounded-full bg-brand-600 text-white shadow-sm animate-check-pop">
                <Check className="size-3" strokeWidth={3} />
              </span>
            )}
            {o.icon && (
              <o.icon
                className={cn(
                  size === "sm" ? "size-4.5" : "size-5",
                  selected ? "text-brand-text" : "text-ink-faint",
                )}
                strokeWidth={1.9}
              />
            )}
            <span className={cn("font-medium leading-tight", size === "sm" ? "text-[11px]" : "text-xs")}>
              {o.label}
            </span>
            {o.hint && <span className="text-[10px] leading-tight text-ink-faint">{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ── AnimatedNumber: cuenta hacia el valor (KPIs del inicio) ── */
export function AnimatedNumber({
  value,
  from,
  format,
  duration = 700,
  className,
}: {
  value: number;
  /** valor inicial en el primer render (ej: 0 para contar al entrar) */
  from?: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const [display, setDisplay] = React.useState(from ?? value);
  // el valor realmente mostrado vive también en un ref: si el efecto se corta a
  // mitad de animación (StrictMode, cambio de value), la próxima arranca desde
  // donde quedó — nunca desde un "prev" fantasma que saltearía la animación.
  const displayRef = React.useRef(from ?? value);

  React.useEffect(() => {
    const start = displayRef.current;
    const end = value;
    if (start === end) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      displayRef.current = end;
      setDisplay(end);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      // el timestamp del primer frame puede ser ANTERIOR a t0 (vsync): clamp
      const p = Math.min(1, Math.max(0, (t - t0) / duration));
      const eased = 1 - Math.pow(1 - p, 3);
      const v = start + (end - start) * eased;
      displayRef.current = v;
      setDisplay(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  const fmt = format ?? ((n: number) => Math.round(n).toLocaleString("es-AR"));
  return <span className={cn("tabular-nums", className)}>{fmt(display)}</span>;
}

/* ── ProgressRing: anillo de progreso animado (usa currentColor) ── */
export function ProgressRing({
  value,
  size = 48,
  strokeWidth = 5,
  className,
  children,
}: {
  /** 0..1 */
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      {children && (
        <div className="absolute inset-0 flex items-center justify-center">{children}</div>
      )}
    </div>
  );
}

/* ── Empty state ──
   Vive en ui/empty-state (módulo compartido, sin "use client") para poder
   usarse desde Server Components con `icon`. Re-export para los client. */
export { EmptyState } from "./empty-state";
