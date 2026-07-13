import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { ConfigNav } from "@/components/config/config-nav";
import { FollowupRules } from "@/components/config/followup-rules";

export default async function SeguimientoPage() {
  const { agency, isAdmin } = await requireMember();
  if (!isAdmin) redirect("/config");

  const supabase = await createClient();
  const { data: rules } = await supabase
    .from("followup_rules")
    .select("*")
    .eq("agency_id", agency.id)
    .order("touch_number", { ascending: true });

  return (
    <>
      <PageHeader
        title="Seguimiento automático"
        subtitle="Para que ningún lead se enfríe sin que nadie lo note."
      />
      <ConfigNav />

      <div className="mx-auto mt-4 max-w-3xl px-4 md:mx-0 md:px-6">
        <FollowupRules rules={rules ?? []} />
      </div>
    </>
  );
}
