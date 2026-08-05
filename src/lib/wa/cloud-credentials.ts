/**
 * De dónde salen las credenciales de Meta.
 *
 * SOLO SERVIDOR, y siempre con service role: los secretos viven cifrados en el
 * Vault de Supabase y las funciones que los descifran solo se lo permiten a ese
 * rol (migración 0018). Ni el admin de la agencia los lee desde el browser.
 *
 * Orden de resolución:
 *   1. Lo que cargó la agencia en Configuración → WhatsApp (la fuente de verdad).
 *   2. Solo para UNA agencia designada a mano con WA_CLOUD_LEGACY_AGENCY_ID, las
 *      envs del servidor (WA_CLOUD_TOKEN / WA_CLOUD_APP_SECRET /
 *      WA_CLOUD_VERIFY_TOKEN).
 *
 * El paso 2 es la red para la transición: el deploy que ya venía andando con las
 * envs sigue andando mientras su admin no entra a cargar nada. Va atado a una
 * agencia explícita y NO se aplica a las demás, por dos razones que se
 * descubrieron revisando esto:
 *   · el App Secret es la llave con la que se valida la firma del webhook. Si
 *     todas las agencias sin credenciales propias comparten el de la env, la
 *     firma deja de probar DE QUIÉN es el mensaje y pasa a probar solo que quien
 *     lo mandó conoce ese secreto: el admin de la agencia dueña de esa app podría
 *     inyectarle contactos, leads y mensajes a cualquier otra.
 *   · el verify token y el token de acceso son igual de globales: una agencia
 *     nueva quedaría mandando mensajes con el número de otra sin enterarse.
 *
 * Sin esa env no hay fallback y cada agencia usa lo suyo, que es el destino.
 *
 * OJO con el cacheo: `cache()` de React memoiza por request SOLO donde hay
 * render de React (Server Components y server actions). En los Route Handlers
 * —el webhook y el cron de seguimientos— no hay dispatcher y cada llamada
 * re-ejecuta todo. Ahí el que llama memoiza a mano, por agencia (nunca una sola
 * vez para todo el lote: una agencia mandaría con el token de otra).
 */
import { cache } from "react";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import type { CloudCreds } from "@/lib/wa/cloud";

/** Lo que devuelve wa_cloud_config() en la base. */
type CloudConfigRow = {
  channel_id: string;
  agency_id: string;
  app_id: string | null;
  waba_id: string | null;
  business_id: string | null;
  webhook_slug: string;
  phone_number_id: string | null;
  token: string | null;
  app_secret: string | null;
  verify_token: string | null;
};

/** Credenciales + de qué canal/agencia son. */
export type ResolvedCloudCreds = CloudCreds & {
  channelId: string;
  agencyId: string;
  webhookSlug: string;
  /**
   * El App Secret salió del Vault de ESTA agencia (no de la env global). El
   * webhook viejo —el que resuelve el tenant por un dato del propio payload—
   * solo acepta pedidos cuando esto es true: con un secreto compartido, la firma
   * no prueba de qué agencia viene el mensaje.
   */
  appSecretIsOwn: boolean;
  /** El token de acceso es propio y no el heredado de las envs. */
  tokenIsOwn: boolean;
};

const envToken = () => process.env.WA_CLOUD_TOKEN?.trim() || null;
const envAppSecret = () => process.env.WA_CLOUD_APP_SECRET?.trim() || null;
const envVerifyToken = () => process.env.WA_CLOUD_VERIFY_TOKEN?.trim() || null;
const legacyAgencyId = () => process.env.WA_CLOUD_LEGACY_AGENCY_ID?.trim() || null;

/** ¿Esta agencia es la que heredó la configuración vieja del servidor? */
function usesLegacyEnv(agencyId: string): boolean {
  const legacy = legacyAgencyId();
  return !!legacy && legacy === agencyId;
}

function toCreds(row: CloudConfigRow): ResolvedCloudCreds | null {
  const legacy = usesLegacyEnv(row.agency_id);

  // Sin token no hay Cloud API posible: mejor devolver null y que cada caller
  // muestre su propio mensaje, a devolver credenciales a medias que fallan lejos.
  const token = row.token ?? (legacy ? envToken() : null);
  if (!token) return null;

  return {
    token,
    phoneNumberId: row.phone_number_id,
    appId: row.app_id,
    appSecret: row.app_secret ?? (legacy ? envAppSecret() : null),
    verifyToken: row.verify_token ?? (legacy ? envVerifyToken() : null),
    wabaId: row.waba_id,
    businessId: row.business_id,
    channelId: row.channel_id,
    agencyId: row.agency_id,
    webhookSlug: row.webhook_slug,
    appSecretIsOwn: !!row.app_secret,
    tokenIsOwn: !!row.token,
  };
}

/** La RPC devuelve jsonb: null si no hay fila, o la config completa. */
function fromJson(data: unknown): ResolvedCloudCreds | null {
  if (!data || typeof data !== "object") return null;
  return toCreds(data as CloudConfigRow);
}

/** Credenciales del número madre de un canal concreto. */
export const getCloudCredsByChannel = cache(
  async (channelId: string): Promise<ResolvedCloudCreds | null> => {
    if (!hasAdminClient()) return null;
    const { data } = await createAdminClient().rpc("wa_cloud_config", {
      p_channel_id: channelId,
    });
    return fromJson(data);
  },
);

/** Credenciales entrando por el phone number ID (webhook viejo, sin slug). */
export const getCloudCredsByPhoneNumberId = cache(
  async (phoneNumberId: string): Promise<ResolvedCloudCreds | null> => {
    if (!hasAdminClient()) return null;
    const { data } = await createAdminClient().rpc("wa_cloud_config_by_phone_number_id", {
      p_phone_number_id: phoneNumberId,
    });
    return fromJson(data);
  },
);

/** Credenciales entrando por el slug de la URL del webhook (el camino nuevo). */
export const getCloudCredsBySlug = cache(
  async (slug: string): Promise<ResolvedCloudCreds | null> => {
    if (!hasAdminClient()) return null;
    const { data } = await createAdminClient().rpc("wa_cloud_config_by_slug", { p_slug: slug });
    return fromJson(data);
  },
);

/** Credenciales del número madre de una agencia. */
export const getCloudCreds = cache(
  async (agencyId: string): Promise<ResolvedCloudCreds | null> => {
    if (!hasAdminClient()) return null;
    const { data } = await createAdminClient()
      .from("wa_channels")
      .select("id")
      .eq("agency_id", agencyId)
      .eq("is_mother", true)
      .maybeSingle();
    if (!data) return null;
    return getCloudCredsByChannel(data.id);
  },
);

/**
 * ¿Esta agencia puede hablar por la Cloud API?
 * Reemplaza al viejo `hasCloudApi()` que miraba una env global.
 */
export async function hasCloudApi(agencyId: string): Promise<boolean> {
  const creds = await getCloudCreds(agencyId);
  return !!creds?.token && !!creds.phoneNumberId;
}

/**
 * El verify token del handshake, cuando Meta pega a la URL vieja (la que no
 * lleva slug) y por lo tanto no dice de qué agencia se trata. La comparación se
 * hace dentro de la base para no sacar los tokens de ahí.
 */
export async function verifyTokenMatches(token: string): Promise<boolean> {
  if (!token) return false;
  // La env solo cuenta si hay una agencia designada como la que heredó la
  // configuración vieja; si no, un verify token global habilitaría el handshake
  // de cualquiera.
  if (legacyAgencyId() && envVerifyToken() && token === envVerifyToken()) return true;
  if (!hasAdminClient()) return false;
  const { data } = await createAdminClient().rpc("wa_cloud_verify_token_matches", {
    p_token: token,
  });
  return data === true;
}

/* ───────────────────────── escritura ───────────────────────── */

export type SecretSlot = "token" | "app_secret" | "verify_token";

/** Guarda (o pisa) un secreto en el Vault. Nunca toca una columna de texto. */
export async function setCloudSecret(
  channelId: string,
  slot: SecretSlot,
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasAdminClient()) {
    return { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY para guardar credenciales." };
  }
  const { error } = await createAdminClient().rpc("wa_cloud_secret_set", {
    p_channel_id: channelId,
    p_slot: slot,
    p_value: value,
  });
  if (error) return { ok: false, error: "No se pudo guardar la credencial." };
  return { ok: true };
}

/** Borra del Vault los tres secretos del canal (desconectar la cuenta). */
export async function clearCloudSecrets(
  channelId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasAdminClient()) {
    return { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY." };
  }
  const { error } = await createAdminClient().rpc("wa_cloud_secret_clear", {
    p_channel_id: channelId,
  });
  if (error) return { ok: false, error: "No se pudieron borrar las credenciales." };
  return { ok: true };
}

/**
 * ¿Esta agencia está andando con la configuración vieja del servidor?
 * Solo para el cartel que la invita a cargar lo suyo y dejar de depender de una env.
 */
export function hasLegacyEnvCreds(agencyId: string): boolean {
  return usesLegacyEnv(agencyId) && !!envToken();
}
