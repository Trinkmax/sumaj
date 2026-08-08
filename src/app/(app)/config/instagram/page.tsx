import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { ConfigNav } from "@/components/config/config-nav";
import { InstagramSettings } from "@/components/config/instagram-settings";
import { getInstagramStatus } from "@/lib/actions/instagram";

/**
 * Config → Instagram: los mensajes directos de la cuenta de la agencia.
 *
 * Admin only, como el resto de /config: acá se cargan las credenciales de Meta y
 * se decide qué pasa con cada consulta que entra por un DM.
 *
 * El estado de la conexión NO se lee de la tabla: `ig_accounts` es solo para el
 * service role. Lo resuelve `getInstagramStatus()`, que nunca devuelve secretos
 * —solo banderas, el diagnóstico y los últimos 4 del token.
 *
 * Las sucursales se traen para el selector del puente: el link de WhatsApp que
 * recibe el cliente sale, por defecto, del número de la sucursal que lo atiende.
 */
export default async function InstagramPage() {
  const { agency, isAdmin } = await requireMember();
  if (!isAdmin) redirect("/config");

  const supabase = await createClient();

  const [channelRes, branchesRes, motherRes, statusRes] = await Promise.all([
    supabase
      .from("wa_channels")
      .select("id, label, auto_reply_enabled, auto_reply_text")
      .eq("agency_id", agency.id)
      .eq("kind", "instagram")
      .maybeSingle(),
    supabase
      .from("branches")
      .select("id, name, is_default, channels:wa_channels(id, kind, status, phone)")
      .eq("agency_id", agency.id)
      .eq("is_active", true)
      .order("position", { ascending: true }),
    supabase
      .from("wa_channels")
      .select("phone")
      .eq("agency_id", agency.id)
      .eq("is_mother", true)
      .maybeSingle(),
    getInstagramStatus(),
  ]);

  const channel = channelRes.data;

  /* De dónde puede salir el link de WhatsApp que recibe el cliente. Se resuelve
     en el server porque hace falta cruzar sucursales con sus canales, y la
     pantalla solo tiene que pintar la lista. */
  const waNumbers = [
    ...(branchesRes.data ?? []).flatMap((b) => {
      const channel = (b.channels ?? []).find(
        (c) => c.kind === "baileys" && c.status === "conectado" && c.phone,
      );
      return channel?.phone
        ? [{ phone: channel.phone, label: b.name, isDefault: b.is_default }]
        : [];
    }),
    ...(motherRes.data?.phone
      ? [{ phone: motherRes.data.phone, label: "Número madre", isDefault: false }]
      : []),
  ];

  // si falta la env, el cliente completa con el origin del navegador
  const webhookBase = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "") || null;

  return (
    <>
      <PageHeader
        title="Instagram"
        subtitle="Los mensajes de tu Instagram, adentro del CRM — y con salida a WhatsApp."
      />
      <ConfigNav />

      <div className="mx-auto mt-4 max-w-3xl space-y-4 px-4 md:mx-0 md:px-6">
        <InstagramSettings
          isAdmin={isAdmin}
          webhookBase={webhookBase}
          status={statusRes.ok ? statusRes.data : null}
          statusError={statusRes.ok ? null : statusRes.error}
          waNumbers={waNumbers}
          channel={
            channel
              ? {
                  id: channel.id,
                  label: channel.label,
                  autoReplyEnabled: channel.auto_reply_enabled,
                  autoReplyText: channel.auto_reply_text ?? "",
                }
              : null
          }
        />
      </div>
    </>
  );
}
