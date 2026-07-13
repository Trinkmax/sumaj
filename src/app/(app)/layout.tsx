import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { Sidebar, MobileSearchButton } from "@/components/shell/sidebar";
import { MobileTabs } from "@/components/shell/mobile-tabs";
import { NotificationsBell } from "@/components/shell/notifications-bell";
import { CommandPalette } from "@/components/shell/command-palette";

const ROLE_LABELS = { admin: "Socio/Admin", vendedor: "Vendedor", freelance: "Freelance" };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { member, agency } = await requireMember();

  return (
    <div className="flex min-h-dvh">
      <Sidebar
        agencyName={agency.name}
        agencyLogoUrl={agency.logo_url}
        memberName={member.display_name}
        roleLabel={ROLE_LABELS[member.role]}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* header mobile */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-cream/90 px-4 py-3 backdrop-blur-lg md:hidden">
          <Link href="/inicio" className="min-w-0 tap-highlight-none">
            {agency.logo_url ? (
              <img
                src={agency.logo_url}
                alt={agency.name}
                className="h-7 w-auto max-w-[140px] object-contain"
              />
            ) : (
              <span className="block truncate font-display text-xl font-semibold tracking-tight text-ink">
                {agency.name}
              </span>
            )}
          </Link>
          <div className="flex items-center gap-1">
            <MobileSearchButton />
            <NotificationsBell memberId={member.id} />
          </div>
        </header>

        {/* campana en desktop, flotante arriba a la derecha */}
        <div className="pointer-events-none absolute right-6 top-5 z-30 hidden md:block">
          <div className="pointer-events-auto">
            <NotificationsBell memberId={member.id} />
          </div>
        </div>

        <main className="min-w-0 flex-1 pb-[calc(64px+env(safe-area-inset-bottom)+16px)] md:pb-8">
          {children}
        </main>
      </div>

      <MobileTabs />
      <CommandPalette />
    </div>
  );
}
