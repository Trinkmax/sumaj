import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { BroadcastComposer, type BroadcastDraft } from "@/components/difusiones/composer";
import { EMPTY_AUDIENCE } from "@/lib/broadcasts/audience";
import type { BroadcastAudience } from "@/lib/types";

export const metadata = { title: "Nueva difusión" };

/** Tope de envíos por día si la agencia no configuró el suyo. */
const CUPO_DIARIO_DEFAULT = 250;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HORAS_24 = 24 * 3_600_000;

/**
 * Armar una difusión. Admin only: difundir es una decisión del negocio (cuesta
 * plata y se juega la reputación del número), no una acción de un vendedor.
 *
 * Acá se trae todo lo que la pantalla necesita para no pedirle nada más al
 * servidor mientras el usuario arma: plantillas, etiquetas, sucursales, equipo,
 * el estado del número madre y el tamaño real de la agenda. Lo único que viaja
 * mientras se toquetean los filtros es el contador de audiencia.
 *
 * Con `?id=` retoma un borrador: es a donde lleva "Seguir armando". Sin
 * hidratar, ese botón abría un formulario en blanco y al disparar creaba una
 * SEGUNDA difusión, dejando el borrador original huérfano para siempre.
 */
export default async function NuevaDifusionPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { member, agency, isAdmin } = await requireMember();
  if (!isAdmin) redirect("/difusiones");

  const { id } = await searchParams;
  const draftId = id && UUID_RE.test(id) ? id : null;

  const supabase = await createClient();

  const [
    templatesRes,
    tagsRes,
    branchesRes,
    membersRes,
    motherRes,
    contactosRes,
    sinTelefonoRes,
    bajasRes,
    enviadosHoy,
    borradorRes,
  ] = await Promise.all([
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
    /* Lo que YA salió en las últimas 24 hs: es el mismo criterio con el que el
       despachador descuenta el tope. Sin esto la pantalla prometía el cupo
       entero a las 17 aunque a las 9 se hubieran ido 200 mensajes, y el dueño
       veía el progreso clavado sin entender por qué. */
    contarEnviadosHoy(supabase, agency.id),
    draftId
      ? supabase
          .from("broadcasts")
          .select("id, name, status, template_id, audience, branch_id, scheduled_at, throttle_per_run")
          .eq("id", draftId)
          .eq("agency_id", agency.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const settings = agency.settings as Record<string, unknown> | null;
  const cupoDiario =
    typeof settings?.broadcast_daily_cap === "number" && settings.broadcast_daily_cap > 0
      ? settings.broadcast_daily_cap
      : CUPO_DIARIO_DEFAULT;
  const cupoRestante = Math.max(0, cupoDiario - enviadosHoy);

  /* Solo un borrador se puede retomar: una que ya salió se mira, no se edita. */
  const raw = borradorRes.data;
  const draft: BroadcastDraft | null =
    raw && raw.status === "borrador" && raw.template_id
      ? {
          id: raw.id,
          name: raw.name,
          templateId: raw.template_id,
          audience: { ...EMPTY_AUDIENCE, ...((raw.audience ?? {}) as BroadcastAudience) },
          branchId: raw.branch_id,
          scheduledAt: raw.scheduled_at,
          throttlePerRun: raw.throttle_per_run,
        }
      : null;

  return (
    <>
      <div className="px-4 pt-4 md:px-6 md:pt-6">
        <Link
          href="/difusiones"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-faint transition-colors hover:text-ink tap-highlight-none"
        >
          <ArrowLeft className="size-4" /> Difusiones
        </Link>
      </div>

      <PageHeader
        title={draft ? "Seguir armando" : "Nueva difusión"}
        subtitle="Un mensaje a mucha gente que vuelve en consultas."
        className="pt-1"
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
        dailyLeft={cupoRestante}
        draft={draft}
        stats={{
          total: contactosRes.count ?? 0,
          sinTelefono: sinTelefonoRes.count ?? 0,
          bajas: bajasRes.count ?? 0,
        }}
      />
    </>
  );
}

/**
 * Cuántos mensajes de difusión salieron en las últimas 24 hs.
 *
 * Es el mismo criterio con el que el despachador descuenta el tope diario de
 * Meta: si acá se contara otra cosa, la pantalla prometería un cupo que el cron
 * no va a respetar.
 */
async function contarEnviadosHoy(
  supabase: Awaited<ReturnType<typeof createClient>>,
  agencyId: string,
): Promise<number> {
  const desde = new Date(Date.now() - HORAS_24).toISOString();
  const { count } = await supabase
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("agency_id", agencyId)
    .gte("sent_at", desde);
  return count ?? 0;
}
