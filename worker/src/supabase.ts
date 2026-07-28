import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

/**
 * Cliente con service role: el worker no tiene sesión de usuario.
 * Toca solo `wa_channels` (estado/QR) y `wa_session_state` (credenciales),
 * que tienen RLS activo sin policies justamente para que nadie más entre.
 */
export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export type ChannelRow = {
  id: string;
  agency_id: string;
  branch_id: string | null;
  kind: "cloud_api" | "baileys";
  is_mother: boolean;
  label: string;
  phone: string | null;
  status: "desconectado" | "vinculando" | "conectado" | "error";
};

/** Canales de Baileys que el worker tiene que levantar al arrancar. */
export async function listBaileysChannels(): Promise<ChannelRow[]> {
  const { data, error } = await supabase
    .from("wa_channels")
    .select("id, agency_id, branch_id, kind, is_mother, label, phone, status")
    .eq("kind", "baileys");
  if (error) {
    console.error("[supabase] no se pudieron listar los canales:", error.message);
    return [];
  }
  return (data ?? []) as ChannelRow[];
}

export async function getChannel(channelId: string): Promise<ChannelRow | null> {
  const { data } = await supabase
    .from("wa_channels")
    .select("id, agency_id, branch_id, kind, is_mother, label, phone, status")
    .eq("id", channelId)
    .maybeSingle();
  return (data as ChannelRow | null) ?? null;
}

/** Estado visible en la UI: la app lo lee de la tabla (y por realtime). */
export async function patchChannel(
  channelId: string,
  patch: Partial<{
    status: ChannelRow["status"];
    qr: string | null;
    qr_expires_at: string | null;
    phone: string | null;
    last_connected_at: string | null;
    last_error: string | null;
  }>,
): Promise<void> {
  const { error } = await supabase
    .from("wa_channels")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", channelId);
  if (error) console.error(`[supabase] patchChannel(${channelId}):`, error.message);
}
