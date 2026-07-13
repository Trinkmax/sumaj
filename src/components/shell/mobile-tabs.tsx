"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  MoreHorizontal,
  Users,
  Wallet,
  Settings,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_MOBILE } from "./nav";
import { createClient } from "@/lib/supabase/client";
import { ThemeToggle } from "./theme";

const MORE_ITEMS = [
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/caja", label: "Caja", icon: Wallet },
  { href: "/config", label: "Configuración", icon: Settings },
];

export function MobileTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE_ITEMS.some((i) => pathname.startsWith(i.href));

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {moreOpen && (
        <div
          className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px] animate-fade-in md:hidden"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="absolute inset-x-3 bottom-[calc(64px+env(safe-area-inset-bottom)+8px)] rounded-3xl border border-line bg-paper p-2 shadow-2xl animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {MORE_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-2xl px-4 py-3.5 text-[15px] font-medium transition-colors tap-highlight-none",
                  pathname.startsWith(item.href)
                    ? "bg-sand-soft text-ink"
                    : "text-ink-soft active:bg-sand-soft",
                )}
              >
                <item.icon className="size-5 text-ink-faint" />
                {item.label}
              </Link>
            ))}
            <div className="mx-3 my-1 h-px bg-line" />
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-[15px] font-medium text-ink-soft">Tema</span>
              <ThemeToggle />
            </div>
            <div className="mx-3 my-1 h-px bg-line" />
            <button
              onClick={logout}
              className="flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-[15px] font-medium text-tone-red-text transition-colors tap-highlight-none active:bg-tone-red-soft"
            >
              <LogOut className="size-5" />
              Cerrar sesión
            </button>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden">
        <div className="grid h-16 grid-cols-5">
          {NAV_MOBILE.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className="flex flex-col items-center justify-center gap-1 tap-highlight-none"
              >
                <item.icon
                  className={cn(
                    "size-[22px] transition-all duration-200",
                    active ? "scale-110 text-brand-text" : "text-ink-faint",
                  )}
                  strokeWidth={active ? 2.4 : 2}
                />
                <span
                  className={cn(
                    "text-[10px] font-medium leading-none",
                    active ? "text-brand-text" : "text-ink-faint",
                  )}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
          <button
            onClick={() => setMoreOpen((o) => !o)}
            className="flex flex-col items-center justify-center gap-1 tap-highlight-none"
          >
            <MoreHorizontal
              className={cn(
                "size-[22px] transition-all duration-200",
                moreActive || moreOpen ? "scale-110 text-brand-text" : "text-ink-faint",
              )}
            />
            <span
              className={cn(
                "text-[10px] font-medium leading-none",
                moreActive || moreOpen ? "text-brand-text" : "text-ink-faint",
              )}
            >
              Más
            </span>
          </button>
        </div>
      </nav>
    </>
  );
}
