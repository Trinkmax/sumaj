"use client";

import * as React from "react";
import { Moon, Sun, MonitorSmartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/misc";

/**
 * Tema claro/oscuro de viajerOS.
 * - La preferencia vive en localStorage("viajeros:theme"): "light" | "dark" | "system".
 * - El <script> de ThemeScript la aplica ANTES del primer paint (sin flash).
 * - data-theme en <html> es siempre "light" o "dark" resuelto.
 */

const KEY = "viajeros:theme";
const EVENT = "viajeros:theme-change";

export type ThemePref = "light" | "dark" | "system";

export function ThemeScript() {
  const code = `(function(){try{var p=localStorage.getItem("${KEY}");var d=p==="dark"||(p!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light";}catch(e){document.documentElement.dataset.theme="light";}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

function readPref(): ThemePref {
  if (typeof window === "undefined") return "system";
  const p = window.localStorage.getItem(KEY);
  return p === "light" || p === "dark" ? p : "system";
}

function resolve(pref: ThemePref): "light" | "dark" {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(pref: ThemePref) {
  document.documentElement.dataset.theme = resolve(pref);
}

export function setThemePref(pref: ThemePref) {
  window.localStorage.setItem(KEY, pref);
  apply(pref);
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  // "system" en SSR y primer render (mismo markup → sin mismatch de hidratación)
  const [pref, setPref] = React.useState<ThemePref>("system");

  React.useEffect(() => {
    setPref(readPref());
    const onChange = () => setPref(readPref());
    window.addEventListener(EVENT, onChange);
    // si la preferencia es "system", seguir los cambios del SO en vivo
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onMq = () => {
      if (readPref() === "system") apply("system");
    };
    mq.addEventListener("change", onMq);
    return () => {
      window.removeEventListener(EVENT, onChange);
      mq.removeEventListener("change", onMq);
    };
  }, []);

  return [pref, setThemePref];
}

const OPTIONS: { value: ThemePref; icon: typeof Sun; label: string }[] = [
  { value: "light", icon: Sun, label: "Claro" },
  { value: "dark", icon: Moon, label: "Oscuro" },
  { value: "system", icon: MonitorSmartphone, label: "Según el sistema" },
];

/** Botón único que cicla claro → oscuro → sistema (sidebar colapsada). */
export function ThemeToggleCompact({ className }: { className?: string }) {
  const [pref, setPref] = useThemePref();
  const idx = OPTIONS.findIndex((o) => o.value === pref);
  const current = OPTIONS[idx === -1 ? 2 : idx];
  const next = OPTIONS[((idx === -1 ? 2 : idx) + 1) % OPTIONS.length];
  return (
    <Tooltip content={`Tema: ${current.label}`} side="right">
      <button
        aria-label={`Cambiar tema (actual: ${current.label})`}
        onClick={() => setPref(next.value)}
        className={cn(
          "rounded-lg p-2 text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none",
          className,
        )}
      >
        <current.icon className="size-4" />
      </button>
    </Tooltip>
  );
}

/** Selector compacto de tema: tres iconos, el activo con fondo. */
export function ThemeToggle({ className }: { className?: string }) {
  const [pref, setPref] = useThemePref();
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-line bg-sand-soft/70 p-0.5",
        className,
      )}
      role="radiogroup"
      aria-label="Tema"
    >
      {OPTIONS.map((o) => (
        <Tooltip key={o.value} content={o.label}>
          <button
            role="radio"
            aria-checked={pref === o.value}
            aria-label={o.label}
            onClick={() => setPref(o.value)}
            className={cn(
              "flex size-7 items-center justify-center rounded-full transition-all duration-150 tap-highlight-none",
              pref === o.value
                ? "bg-paper text-ink shadow-sm"
                : "text-ink-faint hover:text-ink-soft",
            )}
          >
            <o.icon className="size-3.5" />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
