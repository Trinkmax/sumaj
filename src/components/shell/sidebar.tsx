"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_MAIN, NAV_CONFIG } from "./nav";
import { Avatar } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";
import { Tooltip } from "@/components/ui/misc";
import { openCommandPalette, useSearchShortcutLabel } from "./command-palette";
import { ThemeToggle, ThemeToggleCompact } from "./theme";
import { NotificationsBell } from "./notifications-bell";

/** Botón de lupa para el header mobile (mismo estilo que la campana). */
export function MobileSearchButton() {
  return (
    <button
      onClick={openCommandPalette}
      aria-label="Buscar"
      className="rounded-full p-2 text-ink-soft transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none"
    >
      <Search className="size-5" />
    </button>
  );
}

export function Sidebar({
  agencyName,
  agencyLogoUrl,
  memberName,
  roleLabel,
  memberId,
  isStaff,
}: {
  agencyName: string;
  agencyLogoUrl: string | null;
  memberName: string;
  roleLabel: string;
  memberId: string;
  /** admin o vendedor. Difusiones es de la agencia (número madre): el freelance no la ve */
  isStaff: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const navItems = isStaff ? NAV_MAIN : NAV_MAIN.filter((i) => i.href !== "/difusiones");
  // false en SSR y primer render del cliente (mismo markup → sin mismatch de hidratación);
  // el estado guardado se aplica apenas monta
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (window.localStorage.getItem("shell:collapsed") === "1") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem("shell:collapsed", next ? "1" : "0");
      return next;
    });
  }

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const configActive = pathname.startsWith(NAV_CONFIG.href);
  const shortcutLabel = useSearchShortcutLabel();

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden border-r border-line bg-cream transition-[width] duration-200 md:flex",
        collapsed ? "w-[64px]" : "w-60",
      )}
    >
      {/* ── logo + colapso ── */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-3 px-2 pt-4">
          <Tooltip content="Expandir" side="right">
            <button
              onClick={toggleCollapsed}
              aria-label="Expandir barra lateral"
              className="rounded-lg p-2 text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none"
            >
              <PanelLeftOpen className="size-[18px]" />
            </button>
          </Tooltip>
          <Link href="/inicio" className="block tap-highlight-none" aria-label={agencyName}>
            {agencyLogoUrl ? (
              <img
                src={agencyLogoUrl}
                alt={agencyName}
                className="h-7 w-auto max-w-[44px] object-contain dark:rounded-md dark:bg-white/90 dark:p-0.5"
              />
            ) : (
              <span className="font-display text-xl font-semibold text-ink">
                {agencyName.charAt(0)}
              </span>
            )}
          </Link>
          <NotificationsBell memberId={memberId} />
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2 px-4 pt-5">
          <Link href="/inicio" className="block min-w-0 tap-highlight-none">
            {agencyLogoUrl ? (
              <img
                src={agencyLogoUrl}
                alt={agencyName}
                className="h-9 w-auto max-w-[160px] object-contain dark:rounded-lg dark:bg-white/90 dark:p-1"
              />
            ) : (
              <span className="block truncate font-display text-[22px] font-semibold tracking-tight text-ink">
                {agencyName}
              </span>
            )}
          </Link>
          <div className="flex shrink-0 items-center">
            <NotificationsBell memberId={memberId} />
            <Tooltip content="Modo foco">
              <button
                onClick={toggleCollapsed}
                aria-label="Modo foco"
                className="shrink-0 rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none"
              >
                <PanelLeftClose className="size-[18px]" />
              </button>
            </Tooltip>
          </div>
        </div>
      )}

      {/* ── buscador ── */}
      <div className={cn("mt-4", collapsed ? "flex justify-center px-2" : "px-3")}>
        {collapsed ? (
          <Tooltip content={`Buscar (${shortcutLabel})`} side="right">
            <button
              onClick={openCommandPalette}
              aria-label="Buscar"
              className="flex size-10 items-center justify-center rounded-xl border border-line bg-paper text-ink-faint transition-colors hover:border-line-strong hover:text-ink tap-highlight-none"
            >
              <Search className="size-4" />
            </button>
          </Tooltip>
        ) : (
          <button
            onClick={openCommandPalette}
            className="flex w-full items-center gap-2 overflow-hidden whitespace-nowrap rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink-faint transition-colors hover:border-line-strong hover:text-ink-soft tap-highlight-none"
          >
            <Search className="size-4 shrink-0" />
            <span className="flex-1 text-left">Buscar…</span>
            <kbd className="rounded-md border border-line bg-cream px-1.5 py-0.5 font-sans text-[10px] font-medium text-ink-faint">
              {shortcutLabel}
            </kbd>
          </button>
        )}
      </div>

      {/* ── navegación ── */}
      <nav
        className={cn(
          "mt-4 flex-1 space-y-0.5",
          collapsed ? "flex flex-col items-center px-2" : "px-3",
        )}
      >
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          if (collapsed) {
            return (
              <Tooltip key={item.href} content={item.label} side="right">
                <Link
                  href={item.href}
                  aria-label={item.label}
                  className={cn(
                    "group flex size-10 items-center justify-center rounded-xl transition-all duration-150 tap-highlight-none",
                    active
                      ? "bg-ink text-cream shadow-sm"
                      : "text-ink-soft hover:bg-sand-soft hover:text-ink",
                  )}
                >
                  <item.icon className="size-[18px]" />
                </Link>
              </Tooltip>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 overflow-hidden whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 tap-highlight-none",
                active
                  ? "bg-ink text-cream shadow-sm"
                  : "text-ink-soft hover:bg-sand-soft hover:text-ink",
              )}
            >
              <item.icon className="size-[18px] shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* ── configuración + cuenta ── */}
      {collapsed ? (
        <div className="flex flex-col items-center gap-1.5 px-2 pb-4">
          <Tooltip content={NAV_CONFIG.label} side="right">
            <Link
              href={NAV_CONFIG.href}
              aria-label={NAV_CONFIG.label}
              className={cn(
                "group flex size-10 items-center justify-center rounded-xl transition-colors tap-highlight-none",
                configActive
                  ? "bg-ink text-cream shadow-sm"
                  : "text-ink-soft hover:bg-sand-soft hover:text-ink",
              )}
            >
              <NAV_CONFIG.icon className="size-[18px]" />
            </Link>
          </Tooltip>
          <Tooltip content={memberName} side="right">
            <div className="p-1">
              <Avatar name={memberName} className="size-8 text-[11px]" />
            </div>
          </Tooltip>
          <ThemeToggleCompact />
          <Tooltip content="Cerrar sesión" side="right">
            <button
              onClick={logout}
              aria-label="Cerrar sesión"
              className="rounded-lg p-2 text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none"
            >
              <LogOut className="size-4" />
            </button>
          </Tooltip>
        </div>
      ) : (
        <div className="px-3 pb-3">
          <Link
            href={NAV_CONFIG.href}
            className={cn(
              "group flex items-center gap-3 overflow-hidden whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition-colors tap-highlight-none",
              configActive
                ? "bg-ink text-cream shadow-sm"
                : "text-ink-soft hover:bg-sand-soft hover:text-ink",
            )}
          >
            <NAV_CONFIG.icon className="size-[18px] shrink-0" />
            {NAV_CONFIG.label}
          </Link>
          <div className="mt-2 flex items-center gap-3 overflow-hidden whitespace-nowrap rounded-xl border border-line bg-paper px-3 py-2.5">
            <Avatar name={memberName} className="size-8 shrink-0 text-[11px]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink">{memberName}</p>
              <p className="text-[11px] text-ink-faint">{roleLabel}</p>
            </div>
            <Tooltip content="Cerrar sesión">
              <button
                onClick={logout}
                aria-label="Cerrar sesión"
                className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none"
              >
                <LogOut className="size-4" />
              </button>
            </Tooltip>
          </div>
          <div className="flex items-center justify-between pb-1 pt-3">
            <p className="text-[10px] tracking-wide text-ink-faint">hecho con viajerOS</p>
            <ThemeToggle />
          </div>
        </div>
      )}
    </aside>
  );
}
