import Link from "next/link";
import {
  AlarmClock,
  Building2,
  ChevronRight,
  Handshake,
  MessageSquareText,
  Smartphone,
  Store,
  SunMoon,
  Tags,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { requireMember } from "@/lib/auth";
import { PageHeader } from "@/components/shell/page-header";
import { ProfileCard } from "@/components/config/profile-card";
import { ThemeToggle } from "@/components/shell/theme";

const SECTIONS: {
  href: string;
  icon: LucideIcon;
  tone: string;
  title: string;
  description: string;
}[] = [
  {
    href: "/config/agencia",
    icon: Building2,
    tone: "bg-brand-tint text-brand-text",
    title: "Agencia",
    description: "Nombre, logo, cotización USD y tema de presupuestos.",
  },
  {
    href: "/config/equipo",
    icon: UsersRound,
    tone: "bg-tone-sky-soft text-tone-sky-text",
    title: "Equipo",
    description: "Roles, comisiones e invitaciones.",
  },
  {
    href: "/config/sucursales",
    icon: Store,
    tone: "bg-tone-cyan-soft text-tone-cyan-text",
    title: "Sucursales",
    description: "Cada local con su equipo y su WhatsApp propio.",
  },
  {
    href: "/config/etiquetas",
    icon: Tags,
    tone: "bg-tone-amber-soft text-tone-amber-text",
    title: "Etiquetas",
    description: "Organizá contactos por destino, temporada y más.",
  },
  {
    href: "/config/proveedores",
    icon: Handshake,
    tone: "bg-tone-violet-soft text-tone-violet-text",
    title: "Proveedores",
    description: "Mayoristas y sus comisiones por defecto.",
  },
  {
    href: "/config/plantillas",
    icon: MessageSquareText,
    tone: "bg-tone-emerald-soft text-tone-emerald-text",
    title: "Plantillas",
    description: "Mensajes de WhatsApp con variables.",
  },
  {
    href: "/config/seguimiento",
    icon: AlarmClock,
    tone: "bg-tone-rose-soft text-tone-rose-text",
    title: "Seguimiento automático",
    description: "Toques cuando el cliente no responde.",
  },
  {
    href: "/config/whatsapp",
    icon: Smartphone,
    tone: "bg-tone-teal-soft text-tone-teal-text",
    title: "WhatsApp",
    description: "Conexión con la Cloud API de Meta.",
  },
];

export default async function ConfigPage() {
  const { member, isAdmin } = await requireMember();

  return (
    <>
      <PageHeader title="Configuración" subtitle="Tu perfil y los ajustes de la agencia." />

      <div className="space-y-5 px-4 md:px-6">
        <ProfileCard displayName={member.display_name} email={member.email} role={member.role} />

        {/* Apariencia: preferencia personal, disponible para todo el equipo */}
        <section className="card flex items-center gap-4 p-4 animate-fade-in">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-tone-indigo-soft text-tone-indigo-text">
            <SunMoon className="size-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink">Apariencia</p>
            <p className="mt-0.5 truncate text-[13px] text-ink-faint">
              Claro, oscuro o el del sistema.
            </p>
          </div>
          <ThemeToggle className="shrink-0" />
        </section>

        {isAdmin ? (
          <div className="grid gap-3 pb-2 sm:grid-cols-2 stagger-children">
            {SECTIONS.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className="card card-hover group flex items-center gap-4 p-4 tap-highlight-none"
              >
                <span
                  className={`flex size-11 shrink-0 items-center justify-center rounded-full ${s.tone}`}
                >
                  <s.icon className="size-5" strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">{s.title}</span>
                  <span className="mt-0.5 block truncate text-[13px] text-ink-faint">
                    {s.description}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        ) : (
          <p className="px-1 pb-2 text-sm text-ink-faint animate-fade-in">
            El resto de la configuración lo maneja un admin de la agencia.
          </p>
        )}
      </div>
    </>
  );
}
