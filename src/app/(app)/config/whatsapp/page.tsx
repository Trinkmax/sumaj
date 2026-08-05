import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { ConfigNav } from "@/components/config/config-nav";
import { WhatsappSettings } from "@/components/config/whatsapp-settings";
import { RoutingRulesManager } from "@/components/config/routing-rules-manager";
import { getCloudStatus } from "@/lib/actions/wa-cloud";

/**
 * Config → WhatsApp: el NÚMERO MADRE (Cloud API de Meta) y las reglas que
 * deciden a qué sucursal se deriva cada consulta nueva.
 * El número de cada sucursal (Baileys, con QR) se vincula en /config/sucursales.
 *
 * Admin only, como el resto de /config: acá se cargan las credenciales de Meta y
 * se decide a dónde cae cada consulta. Igual los componentes reciben `isAdmin`
 * para no depender solo del redirect.
 *
 * El estado de la conexión con Meta NO se lee de la tabla: `wa_cloud_credentials`
 * es solo para el service role. Lo resuelve `getCloudStatus()`, que además nunca
 * devuelve secretos —solo banderas, el diagnóstico y los últimos 4 del token.
 */
export default async function WhatsappPage() {
  const { agency, isAdmin } = await requireMember();
  if (!isAdmin) redirect("/config");

  const supabase = await createClient();

  const [channelRes, branchesRes, rulesRes, statusRes] = await Promise.all([
    supabase
      .from("wa_channels")
      .select(
        // sin last_error: no es legible por `authenticated` (migración 0016).
        // El detalle de la conexión con Meta viene por getCloudStatus.
        "id, phone, auto_reply_enabled, auto_reply_text",
      )
      .eq("agency_id", agency.id)
      .eq("is_mother", true)
      .maybeSingle(),
    supabase
      .from("branches")
      .select("id, name, color, is_default, is_active")
      .eq("agency_id", agency.id)
      .order("position", { ascending: true }),
    supabase
      .from("routing_rules")
      .select("id, branch_id, match_type, pattern, is_active, position")
      .eq("agency_id", agency.id)
      .order("position", { ascending: true }),
    getCloudStatus(),
  ]);

  const channel = channelRes.data;
  const branches = branchesRes.data ?? [];
  const rules = rulesRes.data ?? [];
  // el fallback del ruteo pide is_default AND is_active (ver routeToBranch en lib/wa/inbound)
  const defaultBranch = branches.find((b) => b.is_default && b.is_active) ?? null;
  const branchById = new Map(branches.map((b) => [b.id, b]));

  // si falta la env, el cliente completa con el origin del navegador (nunca un dominio inventado)
  const webhookBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "") || null;

  return (
    <>
      <PageHeader
        title="WhatsApp"
        subtitle="El número madre: la puerta por donde entran todas las consultas."
      />
      <ConfigNav />

      <div className="mx-auto mt-4 max-w-3xl space-y-4 px-4 md:mx-0 md:px-6">
        <WhatsappSettings
          isAdmin={isAdmin}
          webhookBase={webhookBase}
          status={statusRes.ok ? statusRes.data : null}
          statusError={statusRes.ok ? null : statusRes.error}
          channel={
            channel
              ? {
                  id: channel.id,
                  phone: channel.phone,
                  autoReplyEnabled: channel.auto_reply_enabled,
                  autoReplyText: channel.auto_reply_text ?? "",
                }
              : null
          }
        />

        <RoutingRulesManager
          isAdmin={isAdmin}
          branches={branches}
          defaultBranchName={defaultBranch?.name ?? null}
          rules={rules.map((r) => {
            const branch = branchById.get(r.branch_id);
            return {
              id: r.id,
              branchId: r.branch_id,
              branchName: branch?.name ?? "Sucursal eliminada",
              branchColor: branch?.color ?? "gray",
              matchType: r.match_type === "campana" ? ("campana" as const) : ("palabra" as const),
              pattern: r.pattern,
              isActive: r.is_active,
              position: r.position,
            };
          })}
        />
      </div>
    </>
  );
}
