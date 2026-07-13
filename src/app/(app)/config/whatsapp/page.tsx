import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { PageHeader } from "@/components/shell/page-header";
import { ConfigNav } from "@/components/config/config-nav";
import { WhatsappSettings } from "@/components/config/whatsapp-settings";
import type { AgencySettings } from "@/lib/types";

export default async function WhatsappPage() {
  const { agency, isAdmin } = await requireMember();
  if (!isAdmin) redirect("/config");

  const settings = (agency.settings ?? {}) as Partial<AgencySettings>;

  return (
    <>
      <PageHeader title="WhatsApp" subtitle="La conexión con la Cloud API de Meta." />
      <ConfigNav />

      <div className="mx-auto mt-4 max-w-3xl px-4 md:mx-0 md:px-6">
        <WhatsappSettings
          initial={{
            connected: settings.whatsapp?.connected ?? false,
            display_number: settings.whatsapp?.display_number ?? null,
            phone_number_id: settings.whatsapp?.phone_number_id ?? null,
          }}
        />
      </div>
    </>
  );
}
