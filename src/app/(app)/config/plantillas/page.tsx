import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { hasCloudApi } from "@/lib/wa/cloud-credentials";
import { PageHeader } from "@/components/shell/page-header";
import { ConfigNav } from "@/components/config/config-nav";
import { TemplatesManager } from "@/components/config/templates-manager";

export default async function PlantillasPage() {
  const { agency, isAdmin } = await requireMember();
  if (!isAdmin) redirect("/config");

  const supabase = await createClient();
  const [templatesRes, cloudReady] = await Promise.all([
    supabase
      .from("wa_templates")
      .select("*")
      .eq("agency_id", agency.id)
      .order("created_at", { ascending: true }),
    hasCloudApi(agency.id),
  ]);

  return (
    <>
      <PageHeader title="Plantillas" subtitle="Mensajes de WhatsApp listos para salir." />
      <ConfigNav />

      <div className="mx-auto mt-4 max-w-4xl px-4 md:mx-0 md:px-6">
        <TemplatesManager templates={templatesRes.data ?? []} cloudReady={cloudReady} />
      </div>
    </>
  );
}
