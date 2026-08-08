"use server";

/**
 * Conexión con Instagram — el asistente de /config/instagram.
 *
 * Misma idea que WhatsApp: el admin busca los datos en el panel de Meta, los
 * pega acá y el sistema hace el resto. Los secretos se guardan cifrados en el
 * Vault de Supabase y NUNCA vuelven al navegador: la pantalla recibe banderas,
 * los últimos 4 del token y el diagnóstico.
 *
 * ─────────────────────────────────────────────
 * LA DIFERENCIA CON WHATSAPP QUE HAY QUE TENER PRESENTE
 *
 * En WhatsApp el sistema le dice a Meta a qué URL mandarle los mensajes
 * (`override_callback_uri`) y la agencia no toca nada. En Instagram ESO NO SE
 * PUEDE: la callback URL es una sola por app, se carga a mano en el panel, y la
 * documentación es explícita ("Account level webhooks customization is not
 * supported").
 *
 * Por eso el asistente tiene un paso que en WhatsApp no existe —copiar la URL y
 * el verify token y pegarlos en Meta— y por eso el verify token acá se MUESTRA
 * en vez de esconderse: sin él, el admin no puede terminar de configurar nada.
 * `connectInstagram()` hace lo único que sí se puede por API: suscribir la
 * cuenta a los eventos.
 *
 * La buena noticia, y es grande: para la PROPIA cuenta de la agencia alcanza el
 * acceso estándar de Meta. Sin App Review y sin verificación del negocio — que
 * es justo donde se traba WhatsApp.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction, succeed, fail, logActivity, type ActionResult } from "@/lib/actions/core";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/database.types";
import type { TablesUpdate } from "@/lib/types";
import { igWebhookPathFor } from "@/lib/ig/routes";
import {
  exchangeIgLongLived,
  getIgAccount,
  getIgSubscription,
  refreshIgToken,
  subscribeIgWebhook,
  unsubscribeIgWebhook,
  type IgCreds,
} from "@/lib/ig/graph";
import { clearIgSecrets, getIgCredsByChannel, setIgSecret } from "@/lib/ig/credentials";

const ADMIN_ONLY = "Esto lo maneja un admin de la agencia.";
const NO_ADMIN_CLIENT =
  "Falta la clave de servicio de Supabase (SUPABASE_SERVICE_ROLE_KEY). Sin eso no se pueden guardar credenciales.";
const NO_CHANNEL = "Todavía no hay canal de Instagram. Crealo arriba y volvé a intentar.";

/** Cuando quedan menos de estos días, el token es un problema, no un dato. */
const TOKEN_WARN_DAYS = 15;

/* ═══════════════════════════════════════════════════════════
   Tipos que consume la pantalla
   ═══════════════════════════════════════════════════════════ */

export type IgCheck = {
  key: "cuenta" | "token" | "webhook" | "puente";
  label: string;
  level: "ok" | "warn" | "error" | "pending";
  detail: string;
  action: string | null;
};

export type IgBridgeSettings = {
  enabled: boolean;
  phone: string | null;
  label: string;
  text: string;
  autoWa: boolean;
  autoWaText: string;
  countryCode: string;
};

export type IgStatus = {
  channelId: string;
  /** Banderas, nunca valores. */
  hasToken: boolean;
  hasAppSecret: boolean;
  hasIgAppSecret: boolean;
  hasVerifyToken: boolean;
  appId: string | null;
  igAppId: string | null;
  igUserId: string | null;
  username: string | null;
  accountName: string | null;
  profilePictureUrl: string | null;
  followersCount: number | null;
  tokenTail: string | null;
  tokenExpiresAt: string | null;
  /** días que le quedan al token; null = no lo sabemos */
  tokenDaysLeft: number | null;
  /** Ruta del webhook de ESTA agencia. El cliente le antepone el origen. */
  webhookPath: string;
  webhookSubscribed: boolean;
  humanAgentEnabled: boolean;
  checkedAt: string | null;
  checkOk: boolean | null;
  checks: IgCheck[];
  connected: boolean;
  bridge: IgBridgeSettings;
};

type IgAccountRow = {
  channel_id: string;
  agency_id: string;
  auth_mode: string;
  app_id: string | null;
  ig_app_id: string | null;
  ig_user_id: string | null;
  username: string | null;
  account_name: string | null;
  profile_picture_url: string | null;
  followers_count: number | null;
  token_secret_id: string | null;
  app_secret_id: string | null;
  ig_app_secret_id: string | null;
  verify_secret_id: string | null;
  webhook_slug: string;
  token_tail: string | null;
  token_expires_at: string | null;
  checked_at: string | null;
  check_ok: boolean | null;
  checks: unknown;
  webhook_subscribed: boolean;
  human_agent_enabled: boolean;
  bridge_enabled: boolean;
  bridge_phone: string | null;
  bridge_label: string;
  bridge_text: string;
  auto_wa_enabled: boolean;
  auto_wa_text: string;
  phone_country_code: string;
};

/* ═══════════════════════════════════════════════════════════
   Contexto
   ═══════════════════════════════════════════════════════════ */

type Ctx = {
  agencyId: string;
  channelId: string;
  channelStatus: string;
  row: IgAccountRow;
};

async function loadCtx(): Promise<{ ok: true; ctx: Ctx } | { ok: false; error: string }> {
  // requireAction() TIRA si no hay sesión. Sin este catch, una sesión vencida en
  // medio del flujo deja el botón girando para siempre y sin un cartel.
  let base: Awaited<ReturnType<typeof requireAction>>;
  try {
    base = await requireAction();
  } catch {
    return { ok: false, error: "Se cerró la sesión. Volvé a entrar y probá de nuevo." };
  }
  const { agency, isAdmin } = base;
  if (!isAdmin) return { ok: false, error: ADMIN_ONLY };
  if (!hasAdminClient()) return { ok: false, error: NO_ADMIN_CLIENT };

  const admin = createAdminClient();
  const { data: channel } = await admin
    .from("wa_channels")
    .select("id, status")
    .eq("agency_id", agency.id)
    .eq("kind", "instagram")
    .maybeSingle();
  if (!channel) return { ok: false, error: NO_CHANNEL };

  // El trigger de la 0023 la crea con el canal; si alguien borró la fila a mano,
  // la reponemos en vez de dejar la pantalla muerta.
  let { data: row } = await admin
    .from("ig_accounts")
    .select("*")
    .eq("channel_id", channel.id)
    .maybeSingle();

  if (!row) {
    const { data: created } = await admin
      .from("ig_accounts")
      .insert({ channel_id: channel.id, agency_id: agency.id })
      .select("*")
      .single();
    row = created;
  }
  if (!row) return { ok: false, error: "No se pudo preparar la conexión con Instagram." };

  return {
    ok: true,
    ctx: {
      agencyId: agency.id,
      channelId: channel.id,
      channelStatus: channel.status,
      row: row as IgAccountRow,
    },
  };
}

function daysLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  return Math.floor((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
}

function toStatus(ctx: Ctx, checks: IgCheck[] | null): IgStatus {
  const row = ctx.row;
  const stored = Array.isArray(row.checks) ? (row.checks as IgCheck[]) : [];
  return {
    channelId: ctx.channelId,
    hasToken: !!row.token_secret_id,
    hasAppSecret: !!row.app_secret_id,
    hasIgAppSecret: !!row.ig_app_secret_id,
    hasVerifyToken: !!row.verify_secret_id,
    appId: row.app_id,
    igAppId: row.ig_app_id,
    igUserId: row.ig_user_id,
    username: row.username,
    accountName: row.account_name,
    profilePictureUrl: row.profile_picture_url,
    followersCount: row.followers_count,
    tokenTail: row.token_tail,
    tokenExpiresAt: row.token_expires_at,
    tokenDaysLeft: daysLeft(row.token_expires_at),
    webhookPath: igWebhookPathFor(row.webhook_slug),
    webhookSubscribed: row.webhook_subscribed,
    humanAgentEnabled: row.human_agent_enabled,
    checkedAt: row.checked_at,
    checkOk: row.check_ok,
    checks: checks ?? stored,
    connected: ctx.channelStatus === "conectado",
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

async function credsOf(ctx: Ctx): Promise<IgCreds | null> {
  return getIgCredsByChannel(ctx.channelId);
}

function revalidate() {
  revalidatePath("/config/instagram");
  revalidatePath("/crm");
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
}

/* ═══════════════════════════════════════════════════════════
   Leer el estado
   ═══════════════════════════════════════════════════════════ */

export async function getInstagramStatus(): Promise<ActionResult<IgStatus>> {
  const loaded = await loadCtx();
  if (!loaded.ok) return fail(loaded.error);
  return succeed(toStatus(loaded.ctx, null));
}

/**
 * El verify token en claro.
 *
 * Acá NO es un caso excepcional como en WhatsApp: en Instagram la callback URL y
 * el verify token se cargan a mano en el panel de Meta sí o sí, así que el admin
 * lo necesita para terminar de conectar. Sigue siendo un pedido explícito para
 * que no viaje en el render de la página.
 */
export async function revealIgVerifyToken(): Promise<ActionResult<{ verifyToken: string }>> {
  const loaded = await loadCtx();
  if (!loaded.ok) return fail(loaded.error);
  if (!loaded.ctx.row.verify_secret_id) {
    return fail("Todavía no hay verify token. Guardá las credenciales primero.");
  }
  const creds = await credsOf(loaded.ctx);
  if (!creds?.verifyToken) return fail("No se pudo leer el verify token guardado.");
  return succeed({ verifyToken: creds.verifyToken });
}

/* ═══════════════════════════════════════════════════════════
   Crear el canal
   ═══════════════════════════════════════════════════════════ */

/** Respuesta automática con la que nace el canal de Instagram. */
const IG_AUTO_REPLY =
  "¡Hola! Gracias por escribirnos. Contanos a dónde querés viajar y en qué fechas, y en un ratito te contesta un asesor.";

/**
 * Crea el canal de Instagram de la agencia. Idempotente: hay un índice único
 * parcial de un solo canal por agencia, así que si dos clicks corren a la vez
 * devolvemos el que ganó.
 */
export async function createInstagramChannel(): Promise<ActionResult<{ channelId: string }>> {
  const { supabase, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  async function find() {
    const { data } = await supabase
      .from("wa_channels")
      .select("id")
      .eq("agency_id", agency.id)
      .eq("kind", "instagram")
      .maybeSingle();
    return data?.id ?? null;
  }

  const already = await find();
  if (already) return succeed({ channelId: already });

  const { data: created, error } = await supabase
    .from("wa_channels")
    .insert({
      agency_id: agency.id,
      branch_id: null,
      kind: "instagram",
      is_mother: false,
      label: "Instagram",
      status: "desconectado",
      auto_reply_enabled: true,
      auto_reply_text: IG_AUTO_REPLY,
    })
    .select("id")
    .single();

  if (error || !created) {
    if (error?.code === "23505") {
      const winner = await find();
      if (winner) {
        revalidate();
        return succeed({ channelId: winner });
      }
    }
    return fail("No se pudo crear el canal de Instagram. Probá de nuevo.");
  }

  await logActivity({
    agencyId: agency.id,
    type: "sistema",
    body: "Se creó el canal de Instagram",
  });

  revalidate();
  return succeed({ channelId: created.id });
}

/* ═══════════════════════════════════════════════════════════
   Paso 1 — guardar y validar las credenciales
   ═══════════════════════════════════════════════════════════ */

const credentialsSchema = z.object({
  appId: z.string().trim().regex(/^\d{5,25}$/, "El App ID de Meta son solo números.").optional(),
  igAppId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, "El Instagram App ID son solo números.")
    .optional(),
  appSecret: z.string().trim().min(16, "Ese App Secret quedó corto.").max(200).optional(),
  igAppSecret: z
    .string()
    .trim()
    .min(16, "Ese Instagram App Secret quedó corto.")
    .max(200)
    .optional(),
  token: z.string().trim().min(30, "Ese token quedó corto. Pegalo completo.").max(1000).optional(),
});

/**
 * Guarda lo que el admin pegó y lo valida contra Meta en el momento.
 *
 * PRIMERO SE VALIDA, DESPUÉS SE ESCRIBE — igual que en WhatsApp y por lo mismo:
 * el Vault no versiona nada y `update_secret` pisa el valor viejo. Guardar antes
 * de validar significa que pegar un token con un carácter de menos borra el que
 * estaba andando, y la agencia deja de recibir DMs mientras la pantalla sigue
 * diciendo "Conectado".
 *
 * El token, además, se cambia por uno largo apenas se puede: los que salen del
 * login duran UNA HORA. Guardar uno corto como si fuera bueno es una agencia que
 * deja de recibir mensajes al mediodía sin que nadie toque nada.
 */
export async function saveInstagramCredentials(
  input: z.infer<typeof credentialsSchema>,
): Promise<ActionResult<IgStatus>> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Revisá los datos de Meta.");
  }
  const loaded = await loadCtx();
  if (!loaded.ok) return fail(loaded.error);
  const ctx = loaded.ctx;
  const admin = createAdminClient();

  const guardadas = await credsOf(ctx);
  const token = parsed.data.token ?? guardadas?.token ?? null;
  if (!token) return fail("Falta el token de acceso de Instagram.");

  const appId = parsed.data.appId ?? ctx.row.app_id;
  const igAppId = parsed.data.igAppId ?? ctx.row.ig_app_id;
  const appSecret = parsed.data.appSecret ?? guardadas?.appSecret ?? null;
  const igAppSecret = parsed.data.igAppSecret ?? guardadas?.igAppSecret ?? null;

  if (!appSecret && !igAppSecret) {
    return fail(
      "Falta al menos un App Secret. Con él se valida que los mensajes vengan de verdad de Meta.",
    );
  }

  /* 1. ¿el token sirve? Es la validación más barata y la que más dice: si /me
     responde, el token vale, tiene el permiso básico y además nos dice de qué
     cuenta es. */
  const candidatas: IgCreds = {
    token,
    authMode: "instagram_login",
    igUserId: ctx.row.ig_user_id,
    pageId: null,
    appId,
    appSecret,
    igAppId,
    igAppSecret,
    verifyToken: guardadas?.verifyToken ?? null,
    humanAgentEnabled: ctx.row.human_agent_enabled,
  };

  const account = await getIgAccount(candidatas);
  if (!account.ok) {
    return fail(
      account.code === 190
        ? "Meta rechazó el token. Generá uno nuevo en Instagram, API setup with Instagram login, Generate token."
        : account.error,
    );
  }
  if (!account.data.userId) {
    return fail("Meta no devolvió el ID de la cuenta. Revisá que sea una cuenta profesional.");
  }

  /* 2. token largo.
     Si el admin pegó un token nuevo, lo que supiéramos del vencimiento anterior
     deja de valer: se pone en null y solo se completa si Meta nos dice la fecha
     de verdad. Inventar "60 días" cuando el canje falla es peor que no saber —
     el diagnóstico mostraría un token sano hasta el día que deje de entrar todo.
     Con null, la pantalla pide renovarlo y el cron lo agarra en su próxima
     pasada. Que el canje falle es normal: el token del panel ya viene largo. */
  let finalToken = token;
  let expiresAt: string | null = ctx.row.token_expires_at;
  if (parsed.data.token) {
    expiresAt = null;
    if (igAppSecret) {
      const long = await exchangeIgLongLived(igAppSecret, token);
      if (long.ok) {
        finalToken = long.data.token;
        expiresAt = long.data.expiresAt?.toISOString() ?? null;
      }
    }
  }

  /* ─── todo validado: recién ahora se escribe ─── */

  if (parsed.data.appSecret) {
    const res = await setIgSecret(ctx.channelId, "app_secret", parsed.data.appSecret);
    if (!res.ok) return fail(res.error);
  }
  if (parsed.data.igAppSecret) {
    const res = await setIgSecret(ctx.channelId, "ig_app_secret", parsed.data.igAppSecret);
    if (!res.ok) return fail(res.error);
  }
  if (parsed.data.token || finalToken !== token) {
    const res = await setIgSecret(ctx.channelId, "token", finalToken);
    if (!res.ok) return fail(res.error);
  }
  // El verify token lo inventamos nosotros: es lo que Meta nos devuelve para
  // probar que el webhook es nuestro. Pedírselo al admin sería pedirle que
  // invente algo por nosotros.
  if (!ctx.row.verify_secret_id) {
    const res = await setIgSecret(ctx.channelId, "verify_token", crypto.randomUUID());
    if (!res.ok) return fail(res.error);
  }

  const cambioDeCuenta =
    !!ctx.row.ig_user_id && ctx.row.ig_user_id !== account.data.userId;

  const { error: updateError } = await admin
    .from("ig_accounts")
    .update({
      app_id: appId,
      ig_app_id: igAppId,
      ig_user_id: account.data.userId,
      username: account.data.username,
      account_name: account.data.name,
      profile_picture_url: account.data.profilePictureUrl,
      followers_count: account.data.followersCount,
      token_tail: parsed.data.token ? finalToken.slice(-4) : ctx.row.token_tail,
      token_expires_at: expiresAt,
      // El diagnóstico guardado es de ANTES de este guardado: dejarlo puesto
      // haría que la pantalla siga mostrando el error viejo después de una
      // validación que salió bien.
      checks: [] as unknown as Json,
      check_ok: null,
      checked_at: null,
      ...(cambioDeCuenta ? { webhook_subscribed: false, webhook_callback_url: null } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("channel_id", ctx.channelId);

  if (updateError) {
    // 23505 = el índice único de ig_user_id: esa cuenta ya está conectada en
    // otra agencia del sistema.
    return fail(
      updateError.code === "23505"
        ? "Esa cuenta de Instagram ya está conectada en otra agencia del sistema."
        : "No se pudieron guardar los datos de la cuenta. Probá de nuevo.",
    );
  }

  // El nombre del canal es lo que se ve en el chip de cada chat: que diga la
  // arroba real y no "Instagram" a secas.
  await admin
    .from("wa_channels")
    .update({
      label: account.data.username ? `@${account.data.username}` : "Instagram",
      ...(cambioDeCuenta ? { status: "desconectado" as const, last_connected_at: null } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", ctx.channelId);

  const fresh = await loadCtx();
  revalidate();
  return succeed(fresh.ok ? toStatus(fresh.ctx, null) : toStatus(ctx, null));
}

/* ═══════════════════════════════════════════════════════════
   Paso 2 — suscribir la cuenta y diagnosticar
   ═══════════════════════════════════════════════════════════ */

/**
 * Le pide a Meta que nos entregue los eventos de esta cuenta.
 *
 * Lo que ESTO NO HACE: configurar a dónde los manda. Esa parte es manual (la
 * callback URL vive a nivel app en el panel de Meta) y la pantalla la explica
 * con la URL y el verify token listos para copiar.
 */
export async function connectInstagram(): Promise<ActionResult<IgStatus>> {
  const loaded = await loadCtx();
  if (!loaded.ok) return fail(loaded.error);
  const ctx = loaded.ctx;

  const creds = await credsOf(ctx);
  if (!creds) return fail("Guardá primero las credenciales de Instagram.");
  if (!creds.igUserId) return fail("Todavía no sabemos cuál es la cuenta. Guardá el token de nuevo.");

  const res = await subscribeIgWebhook(creds);
  if (!res.ok) return fail(res.error);

  const base = appUrl();
  await createAdminClient()
    .from("ig_accounts")
    .update({
      webhook_subscribed: true,
      webhook_callback_url: base ? `${base}${igWebhookPathFor(ctx.row.webhook_slug)}` : null,
      updated_at: new Date().toISOString(),
    })
    .eq("channel_id", ctx.channelId);

  await logActivity({
    agencyId: ctx.agencyId,
    type: "sistema",
    body: "Se conectó la cuenta de Instagram",
  });

  return runInstagramDiagnostics();
}

/* ═══════════════════════════════════════════════════════════
   Diagnóstico
   ═══════════════════════════════════════════════════════════ */

export async function runInstagramDiagnostics(): Promise<ActionResult<IgStatus>> {
  const loaded = await loadCtx();
  if (!loaded.ok) return fail(loaded.error);
  const ctx = loaded.ctx;
  const admin = createAdminClient();

  const creds = await credsOf(ctx);
  if (!creds) return fail("Todavía no hay credenciales de Instagram cargadas.");

  const checks: IgCheck[] = [];
  const patch: TablesUpdate<"ig_accounts"> = { checked_at: new Date().toISOString() };

  /* cuenta + token: /me valida los dos de una */
  const account = await getIgAccount(creds);
  if (!account.ok) {
    checks.push({
      key: "cuenta",
      label: "Cuenta de Instagram",
      level: "error",
      detail: account.error,
      action:
        "Generá un token nuevo en Meta: Instagram, API setup with Instagram login, Generate token, y pegalo arriba.",
    });
  } else {
    patch.username = account.data.username;
    patch.account_name = account.data.name;
    patch.profile_picture_url = account.data.profilePictureUrl;
    patch.followers_count = account.data.followersCount;
    checks.push({
      key: "cuenta",
      label: "Cuenta de Instagram",
      level: "ok",
      detail: `Conectada a @${account.data.username ?? "la cuenta"}${
        account.data.accountType ? ` (${account.data.accountType.toLowerCase()})` : ""
      }.`,
      action: null,
    });

    const left = daysLeft(ctx.row.token_expires_at);
    checks.push(
      left == null
        ? {
            key: "token",
            label: "Token de acceso",
            level: "warn",
            detail: "No sabemos cuándo vence el token.",
            action: "Tocá Renovar token para que el sistema lo estire 60 días más.",
          }
        : left <= 0
          ? {
              key: "token",
              label: "Token de acceso",
              level: "error",
              detail: "El token venció.",
              action: "Generá uno nuevo en Meta y pegalo arriba.",
            }
          : left <= TOKEN_WARN_DAYS
            ? {
                key: "token",
                label: "Token de acceso",
                level: "warn",
                detail: `Al token le quedan ${left} días.`,
                action:
                  "Tocá Renovar token. El sistema también lo renueva solo, pero conviene no llegar al límite.",
              }
            : {
                key: "token",
                label: "Token de acceso",
                level: "ok",
                detail: `Le quedan ${left} días. El sistema lo renueva solo antes de que venza.`,
                action: null,
              },
    );
  }

  /* webhook */
  const sub = await getIgSubscription(creds);
  if (!sub.ok) {
    patch.webhook_subscribed = false;
    checks.push({
      key: "webhook",
      label: "Webhook",
      level: "error",
      detail: sub.error,
      action: "Tocá Conectar para volver a suscribir la cuenta.",
    });
  } else if (!sub.data.subscribed) {
    patch.webhook_subscribed = false;
    checks.push({
      key: "webhook",
      label: "Webhook",
      level: "error",
      detail: "La app no está suscripta a la cuenta: Meta no te entrega ningún mensaje.",
      action: "Tocá Conectar acá arriba.",
    });
  } else if (!sub.data.fields.includes("messages")) {
    patch.webhook_subscribed = true;
    checks.push({
      key: "webhook",
      label: "Webhook",
      level: "warn",
      detail: "La cuenta está suscripta pero sin el campo de mensajes.",
      action: "Tocá Conectar de nuevo para agregarlo.",
    });
  } else {
    patch.webhook_subscribed = true;
    checks.push({
      key: "webhook",
      label: "Webhook",
      level: "ok",
      detail: "Meta entrega los mensajes al sistema.",
      action:
        appUrl().length > 0
          ? null
          : "Ojo: falta configurar la dirección pública del sistema (NEXT_PUBLIC_APP_URL).",
    });
  }

  /* puente a WhatsApp */
  if (!ctx.row.bridge_enabled) {
    checks.push({
      key: "puente",
      label: "Puente a WhatsApp",
      level: "pending",
      detail: "Está apagado: la respuesta automática no ofrece pasar a WhatsApp.",
      action: "Prendelo abajo si querés que las consultas terminen en WhatsApp.",
    });
  } else {
    const phone = await bridgePhonePreview(ctx.agencyId, ctx.row.bridge_phone);
    checks.push(
      phone
        ? {
            key: "puente",
            label: "Puente a WhatsApp",
            level: "ok",
            detail: `Las consultas nuevas reciben un link al WhatsApp ${phone}.`,
            action: null,
          }
        : {
            key: "puente",
            label: "Puente a WhatsApp",
            level: "warn",
            detail: "No hay ningún número de WhatsApp desde el cual invitar al cliente.",
            action:
              "Vinculá el WhatsApp de una sucursal, o cargá un número a mano acá abajo.",
          },
    );
  }

  const hayError = checks.some((c) => c.level === "error");
  const listo = !hayError && checks.some((c) => c.key === "webhook" && c.level === "ok");

  patch.check_ok = !hayError;
  patch.checks = checks as unknown as Json;
  patch.updated_at = new Date().toISOString();
  await admin.from("ig_accounts").update(patch).eq("channel_id", ctx.channelId);

  // El estado del canal es lo que mira el resto del sistema (el chat, el envío).
  await admin
    .from("wa_channels")
    .update({
      status: listo ? "conectado" : hayError ? "error" : "desconectado",
      ...(listo ? { last_connected_at: new Date().toISOString(), last_error: null } : {}),
      ...(hayError
        ? { last_error: checks.find((c) => c.level === "error")?.detail ?? null }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", ctx.channelId);

  const fresh = await loadCtx();
  revalidate();
  return succeed(fresh.ok ? toStatus(fresh.ctx, checks) : toStatus(ctx, checks));
}

/** Qué número vería el cliente en el link de WhatsApp, para el diagnóstico. */
async function bridgePhonePreview(
  agencyId: string,
  explicit: string | null,
): Promise<string | null> {
  if (explicit) return explicit;
  const admin = createAdminClient();
  const { data } = await admin
    .from("wa_channels")
    .select("phone, kind, is_mother, status")
    .eq("agency_id", agencyId)
    .not("phone", "is", null);

  const branch = (data ?? []).find((c) => c.kind === "baileys" && c.status === "conectado");
  const mother = (data ?? []).find((c) => c.is_mother);
  return branch?.phone ?? mother?.phone ?? null;
}

/* ═══════════════════════════════════════════════════════════
   Token: renovarlo antes de que venza
   ═══════════════════════════════════════════════════════════ */

/**
 * Estira el token 60 días más.
 *
 * Es la diferencia más importante con WhatsApp en el día a día: allá el token
 * del usuario del sistema no vence nunca; acá vence SIEMPRE. Sin esto, la
 * integración se muere sola a los dos meses y nadie se entera hasta que un
 * cliente reclama que no le contestaron.
 */
export async function refreshInstagramToken(): Promise<ActionResult<IgStatus>> {
  const loaded = await loadCtx();
  if (!loaded.ok) return fail(loaded.error);
  const ctx = loaded.ctx;

  const creds = await credsOf(ctx);
  if (!creds) return fail("Todavía no hay token cargado.");

  const res = await refreshIgToken(creds.token);
  if (!res.ok) {
    return fail(
      // Meta pide que el token tenga al menos 24 hs de vida para renovarlo.
      res.code === 190
        ? "Meta no dejó renovar el token. Si lo cargaste hoy, probá mañana; si venció, generá uno nuevo."
        : res.error,
    );
  }

  const saved = await setIgSecret(ctx.channelId, "token", res.data.token);
  if (!saved.ok) return fail(saved.error);

  await createAdminClient()
    .from("ig_accounts")
    .update({
      token_tail: res.data.token.slice(-4),
      token_expires_at: res.data.expiresAt?.toISOString() ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("channel_id", ctx.channelId);

  // NO se corre el diagnóstico acá: `getIgCredsByChannel` está memoizada con
  // `cache()` de React y en esta misma request ya devolvió el token VIEJO, así
  // que los chequeos saldrían con el token que Meta acaba de reemplazar y
  // podrían reportar un error que no existe. La pantalla se pinta con la fila
  // recién escrita, y el diagnóstico corre cuando el admin lo pida.
  const fresh = await loadCtx();
  revalidate();
  return succeed(fresh.ok ? toStatus(fresh.ctx, null) : toStatus(ctx, null));
}

/* ═══════════════════════════════════════════════════════════
   El puente y la respuesta automática
   ═══════════════════════════════════════════════════════════ */

const bridgeSchema = z.object({
  enabled: z.boolean().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  label: z.string().trim().min(1).max(60).optional(),
  text: z.string().trim().min(1).max(400).optional(),
  autoWa: z.boolean().optional(),
  autoWaText: z.string().trim().min(1).max(1000).optional(),
  countryCode: z.string().trim().regex(/^\d{1,4}$/, "El código de país son solo números.").optional(),
  humanAgent: z.boolean().optional(),
});

export async function updateInstagramBridge(
  input: z.infer<typeof bridgeSchema>,
): Promise<ActionResult<IgStatus>> {
  const parsed = bridgeSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Revisá la configuración del puente.");
  }
  const loaded = await loadCtx();
  if (!loaded.ok) return fail(loaded.error);
  const ctx = loaded.ctx;

  const patch: TablesUpdate<"ig_accounts"> = { updated_at: new Date().toISOString() };
  const d = parsed.data;
  if (d.enabled !== undefined) patch.bridge_enabled = d.enabled;
  if (d.phone !== undefined) patch.bridge_phone = d.phone?.replace(/\D/g, "") || null;
  if (d.label !== undefined) patch.bridge_label = d.label;
  if (d.text !== undefined) patch.bridge_text = d.text;
  if (d.autoWa !== undefined) patch.auto_wa_enabled = d.autoWa;
  if (d.autoWaText !== undefined) patch.auto_wa_text = d.autoWaText;
  if (d.countryCode !== undefined) patch.phone_country_code = d.countryCode;
  if (d.humanAgent !== undefined) patch.human_agent_enabled = d.humanAgent;

  const { error } = await createAdminClient()
    .from("ig_accounts")
    .update(patch)
    .eq("channel_id", ctx.channelId);
  if (error) return fail("No se pudo guardar. Probá de nuevo.");

  const fresh = await loadCtx();
  revalidate();
  return succeed(fresh.ok ? toStatus(fresh.ctx, null) : toStatus(ctx, null));
}

/* ═══════════════════════════════════════════════════════════
   Desconectar
   ═══════════════════════════════════════════════════════════ */

/**
 * Borra las credenciales del Vault y desuscribe la cuenta en Meta.
 * No toca el historial: los chats y los leads quedan como están.
 */
export async function disconnectInstagram(): Promise<ActionResult<null>> {
  const loaded = await loadCtx();
  if (!loaded.ok) return fail(loaded.error);
  const ctx = loaded.ctx;

  const creds = await credsOf(ctx);
  // Primero le avisamos a Meta (necesita el token), después borramos.
  if (creds?.igUserId) await unsubscribeIgWebhook(creds);

  const cleared = await clearIgSecrets(ctx.channelId);
  if (!cleared.ok) return fail(cleared.error);

  const admin = createAdminClient();
  await admin
    .from("ig_accounts")
    .update({
      app_id: null,
      ig_app_id: null,
      ig_user_id: null,
      username: null,
      account_name: null,
      profile_picture_url: null,
      followers_count: null,
      webhook_callback_url: null,
      checked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("channel_id", ctx.channelId);

  await admin
    .from("wa_channels")
    .update({
      label: "Instagram",
      status: "desconectado",
      last_connected_at: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ctx.channelId);

  await logActivity({
    agencyId: ctx.agencyId,
    type: "sistema",
    body: "Se desconectó la cuenta de Instagram",
  });

  revalidate();
  return succeed(null);
}
