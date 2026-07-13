"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Users,
  Tags,
  Handshake,
  MessageSquareText,
  AlarmClock,
  Smartphone,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "/config/agencia", label: "Agencia", icon: Building2 },
  { href: "/config/equipo", label: "Equipo", icon: Users },
  { href: "/config/etiquetas", label: "Etiquetas", icon: Tags },
  { href: "/config/proveedores", label: "Proveedores", icon: Handshake },
  { href: "/config/plantillas", label: "Plantillas", icon: MessageSquareText },
  { href: "/config/seguimiento", label: "Seguimiento", icon: AlarmClock },
  { href: "/config/whatsapp", label: "WhatsApp", icon: Smartphone },
];

/** Tabs horizontales compartidas por todas las subpáginas de configuración. */
export function ConfigNav() {
  const pathname = usePathname();

  return (
    <div className="sticky top-[53px] z-20 border-b border-line bg-cream/90 backdrop-blur-lg md:static md:top-auto md:border-0 md:bg-transparent md:backdrop-blur-none">
      <nav
        className="flex items-center gap-1.5 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:px-6"
        aria-label="Secciones de configuración"
      >
        <Link
          href="/config"
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none"
          aria-label="Volver a configuración"
        >
          <ChevronLeft className="size-4.5" />
        </Link>
        {SECTIONS.map((s) => {
          const active = pathname.startsWith(s.href);
          return (
            <Link
              key={s.href}
              href={s.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-all tap-highlight-none",
                active
                  ? "border-ink bg-ink text-cream shadow-sm"
                  : "border-line bg-paper text-ink-soft hover:border-line-strong hover:text-ink",
              )}
            >
              <s.icon className="size-3.5" />
              {s.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
