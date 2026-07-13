import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import {
  QuoteBuilder,
  type BuilderContact,
  type BuilderInitialQuote,
  type BuilderSupplier,
} from "@/components/quotes/quote-builder";
import type { AgencySettings, QuoteTheme } from "@/lib/types";

export const metadata = { title: "Editar presupuesto" };

export default async function EditarPresupuestoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { member, agency } = await requireMember();
  const supabase = await createClient();

  const [quoteRes, suppliersRes, contactsRes] = await Promise.all([
    supabase
      .from("quotes")
      .select("*, items:quote_items(*)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("suppliers")
      .select("id, name, default_commission_pct")
      .eq("is_active", true)
      .order("name"),
    // solo los últimos 30 — el resto se busca server-side desde el picker (igual que /nuevo)
    supabase
      .from("contacts")
      .select("id, full_name, phone")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const quote = quoteRes.data;
  if (!quote) notFound();

  const suppliers: BuilderSupplier[] = (suppliersRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    default_commission_pct: Number(s.default_commission_pct),
  }));

  const contacts: BuilderContact[] = [...(contactsRes.data ?? [])];
  // el contacto del presupuesto siempre tiene que estar disponible en el picker
  if (quote.contact_id && !contacts.some((c) => c.id === quote.contact_id)) {
    const { data: extra } = await supabase
      .from("contacts")
      .select("id, full_name, phone")
      .eq("id", quote.contact_id)
      .maybeSingle();
    if (extra) contacts.unshift(extra);
  }

  const settings = agency.settings as unknown as Partial<AgencySettings>;

  const initial: BuilderInitialQuote = {
    id: quote.id,
    code: quote.code,
    public_token: quote.public_token,
    status: quote.status,
    lead_id: quote.lead_id,
    contact_id: quote.contact_id,
    destination: quote.destination,
    title: quote.title,
    trip_date_from: quote.trip_date_from,
    trip_date_to: quote.trip_date_to,
    pax: quote.pax,
    currency: quote.currency,
    valid_until: quote.valid_until,
    markup_type: quote.markup_type,
    markup_value: Number(quote.markup_value),
    discount: Number(quote.discount),
    notes: quote.notes,
    internal_notes: quote.internal_notes,
    theme: (quote.theme ?? {}) as QuoteTheme,
    items: quote.items.map((i) => ({
      type: i.type,
      description: i.description,
      supplier_id: i.supplier_id,
      cost: Number(i.cost),
      gross: i.gross != null ? Number(i.gross) : null,
      commission_pct: Number(i.commission_pct),
      position: i.position,
    })),
  };

  return (
    <>
      <PageHeader
        title={`Editar ${quote.code}`}
        subtitle={quote.title || quote.destination}
      />
      <QuoteBuilder
        initial={initial}
        lead={null}
        contacts={contacts}
        suppliers={suppliers}
        savedNotes={settings.quote_saved_notes ?? []}
        defaultTheme={settings.quote_theme ?? { color: "sand", font: "editorial" }}
        agency={{ name: agency.name, logoUrl: agency.logo_url, phone: agency.phone }}
        sellerName={member.display_name}
      />
    </>
  );
}
