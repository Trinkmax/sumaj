import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { ConfigNav } from "@/components/config/config-nav";
import { WhatsappSettings } from "@/components/config/whatsapp-settings";
import { RoutingRulesManager } from "@/components/config/routing-rules-manager";
import { hasCloudApi } from "@/lib/wa/cloud";

/**
 * Config → WhatsApp: el NÚMERO MADRE (Cloud API de Meta) y las reglas que
 * deciden a qué sucursal se deriva cada consulta nueva.
 * El número de cada sucursal (Baileys, con QR) se vincula en /config/sucursales.
 *
 * Admin only, como el resto de /config: acá se ven credenciales de Meta y se
 * decide a dónde cae cada consulta. Igual los componentes reciben `isAdmin`
 * para no depender solo del redirect.
 */
export default async function WhatsappPage() {
  const { agency, isAdmin } = await requireMember();
  if (!isAdmin) redirect("/config");

  const supabase = await createClient();

  const [channelRes, branchesRes, rulesRes] = await Promise.all([
    supabase
      .from("wa_channels")
      .select(
        // sin last_error: no es legible por `authenticated` (migración 0016).
        // El número madre es Cloud API y no tiene sesión que se caiga; si hace
        // falta el detalle técnico, se lee con service role desde getChannelState.
        "id, label, phone, phone_number_id, status, auto_reply_enabled, auto_reply_text, last_connected_at",
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
          cloudApiReady={hasCloudApi()}
          webhookBase={webhookBase}
          channel={
            channel
              ? {
                  id: channel.id,
                  label: channel.label,
                  phone: channel.phone,
                  phoneNumberId: channel.phone_number_id,
                  status: channel.status,
                  autoReplyEnabled: channel.auto_reply_enabled,
                  autoReplyText: channel.auto_reply_text ?? "",
                  lastConnectedAt: channel.last_connected_at,
                  lastError: null,
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
