import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { ConfigNav } from "@/components/config/config-nav";
import { TagsManager, type TagWithUsage } from "@/components/config/tags-manager";

export default async function EtiquetasPage() {
  const { agency, isAdmin } = await requireMember();
  if (!isAdmin) redirect("/config");

  const supabase = await createClient();
  const { data } = await supabase
    .from("tags")
    .select("id, name, category, color, contact_tags(count)")
    .eq("agency_id", agency.id)
    .order("name", { ascending: true });

  const tags: TagWithUsage[] = (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    color: t.color,
    usage: t.contact_tags?.[0]?.count ?? 0,
  }));

  return (
    <>
      <PageHeader title="Etiquetas" subtitle="Para encontrar contactos en dos toques." />
      <ConfigNav />

      <div className="mx-auto mt-4 max-w-3xl px-4 md:mx-0 md:px-6">
        <TagsManager tags={tags} />
      </div>
    </>
  );
}
