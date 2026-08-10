import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { BroadcastComposer } from "@/components/difusiones/composer";

export const metadata = { title: "Nueva difusión" };

/** Tope de envíos por día si la agencia no configuró el suyo. */
const CUPO_DIARIO_DEFAULT = 250;

/**
 * Armar una difusión. Admin only: difundir es una decisión del negocio (cuesta
 * plata y se juega la reputación del número), no una acción de un vendedor.
 *
 * Acá se trae todo lo que la pantalla necesita para no pedirle nada más al
 * servidor mientras el usuario arma: plantillas, etiquetas, sucursales, equipo,
 * el estado del número madre y el tamaño real de la agenda. Lo único que viaja
 * mientras se toquetean los filtros es el contador de audiencia.
 */
export default async function NuevaDifusionPage() {
  const { member, agency, isAdmin } = await requireMember();
  if (!isAdmin) redirect("/difusiones");

  const supabase = await createClient();

  const [templatesRes, tagsRes, branchesRes, membersRes, motherRes, contactosRes, sinTelefonoRes, bajasRes] =
    await Promise.all([
      supabase
        .from("wa_templates")
        .select("*")
        .eq("agency_id", agency.id)
        .order("name", { ascending: true }),
      supabase
        .from("tags")
        .select("id, name, color, category")
        .eq("agency_id", agency.id)
        .order("name", { ascending: true }),
      supabase
        .from("branches")
        .select("id, name")
        .eq("agency_id", agency.id)
        .eq("is_active", true)
        .order("position", { ascending: true }),
      supabase
        .from("members")
        .select("id, display_name")
        .eq("agency_id", agency.id)
        .eq("is_active", true)
        .order("display_name", { ascending: true }),
      supabase
        .from("wa_channels")
        .select("id, phone, status")
        .eq("agency_id", agency.id)
        .eq("is_mother", true)
        .maybeSingle(),
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("agency_id", agency.id),
      // Sin teléfono no hay difusión posible: no es un filtro, es la realidad.
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("agency_id", agency.id)
        .is("phone", null),
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("agency_id", agency.id)
        .not("wa_opt_out_at", "is", null),
    ]);

  const settings = agency.settings as Record<string, unknown> | null;
  const cupoDiario =
    typeof settings?.broadcast_daily_cap === "number" && settings.broadcast_daily_cap > 0
      ? settings.broadcast_daily_cap
      : CUPO_DIARIO_DEFAULT;

  return (
    <>
      <PageHeader
        title="Nueva difusión"
        subtitle="Un mensaje a mucha gente que vuelve en consultas."
      />
      <BroadcastComposer
        templates={templatesRes.data ?? []}
        tags={tagsRes.data ?? []}
        branches={branchesRes.data ?? []}
        members={membersRes.data ?? []}
        mother={{
          connected: motherRes.data?.status === "conectado",
          phone: motherRes.data?.phone ?? null,
        }}
        agencyName={agency.name}
        sellerName={member.display_name}
        dailyCap={cupoDiario}
        stats={{
          total: contactosRes.count ?? 0,
          sinTelefono: sinTelefonoRes.count ?? 0,
          bajas: bajasRes.count ?? 0,
        }}
      />
    </>
  );
}
