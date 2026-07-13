import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { PageHeader } from "@/components/shell/page-header";
import { ProfileCard } from "@/components/config/profile-card";

const SECTIONS = [
  {
    href: "/config/agencia",
    emoji: "🏢",
    title: "Agencia",
    description: "Nombre, logo, cotización USD y tema de presupuestos.",
  },
  {
    href: "/config/equipo",
    emoji: "👥",
    title: "Equipo",
    description: "Roles, comisiones e invitaciones.",
  },
  {
    href: "/config/etiquetas",
    emoji: "🏷️",
    title: "Etiquetas",
    description: "Organizá contactos por destino, temporada y más.",
  },
  {
    href: "/config/proveedores",
    emoji: "🤝",
    title: "Proveedores",
    description: "Mayoristas y sus comisiones por defecto.",
  },
  {
    href: "/config/plantillas",
    emoji: "💬",
    title: "Plantillas",
    description: "Mensajes de WhatsApp con variables.",
  },
  {
    href: "/config/seguimiento",
    emoji: "⏰",
    title: "Seguimiento automático",
    description: "Toques cuando el cliente no responde.",
  },
  {
    href: "/config/whatsapp",
    emoji: "📲",
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

        {isAdmin ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 animate-fade-in">
            {SECTIONS.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className="card group flex items-center gap-4 p-4 transition-all hover:-translate-y-px hover:border-line-strong hover:shadow-md tap-highlight-none"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-sand-soft text-xl">
                  {s.emoji}
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
          <p className="px-1 text-sm text-ink-faint animate-fade-in">
            El resto de la configuración lo maneja un admin de la agencia.
          </p>
        )}
      </div>
    </>
  );
}
