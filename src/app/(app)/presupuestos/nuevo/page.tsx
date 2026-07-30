import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import {
  QuoteBuilder,
  type BuilderContact,
  type BuilderLead,
  type BuilderSupplier,
} from "@/components/quotes/quote-builder";
import { DEFAULT_QUOTE_FEES, DEFAULT_SELLER_MARKUP_PCT } from "@/lib/domain";
import type { AgencySettings } from "@/lib/types";

export const metadata = { title: "Nuevo presupuesto" };

export default async function NuevoPresupuestoPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string }>;
}) {
  const { lead: leadId } = await searchParams;
  const { member, agency, isAdmin } = await requireMember();
  const supabase = await createClient();

  const [suppliersRes, contactsRes, leadRes] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id, name, default_commission_pct")
      .eq("is_active", true)
      .order("name"),
    // solo los últimos 30 — el resto se busca server-side desde el picker
    supabase
      .from("contacts")
      .select("id, full_name, phone")
      .order("created_at", { ascending: false })
      .limit(30),
    leadId
      ? supabase
          .from("leads")
          .select(
            "id, destination, trip_date_from, trip_date_to, pax_adults, pax_children, contact:contacts(id, full_name, phone)",
          )
          .eq("id", leadId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const suppliers: BuilderSupplier[] = (suppliersRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    default_commission_pct: Number(s.default_commission_pct),
  }));
  const contacts: BuilderContact[] = contactsRes.data ?? [];

  const leadRow = leadRes.data;
  const lead: BuilderLead | null =
    leadRow && leadRow.contact
      ? {
          id: leadRow.id,
          destination: leadRow.destination,
          trip_date_from: leadRow.trip_date_from,
          trip_date_to: leadRow.trip_date_to,
          pax_adults: leadRow.pax_adults,
          pax_children: leadRow.pax_children,
          contact: leadRow.contact,
        }
      : null;

  const settings = agency.settings as unknown as Partial<AgencySettings>;

  return (
    <>
      <PageHeader
        title="Nuevo presupuesto"
        subtitle={
          lead
            ? `Para ${lead.contact.full_name}${lead.destination ? ` · ${lead.destination}` : ""}`
            : "Cargá la cotización y compartila en un toque."
        }
      />
      <QuoteBuilder
        initial={null}
        lead={lead}
        contacts={contacts}
        suppliers={suppliers}
        savedNotes={settings.quote_saved_notes ?? []}
        defaultTheme={settings.quote_theme ?? { color: "sand", font: "editorial" }}
        agency={{
          name: agency.name,
          logoUrl: agency.logo_url,
          phone: agency.phone,
          email: agency.email,
        }}
        sellerName={member.display_name}
        isAdmin={isAdmin}
        fees={settings.quote_fees ?? DEFAULT_QUOTE_FEES}
        sellerCommissionPct={
          settings.quote_seller_commission_pct ?? DEFAULT_SELLER_MARKUP_PCT
        }
      />
    </>
  );
}
