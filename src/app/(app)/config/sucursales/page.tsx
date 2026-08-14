import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { ConfigNav } from "@/components/config/config-nav";
import { BranchesManager, type BranchItem } from "@/components/config/branches-manager";
import { workerState } from "@/lib/wa/worker";

export default async function SucursalesPage() {
  const { agency, isAdmin } = await requireMember();
  const supabase = await createClient();

  /* En paralelo con las consultas: `workerState` le pregunta al worker si está
     vivo (antes solo se miraba que existieran las variables de entorno, así que
     una URL apuntando a un proceso que nunca se desplegó daba "listo" y el
     operador se enteraba recién al tocar Vincular). Tiene corte a 3 s: si tarda
     más, a los fines de esta pantalla está caído. */
  const [{ data: branches }, { data: members }, worker] = await Promise.all([
    supabase
      .from("branches")
      // sin `*`: qr / qr_expires_at / last_error no son legibles por `authenticated`
      // (migración 0016). El QR lo trae getChannelState con service role, solo admin.
      .select(
        "id, name, address, phone, color, is_default, is_active, position, wa_channels(id, kind, label, phone, status, last_connected_at)",
      )
      .eq("agency_id", agency.id)
      .order("position", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("members")
      .select("id, display_name, avatar_url, role, branch_id")
      .eq("agency_id", agency.id)
      .eq("is_active", true)
      .order("display_name", { ascending: true }),
    workerState(),
  ]);

  const items: BranchItem[] = (branches ?? []).map((b) => {
    // cada sucursal tiene un solo canal, y es de Baileys (el madre no cuelga de acá)
    const channel = b.wa_channels.find((c) => c.kind === "baileys") ?? null;
    return {
      id: b.id,
      name: b.name,
      address: b.address,
      phone: b.phone,
      color: b.color,
      is_default: b.is_default,
      is_active: b.is_active,
      channel: channel
        ? {
            id: channel.id,
            label: channel.label,
            phone: channel.phone,
            status: channel.status,
            // El QR vincula el número: quien lo escanea se queda con el WhatsApp de
            // la sucursal. Ni siquiera se lee acá: llega por getChannelState, que
            // exige admin y lo trae con service role.
            qr: null,
            qrExpiresAt: null,
            lastError: null,
            lastConnectedAt: channel.last_connected_at,
          }
        : null,
    };
  });

  return (
    <>
      <PageHeader
        title="Sucursales"
        subtitle="Cada local con su equipo y su número de WhatsApp."
      />
      <ConfigNav />

      <div className="mx-auto mt-4 max-w-3xl px-4 md:mx-0 md:px-6">
        <BranchesManager
          branches={items}
          members={members ?? []}
          isAdmin={isAdmin}
          worker={worker}
        />
      </div>
    </>
  );
}
