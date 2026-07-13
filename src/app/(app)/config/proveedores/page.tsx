import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { ConfigNav } from "@/components/config/config-nav";
import { SuppliersManager } from "@/components/config/suppliers-manager";

export default async function ProveedoresPage() {
  const { agency, isAdmin } = await requireMember();
  if (!isAdmin) redirect("/config");

  const supabase = await createClient();
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("*")
    .eq("agency_id", agency.id)
    .order("name", { ascending: true });

  return (
    <>
      <PageHeader title="Proveedores" subtitle="Tus mayoristas y operadores." />
      <ConfigNav />

      <div className="mx-auto mt-4 max-w-3xl px-4 md:mx-0 md:px-6">
        <SuppliersManager suppliers={suppliers ?? []} />
      </div>
    </>
  );
}
