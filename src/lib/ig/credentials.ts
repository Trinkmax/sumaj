/**
 * De dónde salen las credenciales de Instagram.
 *
 * SOLO SERVIDOR, y siempre con service role: los secretos viven cifrados en el
 * Vault de Supabase y las funciones que los descifran solo se lo permiten a ese
 * rol (migraciones 0023 a 0025). Ni el admin de la agencia los lee desde el
 * browser.
 *
 * A diferencia de WhatsApp acá NO hay fallback a variables de entorno: Instagram
 * llegó cuando las credenciales ya vivían en la base, así que nace sin la deuda
 * de la transición. Cada agencia usa lo suyo y punto.
 *
 * OJO con el cacheo: `cache()` de React memoiza por request SOLO donde hay
 * render de React (Server Components y server actions). En los Route Handlers
 * —el webhook, el cron— no hay dispatcher y cada llamada re-ejecuta todo. Ahí el
 * que llama memoiza a mano, por agencia. Nunca una sola vez para todo el lote:
 * una agencia terminaría mandando con el token de otra.
 */
import { cache } from "react";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import type { IgAuthMode, IgCreds } from "@/lib/ig/graph";

/** Lo que devuelve ig_config() en la base. */
type IgConfigRow = {
  channel_id: string;
  agency_id: string;
  auth_mode: string;
  app_id: string | null;
  ig_app_id: string | null;
  ig_user_id: string | null;
  page_id: string | null;
  username: string | null;
  webhook_slug: string;
  token: string | null;
  app_secret: string | null;
  ig_app_secret: string | null;
  verify_token: string | null;
  human_agent_enabled: boolean;
  bridge_enabled: boolean;
  bridge_phone: string | null;
  bridge_label: string;
  bridge_text: string;
  auto_wa_enabled: boolean;
  auto_wa_text: string;
  phone_country_code: string;
};

/**
 * Cómo saltar de un DM a un WhatsApp. Viaja junto a las credenciales a
 * propósito: el webhook necesita las dos cosas para atender un mensaje y así no
 * paga un segundo viaje a la base por cada DM que entra.
 */
export type IgBridge = {
  /** ofrecerle al cliente el salto a WhatsApp en la respuesta automática */
  enabled: boolean;
  /** a qué número lo mandamos (E.164 sin '+'). null = el número madre */
  phone: string | null;
  /** el texto del botón/enlace */
  label: string;
  /** lo que queda escrito en el WhatsApp del cliente antes de que mande */
  text: string;
  /** si deja su teléfono en el DM, ¿le escribimos primero nosotros? */
  autoWa: boolean;
  autoWaText: string;
  /** con qué país se completa un teléfono escrito suelto */
  countryCode: string;
};

/** Credenciales + de qué canal/agencia son + cómo es el puente. */
export type ResolvedIgCreds = IgCreds & {
  channelId: string;
  agencyId: string;
  username: string | null;
  webhookSlug: string;
  bridge: IgBridge;
};

function toCreds(row: IgConfigRow): ResolvedIgCreds | null {
  // Sin token no hay Instagram posible: mejor devolver null y que cada caller
  // muestre su propio mensaje, a devolver credenciales a medias que fallan lejos.
  if (!row.token) return null;

  return {
    token: row.token,
    authMode: (row.auth_mode === "facebook_login"
      ? "facebook_login"
      : "instagram_login") satisfies IgAuthMode,
    igUserId: row.ig_user_id,
    pageId: row.page_id,
    appId: row.app_id,
    appSecret: row.app_secret,
    igAppId: row.ig_app_id,
    igAppSecret: row.ig_app_secret,
    verifyToken: row.verify_token,
    humanAgentEnabled: row.human_agent_enabled,
    channelId: row.channel_id,
    agencyId: row.agency_id,
    username: row.username,
    webhookSlug: row.webhook_slug,
    bridge: {
      enabled: row.bridge_enabled,
      phone: row.bridge_phone,
      label: row.bridge_label,
      text: row.bridge_text,
      autoWa: row.auto_wa_enabled,
      autoWaText: row.auto_wa_text,
      countryCode: row.phone_country_code,
    },
  };
}

/** La RPC devuelve jsonb: null si no hay fila, o la config completa. */
function fromJson(data: unknown): ResolvedIgCreds | null {
  if (!data || typeof data !== "object") return null;
  return toCreds(data as IgConfigRow);
}

/** Credenciales de un canal de Instagram concreto. */
export const getIgCredsByChannel = cache(
  async (channelId: string): Promise<ResolvedIgCreds | null> => {
    if (!hasAdminClient()) return null;
    const { data } = await createAdminClient().rpc("ig_config", { p_channel_id: channelId });
    return fromJson(data);
  },
);

/** Credenciales entrando por el slug de la URL del webhook (el camino normal). */
export const getIgCredsBySlug = cache(
  async (slug: string): Promise<ResolvedIgCreds | null> => {
    if (!hasAdminClient()) return null;
    const { data } = await createAdminClient().rpc("ig_config_by_slug", { p_slug: slug });
    return fromJson(data);
  },
);

/** Credenciales de la cuenta de Instagram de una agencia. */
export const getIgCreds = cache(
  async (agencyId: string): Promise<ResolvedIgCreds | null> => {
    if (!hasAdminClient()) return null;
    const { data } = await createAdminClient()
      .from("wa_channels")
      .select("id")
      .eq("agency_id", agencyId)
      .eq("kind", "instagram")
      .maybeSingle();
    if (!data) return null;
    return getIgCredsByChannel(data.id);
  },
);

/** ¿Esta agencia puede hablar por Instagram? */
export async function hasInstagram(agencyId: string): Promise<boolean> {
  const creds = await getIgCreds(agencyId);
  return !!creds?.token && !!(creds.igUserId ?? creds.pageId);
}

/* ───────────────────────── escritura ───────────────────────── */

export type IgSecretSlot = "token" | "app_secret" | "ig_app_secret" | "verify_token";

/** Guarda (o pisa) un secreto en el Vault. Nunca toca una columna de texto. */
export async function setIgSecret(
  channelId: string,
  slot: IgSecretSlot,
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasAdminClient()) {
    return { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY para guardar credenciales." };
  }
  const { error } = await createAdminClient().rpc("ig_secret_set", {
    p_channel_id: channelId,
    p_slot: slot,
    p_value: value,
  });
  if (error) return { ok: false, error: "No se pudo guardar la credencial." };
  return { ok: true };
}

/** Borra del Vault los secretos del canal (desconectar la cuenta). */
export async function clearIgSecrets(
  channelId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasAdminClient()) {
    return { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY." };
  }
  const { error } = await createAdminClient().rpc("ig_secret_clear", { p_channel_id: channelId });
  if (error) return { ok: false, error: "No se pudieron borrar las credenciales." };
  return { ok: true };
}
