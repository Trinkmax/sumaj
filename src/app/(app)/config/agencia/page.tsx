import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { PageHeader } from "@/components/shell/page-header";
import { ConfigNav } from "@/components/config/config-nav";
import { AgencyForm } from "@/components/config/agency-form";
import { DEFAULT_QUOTE_FEES, DEFAULT_SELLER_MARKUP_PCT } from "@/lib/domain";
import type { AgencySettings } from "@/lib/types";

export default async function AgenciaPage() {
  const { agency, isAdmin } = await requireMember();
  if (!isAdmin) redirect("/config");

  const settings = (agency.settings ?? {}) as Partial<AgencySettings>;

  return (
    <>
      <PageHeader title="Agencia" subtitle="Los datos que ven tus clientes." />
      <ConfigNav />

      <div className="mx-auto mt-4 max-w-3xl px-4 md:mx-0 md:px-6">
        <AgencyForm
          agencyId={agency.id}
          initial={{
            name: agency.name,
            phone: agency.phone,
            email: agency.email,
            address: agency.address,
            logo_url: agency.logo_url,
            usd_rate: settings.usd_rate ?? null,
            quote_theme: {
              color: settings.quote_theme?.color ?? "sand",
              font: settings.quote_theme?.font ?? "editorial",
            },
            quote_fees: {
              aereo_pct: settings.quote_fees?.aereo_pct ?? DEFAULT_QUOTE_FEES.aereo_pct,
              terrestre_pct:
                settings.quote_fees?.terrestre_pct ?? DEFAULT_QUOTE_FEES.terrestre_pct,
            },
            quote_seller_commission_pct:
              settings.quote_seller_commission_pct ?? DEFAULT_SELLER_MARKUP_PCT,
          }}
        />
      </div>
    </>
  );
}
