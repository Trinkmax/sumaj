import Link from "next/link";
import { Plus } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { QuotesList, type QuoteListItem } from "@/components/quotes/quotes-list";

export const metadata = { title: "Presupuestos" };

export default async function PresupuestosPage() {
  await requireMember();
  const supabase = await createClient();

  const { data } = await supabase
    .from("quotes")
    .select(
      "id, code, title, destination, status, currency, total_price, valid_until, created_at, contact:contacts(full_name)",
    )
    .order("created_at", { ascending: false });

  const quotes: QuoteListItem[] = (data ?? []).map((q) => ({
    id: q.id,
    code: q.code,
    title: q.title,
    destination: q.destination,
    status: q.status,
    currency: q.currency,
    total_price: Number(q.total_price),
    valid_until: q.valid_until,
    created_at: q.created_at,
    contact: q.contact ? { full_name: q.contact.full_name } : null,
  }));

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
