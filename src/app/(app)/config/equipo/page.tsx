import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { ConfigNav } from "@/components/config/config-nav";
import { TeamSection } from "@/components/config/team-section";

export default async function EquipoPage() {
  const { member, agency, isAdmin } = await requireMember();
  if (!isAdmin) redirect("/config");

  const supabase = await createClient();
  const [{ data: members }, { data: invitations }] = await Promise.all([
    supabase
      .from("members")
      .select("*")
      .eq("agency_id", agency.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("invitations")
      .select("*")
      .eq("agency_id", agency.id)
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <>
      <PageHeader title="Equipo" subtitle="Quiénes venden y cuánto comisionan." />
      <ConfigNav />

      <div className="mx-auto mt-4 max-w-3xl px-4 md:mx-0 md:px-6">
        <TeamSection
          members={members ?? []}
          invitations={invitations ?? []}
          currentMemberId={member.id}
          agencyName={agency.name}
        />
      </div>
    </>
  );
}
