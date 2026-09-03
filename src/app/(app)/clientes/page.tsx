import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { ClientesList } from "@/components/clientes/clientes-list";
import { NewContactButton } from "@/components/clientes/new-contact-dialog";
import { DocsBanner } from "@/components/clientes/docs-banner";
import type { ContactRow, ExpiringDoc } from "@/components/clientes/types";

export const metadata = { title: "Clientes" };

export default async function ClientesPage() {
  await requireMember();
  const supabase = await createClient();

  const limit = new Date();
  limit.setDate(limit.getDate() + 90);
  const limitDate = limit.toISOString().slice(0, 10);

  const [contactsRes, tagsRes, expiringRes] = await Promise.all([
    supabase
      .from("contacts")
      .select("*, contact_tags(tag:tags(*)), activities(created_at)")
      .order("created_at", { ascending: false })
      .order("created_at", { referencedTable: "activities", ascending: false })
      .limit(1, { referencedTable: "activities" }),
    supabase.from("tags").select("*").order("name"),
    supabase
      .from("travelers")
      .select(
        "id, full_name, document_expiry, document_type, contact_id, linked_contact_id, contact:contacts!travelers_contact_id_fkey(full_name)",
      )
      .not("document_expiry", "is", null)
      .lte("document_expiry", limitDate)
      .order("document_expiry", { ascending: true }),
  ]);

  const contacts: ContactRow[] = (contactsRes.data ?? []).map((c) => {
    const { contact_tags, activities, ...rest } = c;
    return {
      ...rest,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tag)
        .filter((t): t is NonNullable<typeof t> => t != null),
      last_activity_at: activities?.[0]?.created_at ?? rest.created_at,
    };
  });

  const expiringDocs: ExpiringDoc[] = (expiringRes.data ?? []).map((t) => ({
    travelerId: t.id,
    travelerName: t.full_name,
    // si el pasajero tiene ficha propia linkeamos ahí; sino, a la del titular
    contactId: t.linked_contact_id ?? t.contact_id,
    contactName: t.contact?.full_name ?? "—",
    documentType: t.document_type,
    expiry: t.document_expiry as string,
  }));

  const clientCount = contacts.filter((c) => c.is_client).length;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader
        title="Clientes"
        subtitle={`${contacts.length} contactos · ${clientCount} clientes`}
        actions={<NewContactButton />}
      />

      <div className="space-y-4 px-4 md:px-6">
        {expiringDocs.length > 0 && <DocsBanner docs={expiringDocs} />}
        <ClientesList contacts={contacts} allTags={tagsRes.data ?? []} />
      </div>
    </div>
  );
}
