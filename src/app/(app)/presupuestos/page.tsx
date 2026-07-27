import Link from "next/link";
import { Plus } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { QuotesList, type QuoteListItem } from "@/components/quotes/quotes-list";
import { paxCount, paxUnits, round2 } from "@/lib/domain";

export const metadata = { title: "Presupuestos" };

export default async function PresupuestosPage() {
  await requireMember();
  const supabase = await createClient();

  const { data } = await supabase
    .from("quotes")
    .select(
      "id, code, title, destination, status, currency, total_price, valid_until, created_at, pax, pax_adults, pax_children, pax_infants, contact:contacts(full_name), options:quote_options!quote_options_quote_id_fkey(id)",
    )
    .order("created_at", { ascending: false });

  const quotes: QuoteListItem[] = (data ?? []).map((q) => {
    const pax = {
      adults: q.pax_adults || Math.max(1, q.pax),
      children: q.pax_children ?? 0,
      infants: q.pax_infants ?? 0,
      childrenAges: [],
    };
    return {
      id: q.id,
      code: q.code,
      title: q.title,
      destination: q.destination,
      status: q.status,
      currency: q.currency,
      total_price: Number(q.total_price),
      per_person: round2(Number(q.total_price) / paxUnits(pax)),
      pax_count: paxCount(pax),
      options_count: q.options?.length ?? 0,
      valid_until: q.valid_until,
      created_at: q.created_at,
      contact: q.contact ? { full_name: q.contact.full_name } : null,
    };
  });

  const enviados = quotes.filter((q) => q.status === "enviado").length;

  return (
    <>
      <PageHeader
        title="Presupuestos"
        subtitle={
          quotes.length > 0
            ? `${quotes.length} en total · ${enviados} esperando respuesta`
            : "Cotizá como siempre, compartí algo lindo."
        }
        actions={
          <Link href="/presupuestos/nuevo">
            <Button variant="brand">
              <Plus /> Nuevo presupuesto
            </Button>
          </Link>
        }
      />
      <QuotesList quotes={quotes} />
    </>
  );
}
