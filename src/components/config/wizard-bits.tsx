"use client";

/**
 * Las piezas compartidas de los asistentes de conexión con Meta
 * (Configuración → WhatsApp y Configuración → Instagram).
 *
 * Salieron de whatsapp-settings.tsx cuando apareció el segundo asistente: son
 * dos pantallas distintas que cuentan la misma historia —pegá estos datos,
 * copiá esto en Meta, mirá el semáforo— y tienen que verse exactamente igual.
 * Duplicarlas garantizaba que en tres meses una tuviera el foco bien y la otra
 * no.
 */

import * as React from "react";
import {
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Copy,
  Eye,
  EyeOff,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/* ───────────────────────── portapapeles ───────────────────────── */

export async function copyToClipboard(text: string, okMessage: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMessage);
    return true;
  } catch {
    toast.error("No se pudo copiar. Copialo a mano.");
    return false;
  }
}

/** Miga de pan inline para las rutas del panel de Meta (reemplaza los "→"). */
export function Crumb({ parts }: { parts: string[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-0.5 align-baseline font-medium text-ink">
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <ChevronRight className="size-3 shrink-0 text-ink-faint" aria-hidden />}
          {p}
        </React.Fragment>
      ))}
    </span>
  );
}

/* ───────────────────────── pasos ───────────────────────── */

/** Un paso del asistente: número (o tilde cuando ya está hecho) + título. */
export function Step({
  n,
  title,
  description,
  done,
  children,
}: {
  n: number;
  title: string;
  description: React.ReactNode;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-line p-5 first:border-t-0">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums transition-colors",
            done ? "bg-tone-emerald-soft text-tone-emerald-text" : "bg-ink text-cream",
          )}
          aria-hidden
        >
          {done ? <Check className="size-4 animate-check-pop" strokeWidth={2.5} /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{description}</p>
        </div>
      </div>
      <div className="mt-4 sm:pl-10">{children}</div>
    </div>
  );
}

/* ───────────────────────── campos ───────────────────────── */

/** Campo de credencial sensible: ojo para mirar lo que se pega, nada más. */
export function SecretField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  loaded,
  loadedLabel,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint: React.ReactNode;
  loaded: boolean;
  loadedLabel: string;
  disabled?: boolean;
}) {
  const [show, setShow] = React.useState(false);
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <Label htmlFor={id} className="mb-0">
          {label}
        </Label>
        {loaded && (
          <span className="inline-flex items-center gap-1 rounded-full border border-tone-emerald-line bg-tone-emerald-soft px-2 py-0.5 text-[11px] font-medium leading-4 text-tone-emerald-text">
            <Check className="size-3" strokeWidth={2.75} aria-hidden />
            {loadedLabel}
          </span>
        )}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          className="h-11 pr-11 font-mono text-[13px]"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
          className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">{hint}</p>
    </div>
  );
}

/** Campo de dato público (los IDs de Meta): mismo aire, sin ojo. */
export function IdField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\s/g, ""))}
        placeholder={placeholder}
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={30}
        disabled={disabled}
        className="h-11 font-mono text-[13px]"
      />
      <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">{hint}</p>
    </div>
  );
}

/* ───────────────────────── diagnóstico ───────────────────────── */

export type CheckLevel = "ok" | "warn" | "error" | "pending";

/** Un renglón del semáforo. Los dos asistentes lo pintan igual. */
export type WizardCheck = {
  label: string;
  level: CheckLevel;
  detail: string;
  /** Qué tiene que hacer el admin si no está en verde. */
  action: string | null;
};

const CHECK_META: Record<CheckLevel, { icon: LucideIcon; color: string }> = {
  ok: { icon: CircleCheck, color: "text-tone-emerald-text" },
  warn: { icon: TriangleAlert, color: "text-tone-amber-text" },
  error: { icon: CircleAlert, color: "text-tone-red-text" },
  pending: { icon: CircleDashed, color: "text-tone-stone-text" },
};

export function CheckRow({ check }: { check: WizardCheck }) {
  const meta = CHECK_META[check.level] ?? CHECK_META.pending;
  return (
    <li className="flex items-start gap-3">
      <meta.icon
        className={cn("mt-0.5 size-4.5 shrink-0", meta.color)}
        strokeWidth={1.9}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{check.label}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{check.detail}</p>
        {check.action && (
          <p className="mt-1.5 rounded-xl bg-sand-soft/70 px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
            {check.action}
          </p>
        )}
      </div>
    </li>
  );
}

/* ───────────────────────── copiar un valor ───────────────────────── */

/**
 * Un dato para pegar en el panel de Meta, con su botón de copiar.
 *
 * En WhatsApp esto es una comodidad; en Instagram es imprescindible: la callback
 * URL y el verify token se cargan a mano sí o sí, porque Meta no deja
 * configurarlos por API. Por eso el bloque es grande y legible en vez de un
 * `code` chiquito.
 */
export function CopyRow({
  label,
  value,
  copyMessage,
  mono = true,
}: {
  label: string;
  value: string;
  copyMessage: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    const ok = await copyToClipboard(value, copyMessage);
    if (!ok) return;
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-xl border border-line bg-sand-soft/60 p-3">
      <p className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code
          className={cn(
            "min-w-0 flex-1 truncate text-[13px] text-ink",
            mono && "font-mono",
          )}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copiar ${label.toLowerCase()}`}
          className="shrink-0 rounded-lg p-2.5 text-ink-faint transition-colors hover:bg-paper hover:text-ink tap-highlight-none active:scale-95"
        >
          {copied ? (
            <Check className="size-4 text-money-700 animate-check-pop" />
          ) : (
            <Copy className="size-4" />
          )}
        </button>
      </div>
    </div>
  );
}
