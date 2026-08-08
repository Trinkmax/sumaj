"use server";

/**
 * Conexión con la Cloud API de Meta — el asistente de /config/whatsapp.
 *
 * La idea: el admin busca las credenciales en el panel de Meta, las pega acá, y
 * el sistema hace TODO lo demás por API (valida, descubre los números, suscribe
 * el webhook y diagnostica). Nada de variables de entorno ni de redeploys.
 *
 * Los tres secretos (access token, App Secret, verify token) se guardan cifrados
 * en el Vault de Supabase y NUNCA vuelven al navegador: la pantalla recibe solo
 * banderas ("está cargado"), los últimos 4 caracteres del token y el resultado
 * del diagnóstico. La única excepción es el verify token, que se puede pedir
 * explícitamente para pegarlo a mano en Meta si la configuración por API falla.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction, succeed, fail, logActivity, type ActionResult } from "@/lib/actions/core";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/database.types";
import type { TablesUpdate } from "@/lib/types";
import { webhookPathFor } from "@/lib/wa/routes";
import {
  checkApp,
  debugToken,
  getAppSubscription,
  getPhoneNumber,
  getWaba,
  getWabaSubscription,
  listPhoneNumbers,
  registerCloudNumber,
  subscribeAppWebhook,
  subscribeWaba,
  unsubscribeWaba,
  REQUIRED_SCOPES,
  type CloudCreds,
  type CloudPhoneNumber,
} from "@/lib/wa/cloud";
import {
  clearCloudSecrets,
  getCloudCredsByChannel,
  hasLegacyEnvCreds,
  setCloudSecret,
} from "@/lib/wa/cloud-credentials";

const ADMIN_ONLY = "Esto lo maneja un admin de la agencia.";
const NO_ADMIN_CLIENT =
  "Falta la clave de servicio de Supabase (SUPABASE_SERVICE_ROLE_KEY). Sin eso no se pueden guardar credenciales.";
const NO_MOTHER = "Todavía no hay número madre. Crealo arriba y volvé a intentar.";


/* ═══════════════════════════════════════════════════════════
   Tipos que consume la pantalla
   ═══════════════════════════════════════════════════════════ */

/** Un renglón del diagnóstico: qué se chequeó, cómo salió y qué hacer. */
export type CloudCheck = {
  key: "app" | "token" | "cuenta" | "numero" | "webhook" | "registro";
  label: string;
  level: "ok" | "warn" | "error" | "pending";
  detail: string;
  /** Qué tiene que hacer el admin si no está en verde. */
  action: string | null;
};

export type CloudStatus = {
  channelId: string;
  /** Banderas, nunca valores. */
  hasToken: boolean;
  hasAppSecret: boolean;
  hasVerifyToken: boolean;
  appId: string | null;
  wabaId: string | null;
  phoneNumberId: string | null;
  phone: string | null;
  /** Últimos 4 del token, para reconocer cuál está cargado. */
  tokenTail: string | null;
  tokenExpiresAt: string | null;
  /** true = System User (no vence). Es el que hay que usar. */
  tokenPermanent: boolean;
  /** Ruta del webhook de ESTA agencia. El cliente le antepone el origen. */
  webhookPath: string;
  wabaName: string | null;
  businessVerificationStatus: string | null;
  accountReviewStatus: string | null;
  webhookSubscribed: boolean;
  checkedAt: string | null;
  checkOk: boolean | null;
  checks: CloudCheck[];
  /** Está andando con las envs viejas del servidor y no con lo cargado acá. */
  usingEnvFallback: boolean;
  connected: boolean;
};

type CredentialsRow = {
  channel_id: string;
  agency_id: string;
  app_id: string | null;
  waba_id: string | null;
  business_id: string | null;
  webhook_slug: string;
  token_secret_id: string | null;
  app_secret_id: string | null;
  verify_secret_id: string | null;
  token_tail: string | null;
  token_expires_at: string | null;
  token_scopes: string[] | null;
  token_app_id: string | null;
  checked_at: string | null;
  check_ok: boolean | null;
  checks: unknown;
  waba_name: string | null;
  business_verification_status: string | null;
  account_review_status: string | null;
  webhook_subscribed: boolean;
  webhook_callback_url: string | null;
};

/* ═══════════════════════════════════════════════════════════
   Contexto: el número madre de la agencia + su fila de credenciales
   ═══════════════════════════════════════════════════════════ */

type Ctx = {
  agencyId: string;
  channelId: string;
  channelStatus: string;
  phone: string | null;
  phoneNumberId: string | null;
  row: CredentialsRow;
};

async function loadCtx(): Promise<
  { ok: true; ctx: Ctx } | { ok: false; error: string }
> {
  // requireAction() TIRA si no hay sesión, y por acá pasan todas las actions del
  // asistente. Sin este catch, una sesión vencida en medio del flujo deja el
  // botón girando para siempre y sin un solo cartel que explique qué pasó.
  let ctxBase: Awaited<ReturnType<typeof requireAction>>;
  try {
    ctxBase = await requireAction();
  } catch {
    return { ok: false, error: "Se cerró la sesión. Volvé a entrar y probá de nuevo." };
  }
  const { agency, isAdmin } = ctxBase;
  if (!isAdmin) return { ok: false, error: ADMIN_ONLY };
  if (!hasAdminClient()) return { ok: false, error: NO_ADMIN_CLIENT };

  const admin = createAdminClient();
  const { data: channel } = await admin
    .from("wa_channels")
    .select("id, status, phone, phone_number_id")
    .eq("agency_id", agency.id)
    .eq("is_mother", true)
    .maybeSingle();
  if (!channel) return { ok: false, error: NO_MOTHER };

  // El trigger de la 0018 la crea con el canal; si alguien borró la fila a mano,
  // la reponemos en vez de dejar la pantalla muerta.
  let { data: row } = await admin
    .from("wa_cloud_credentials")
    .select("*")
    .eq("channel_id", channel.id)
    .maybeSingle();

  if (!row) {
    const { data: created } = await admin
      .from("wa_cloud_credentials")
      .insert({ channel_id: channel.id, agency_id: agency.id })
      .select("*")
      .single();
    row = created;
  }
  if (!row) return { ok: false, error: "No se pudo preparar la conexión con Meta." };

  return {
    ok: true,
    ctx: {
      agencyId: agency.id,
      channelId: channel.id,
      channelStatus: channel.status,
      phone: channel.phone,
      phoneNumberId: channel.phone_number_id,
      row: row as CredentialsRow,
    },
  };
}

function toStatus(ctx: Ctx, checks: CloudCheck[] | null): CloudStatus {
  const row = ctx.row;
  const stored = Array.isArray(row.checks) ? (row.checks as CloudCheck[]) : [];
  return {
    channelId: ctx.channelId,
    hasToken: !!row.token_secret_id,
    hasAppSecret: !!row.app_secret_id,
    hasVerifyToken: !!row.verify_secret_id,
    appId: row.app_id,
    wabaId: row.waba_id,
    phoneNumberId: ctx.phoneNumberId,
    phone: ctx.phone,
    tokenTail: row.token_tail,
    tokenExpiresAt: row.token_expires_at,
    tokenPermanent: !!row.token_secret_id && !row.token_expires_at,
    webhookPath: webhookPathFor(row.webhook_slug),
    wabaName: row.waba_name,
    businessVerificationStatus: row.business_verification_status,
    accountReviewStatus: row.account_review_status,
    webhookSubscribed: row.webhook_subscribed,
    checkedAt: row.checked_at,
    checkOk: row.check_ok,
    checks: checks ?? stored,
    usingEnvFallback: !row.token_secret_id && hasLegacyEnvCreds(ctx.agencyId),
    connected: ctx.channelStatus === "conectado",
  };
}

/** Credenciales frescas del canal (descifradas, para hablar con Meta). */
async function credsOf(ctx: Ctx): Promise<CloudCreds | null> {
  return getCloudCredsByChannel(ctx.channelId);
}

function revalidate() {
  revalidatePath("/config/whatsapp");
  revalidatePath("/crm");
}

/* ═══════════════════════════════════════════════════════════
   Leer el estado (lo que pinta la pantalla)
   ═══════════════════════════════════════════════════════════ */

export async function getCloudStatus(): Promise<ActionResult<CloudStatus>> {
  const loaded = await loadCtx();
  if (!loaded.ok) return fail(loaded.error);
  return succeed(toStatus(loaded.ctx, null));
}

/**
 * El verify token en claro. Solo hace falta si la configuración automática del
 * webhook falla y hay que pegarlo a mano en el panel de Meta, así que se pide
 * aparte y a propósito: no viaja en el render de la página.
 */
export async function revealVerifyToken(): Promise<ActionResult<{ verifyToken: string }>> {
  const loaded = await loadCtx();
  if (!loaded.ok) return fail(loaded.error);

  // Solo el que está en el Vault de ESTA agencia. Si la agencia todavía no cargó
  // nada, las credenciales resueltas pueden venir del fallback del servidor —y
  // ese verify token es de otra agencia, no hay por qué mostrárselo a esta.
  if (!loaded.ctx.row.verify_secret_id) {
    return fail("Todavía no hay verify token. Guardá las credenciales primero.");
  }
  const creds = await credsOf(loaded.ctx);
  if (!creds?.verifyToken) {
    return fail("No se pudo leer el verify token guardado.");
  }
  return succeed({ verifyToken: creds.verifyToken });
}

/* ═══════════════════════════════════════════════════════════
   Paso 1 — guardar las credenciales que el admin pega
   ═══════════════════════════════════════════════════════════ */

const credentialsSchema = z.object({
  appId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, "El App ID de Meta son solo números.")
    .optional(),
  // Los secretos son opcionales al re-guardar: si el campo viene vacío, se deja
  // el que ya estaba (el input arranca vacío justamente porque no se puede leer).
  appSecret: z.string().trim().min(16, "Ese App Secret quedó corto.").max(200).optional(),
  token: z.string().trim().min(40, "Ese token quedó corto. Pegalo completo.").max(1000).optional(),
  wabaId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, "El WABA ID de Meta son solo números.")
    .optional(),
});

export type SaveCredentialsResult = {
  status: CloudStatus;
  /** Los números de la cuenta, para que el admin elija el madre. */
  numbers: CloudPhoneNumber[];
  /** Meta no nos dejó listar los números. Distinto de "no tiene ninguno". */
  numbersError: string | null;
};

/**
 * Guarda lo que el admin pegó y lo valida contra Meta en el momento.
 *
 * PRIMERO SE VALIDA, DESPUÉS SE ESCRIBE. Parece un detalle y es lo más
 * importante de esta función: el Vault no versiona nada, `vault.update_secret`
 * pisa el valor viejo y no hay vuelta atrás. Si se guardara antes de validar,
 * pegar un token con un carácter de menos —o el de otra app— borraría el token
 * que estaba funcionando, y la agencia se quedaría sin recibir ni mandar nada
 * mientras la pantalla sigue diciendo "Conectado". Con un App Secret equivocado
 * es peor todavía: es la llave con la que se valida la firma del webhook, así
 * que también se caen las consultas ENTRANTES.
 *
 * Por eso todo se prueba con los valores CANDIDATOS (lo pegado, o lo guardado
 * si el campo vino vacío) y recién con todo en verde se toca la base.
 *
 * El orden de los chequeos también importa: primero el par App ID + App Secret,
 * que es el más barato y el que invalida todo lo demás; después el token; y al
 * final la cuenta y sus números.
 */
export async function saveCloudCredentials(
  input: z.infer<typeof credentialsSchema>,
): Promise<ActionResult<SaveCredentialsResult>> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Revisá los datos de Meta.");
  }
  const loaded = await loadCtx();
  if (!loaded.ok) return fail(loaded.error);
  const ctx = loaded.ctx;
  const admin = createAdminClient();

  const appId = parsed.data.appId ?? ctx.row.app_id;
  const wabaId = parsed.data.wabaId ?? ctx.row.waba_id;
  if (!appId) return fail("Falta el App ID de Meta.");
  if (!wabaId) return fail("Falta el WABA ID (la cuenta de WhatsApp Business).");

  /* 1. los valores candidatos: lo que pegó el admin, o lo que ya estaba */
  const guardadas = await credsOf(ctx);
  const appSecret = parsed.data.appSecret ?? guardadas?.appSecret ?? null;
  const token = parsed.data.token ?? guardadas?.token ?? null;
  if (!appSecret) return fail("Falta el App Secret de Meta.");
  if (!token) return fail("Falta el token de acceso de Meta.");

  const candidatas: CloudCreds = {
    token,
    appSecret,
    appId,
    wabaId,
    phoneNumberId: ctx.phoneNumberId,
    verifyToken: guardadas?.verifyToken ?? null,
    businessId: ctx.row.business_id,
  };

  /* 2. ¿el App ID y el App Secret son de la misma app y existen? */
  const app = await checkApp(appId, appSecret);
  if (!app.ok) {
    return fail(
      app.code === 190
        ? "El App ID y el App Secret no coinciden. Copialos de Meta for Developers, en Configuración de la app, Básica."
        : app.error,
    );
  }

  /* 3. ¿el token sirve, es permanente y alcanza a ESTA cuenta? */
  const info = await debugToken({ token, appId, appSecret });
  if (!info.ok) return fail(info.error);
  if (!info.data.valid) {
    return fail(
      info.data.error ??
        "Meta rechazó el token. Generá uno nuevo desde Configuración del negocio, Usuarios del sistema.",
    );
  }
  if (info.data.appId && info.data.appId !== appId) {
    return fail(
      `Ese token es de otra app de Meta (${info.data.appName ?? info.data.appId}). Generá el token desde la app ${app.data.name}.`,
    );
  }
  const faltantes = REQUIRED_SCOPES.filter((s) => !info.data.scopes.includes(s));
  if (faltantes.length > 0) {
    return fail(
      `Al token le faltan permisos: ${faltantes.join(" y ")}. Regeneralo tildando los tres permisos de WhatsApp.`,
    );
  }
  // Solo si el token viene con lista de activos y esta cuenta no está en ella.
  if (!info.data.unrestricted && !info.data.wabaTargets.includes(wabaId)) {
    return fail(
      "El token no tiene alcance sobre esa cuenta de WhatsApp. En Usuarios del sistema, agregale la cuenta como activo con control total y regeneralo.",
    );
  }

  /* 4. ¿existe la cuenta y el token la puede leer? */
  const waba = await getWaba(candidatas);
  if (!waba.ok) {
    return fail(
      waba.code === 100
        ? "Ese WABA ID no existe o no pertenece a esta cuenta. Copialo de WhatsApp Manager, arriba a la izquierda."
        : waba.error,
    );
  }

  /* ─── todo validado: recién ahora se escribe ─── */

  if (parsed.data.appSecret) {
    const res = await setCloudSecret(ctx.channelId, "app_secret", parsed.data.appSecret);
    if (!res.ok) return fail(res.error);
  }
  if (parsed.data.token) {
    const res = await setCloudSecret(ctx.channelId, "token", parsed.data.token);
    if (!res.ok) return fail(res.error);
  }
  // El verify token lo inventamos nosotros: es un string que Meta nos devuelve
  // para probar que el webhook es nuestro. Pedírselo al admin sería pedirle que
  // invente algo por nosotros.
  if (!ctx.row.verify_secret_id) {
    const res = await setCloudSecret(ctx.channelId, "verify_token", crypto.randomUUID());
    if (!res.ok) return fail(res.error);
  }

  // Cambiar de app o de cuenta invalida TODO lo que sabíamos: la suscripción del
  // webhook era de la cuenta vieja y el diagnóstico describe algo que ya no
  // existe. Dejarlo como está haría que la pantalla siga diciendo "Conectado"
  // sobre una configuración que Meta no conoce.
  const cambioDeCuenta = appId !== ctx.row.app_id || wabaId !== ctx.row.waba_id;
  const cambioDeToken = !!parsed.data.token || !!parsed.data.appSecret;

  await admin
    .from("wa_cloud_credentials")
    .update({
      app_id: appId,
      waba_id: wabaId,
      token_tail: parsed.data.token ? parsed.data.token.slice(-4) : ctx.row.token_tail,
      token_app_id: info.data.appId,
      token_expires_at: info.data.expiresAt?.toISOString() ?? null,
      token_scopes: info.data.scopes,
      waba_name: waba.data.name,
      business_verification_status: waba.data.businessVerificationStatus,
      account_review_status: waba.data.accountReviewStatus,
      // El diagnóstico guardado es de ANTES de este guardado: aunque no haya
      // cambiado nada, dejarlo puesto haría que la pantalla siga mostrando el
      // error viejo después de una validación que salió bien. Se borra y se
      // vuelve a sacar la foto con "Revisar de nuevo" o al conectar.
      checks: [] as unknown as Json,
      check_ok: null,
      checked_at: null,
      // La suscripción sí sobrevive mientras la cuenta sea la misma: es una
      // configuración que vive del lado de Meta y no la tocó este guardado.
      ...(cambioDeCuenta || cambioDeToken
        ? { webhook_subscribed: false, webhook_callback_url: null }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("channel_id", ctx.channelId);

  if (cambioDeCuenta || cambioDeToken) {
    await admin
      .from("wa_channels")
      .update({
        status: "desconectado",
        last_connected_at: null,
        // Los números son de la cuenta vieja: el de antes no existe en la nueva.
        ...(wabaId !== ctx.row.waba_id ? { phone_number_id: null, phone: null } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", ctx.channelId);
  }

  const numbers = await listPhoneNumbers(candidatas);

  const fresh = await loadCtx();
  const status = fresh.ok ? toStatus(fresh.ctx, null) : toStatus(ctx, null);
  revalidate();
  return succeed({
    status,
    numbers: numbers.ok ? numbers.data : [],
    // "no pudimos preguntar" no es lo mismo que "no tiene ninguno": el cliente
    // muestra el motivo de Meta en vez de afirmar algo falso.
    numbersError: numbers.ok ? null : numbers.error,
  });
}

/* ═══════════════════════════════════════════════════════════
   Paso 2 — elegir cuál de los números de la cuenta es el madre
   ═══════════════════════════════════════════════════════════ */

const selectNumberSchema = z.object({
  phoneNumberId: z.string().trim().regex(/^\d{5,25}$/, "El phone number ID son solo números."),
});

export async function selectCloudNumber(
  input: z.infer<typeof selectNumberSchema>,
): Promise<ActionResult<CloudStatus>> {
  const parsed = selectNumberSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Número inválido.");
  const loaded = await loadCtx();
  if (!loaded.ok) return fail(loaded.error);
  const ctx = loaded.ctx;

  const creds = await credsOf(ctx);
  if (!creds) return fail("Guardá primero las credenciales de Meta.");

  // Traemos el número de Meta para guardar el teléfono real: el admin no tiene
  // que volver a tipear lo que Meta ya sabe.
  const info = await getPhoneNumber({ ...creds, phoneNumberId: parsed.data.phoneNumberId });
  if (!info.ok) return fail(info.error);

  const admin = createAdminClient();
  const cambio = ctx.phoneNumberId !== parsed.data.phoneNumberId;
  const { error } = await admin
    .from("wa_channels")
    .update({
      phone_number_id: parsed.data.phoneNumberId,
      phone: info.data.displayPhoneNumber?.replace(/\D/g, "") || ctx.phone,
      // Un número nuevo es un número sin registrar todavía: heredar el
      // "conectado" del anterior diría que entran consultas cuando no entra nada.
      ...(cambio ? { status: "desconectado" as const, last_connected_at: null } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", ctx.channelId);
  if (error) {
    // 23505 = choca contra el índice único de phone_number_id. Cualquier otro
    // error es otra cosa y mandar a revisar el número sería mandarlo al lugar
    // equivocado.
    return fail(
      error.code === "23505"
        ? "Ese número ya está usado por otra agencia del sistema. Revisá el phone number ID."
        : "No se pudo guardar el número madre. Probá de nuevo.",
    );
  }

  const fresh = await loadCtx();
  revalidate();
  return succeed(fresh.ok ? toStatus(fresh.ctx, null) : toStatus(ctx, null));
}

/* ═══════════════════════════════════════════════════════════
   Paso 3 — conectar: suscribir el webhook y diagnosticar
   ═══════════════════════════════════════════════════════════ */

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
}

/**
 * Le dice a Meta que nos entregue los mensajes de esta cuenta a NUESTRA URL, y
 * después chequea todo de punta a punta.
 *
 * El verify token ya está guardado antes de llegar acá (lo hizo el paso 1), que
 * es justo lo que necesita Meta: apenas recibe el pedido pega un GET al webhook
 * para probar que es nuestro. Con las credenciales en la base ese handshake
 * funciona al toque — con las viejas variables de entorno hacía falta un deploy
 * en el medio.
 */
export async function connectCloud(): Promise<ActionResult<CloudStatus>> {
  const loaded = await loadCtx();
  if (!loaded.ok) return fail(loaded.error);
  const ctx = loaded.ctx;

  const creds = await credsOf(ctx);
  if (!creds) return fail("Guardá primero las credenciales de Meta.");
  if (!creds.verifyToken) return fail("Falta el verify token. Guardá las credenciales de nuevo.");
  if (!ctx.phoneNumberId) return fail("Elegí primero cuál es el número madre.");

  const base = appUrl();
  if (!base) {
    return fail(
      "Falta configurar la dirección pública del sistema (NEXT_PUBLIC_APP_URL). Sin eso Meta no sabe a dónde mandarnos los mensajes.",
    );
  }
  const callbackUrl = `${base}${webhookPathFor(ctx.row.webhook_slug)}`;

  // Dos llamadas y no una: la primera suscribe la app a la cuenta (es el paso
  // sin el cual Meta no entrega NADA) y la segunda le pone nuestra URL. El mismo
  // endpoint hace las dos cosas, pero separarlas deja la suscripción hecha
  // aunque el override falle, y así el diagnóstico puede decir exactamente cuál
  // de los dos pasos quedó a medias. Las dos son idempotentes.
  const alta = await subscribeWaba({ creds });
  if (!alta.ok) return fail(alta.error);

  const sub = await subscribeWaba({ creds, callbackUrl, verifyToken: creds.verifyToken });
  if (!sub.ok) {
    return fail(
      sub.code === 2200
        ? "Meta no pudo verificar el webhook. Revisá que la dirección pública del sistema sea la que está en línea (no localhost) y probá de nuevo."
        : sub.error,
    );
  }

  // Extra, no imprescindible: la suscripción a nivel app es la que trae los
  // avisos de plantilla aprobada y de cuenta restringida. Si Meta la rechaza,
  // los mensajes igual entran por el override de arriba.
  //
  // Pero NO se pisa una configuración que ya exista: la URL de la app es una
  // sola para todas las agencias que compartan esa app de Meta, así que
  // sobrescribirla desde acá le cambiaría el webhook a las demás (o le pisaría
  // al admin lo que configuró a mano en el panel). Solo se escribe si está
  // vacía, o si ya apunta a este mismo sistema.
  if (creds.appId && creds.appSecret) {
    const actual = await getAppSubscription({ appId: creds.appId, appSecret: creds.appSecret });
    const libre =
      !actual.ok || !actual.data.callbackUrl || actual.data.callbackUrl.startsWith(base);
    if (libre) {
      await subscribeAppWebhook({
        appId: creds.appId,
        appSecret: creds.appSecret,
        callbackUrl,
        verifyToken: creds.verifyToken,
      });
    }
  }

  const admin = createAdminClient();
  await admin
    .from("wa_cloud_credentials")
    .update({
      webhook_subscribed: true,
      webhook_callback_url: sub.data.overrideCallbackUri ?? callbackUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("channel_id", ctx.channelId);

  await logActivity({
    agencyId: ctx.agencyId,
    type: "sistema",
    body: "Se conectó la cuenta de Meta del número madre",
  });

  return runCloudDiagnostics();
}

/* ═══════════════════════════════════════════════════════════
   Diagnóstico — el semáforo de la pantalla
   ═══════════════════════════════════════════════════════════ */

const VERIFICACION_NEGOCIO: Record<string, { level: CloudCheck["level"]; detail: string; action: string | null }> = {
  VERIFIED: { level: "ok", detail: "El negocio está verificado.", action: null },
  PENDING: {
    level: "warn",
    detail: "Meta está revisando la verificación del negocio.",
    action: "Suele tardar de unas horas a unos días. Mientras tanto podés mandar hasta 250 conversaciones por día.",
  },
  PENDING_NEED_MORE_INFO: {
    level: "warn",
    detail: "Meta pidió más documentación para verificar el negocio.",
    action: "Entrá al Centro de seguridad del portafolio comercial y cargá lo que te pide.",
  },
  PENDING_SUBMISSION: {
    level: "warn",
    detail: "La verificación del negocio no está empezada.",
    action: "Andá a Configuración del negocio, Centro de seguridad, Verificación del negocio, y cargá los papeles de la agencia.",
  },
  NOT_VERIFIED: {
    level: "warn",
    detail: "El negocio no está verificado.",
    action: "Verificalo en Configuración del negocio, Centro de seguridad. Sin eso el número queda limitado y Meta puede no dejarte registrarlo.",
  },
  FAILED: {
    level: "error",
    detail: "La verificación del negocio fue rechazada.",
    action: "Corregí los datos en el Centro de seguridad y volvé a mandarla.",
  },
  REJECTED: {
    level: "error",
    detail: "La verificación del negocio fue rechazada.",
    action: "Corregí los datos en el Centro de seguridad y volvé a mandarla.",
  },
};

const ESTADO_NUMERO: Record<string, { level: CloudCheck["level"]; detail: string; action: string | null }> = {
  CONNECTED: { level: "ok", detail: "El número está registrado y activo en Meta.", action: null },
  PENDING: {
    level: "warn",
    detail: "El número está verificado pero todavía no registrado.",
    action: "Registralo acá abajo con el PIN de verificación en dos pasos. Hasta que no lo hagas, Meta no te entrega ninguna consulta.",
  },
  DISCONNECTED: {
    level: "error",
    detail: "Meta tiene el número como desconectado.",
    action: "Volvé a registrarlo acá abajo.",
  },
  FLAGGED: {
    level: "error",
    detail: "El número está marcado por baja calidad.",
    action: "Revisá la calidad en WhatsApp Manager: si sigue bajando, Meta puede limitarte los envíos.",
  },
  RESTRICTED: {
    level: "error",
    detail: "El número está restringido por Meta.",
    action: "Entrá a WhatsApp Manager, Descripción general de la cuenta, y mirá el aviso para apelar.",
  },
  BANNED: {
    level: "error",
    detail: "Meta bloqueó el número.",
    action: "Se apela desde WhatsApp Manager, Descripción general de la cuenta.",
  },
  UNVERIFIED: {
    level: "error",
    detail: "Falta verificar la titularidad del número.",
    action: "Verificalo por SMS desde WhatsApp Manager y después registralo acá.",
  },
};

/**
 * Corre todos los chequeos contra Meta y deja la foto guardada, así la pantalla
 * se pinta sin volver a llamar al Graph en cada render.
 */
export async function runCloudDiagnostics(): Promise<ActionResult<CloudStatus>> {
  const loaded = await loadCtx();
  if (!loaded.ok) return fail(loaded.error);
  const ctx = loaded.ctx;
  const admin = createAdminClient();

  const creds = await credsOf(ctx);
  if (!creds) {
    return fail("Todavía no hay credenciales de Meta cargadas.");
  }

  const checks: CloudCheck[] = [];
  const patch: TablesUpdate<"wa_cloud_credentials"> = { checked_at: new Date().toISOString() };

  /* app */
  if (creds.appId && creds.appSecret) {
    const app = await checkApp(creds.appId, creds.appSecret);
    checks.push(
      app.ok
        ? { key: "app", label: "App de Meta", level: "ok", detail: `Conectada a ${app.data.name}.`, action: null }
        : {
            key: "app",
            label: "App de Meta",
            level: "error",
            detail: app.error,
            action: "Revisá el App ID y el App Secret en Meta for Developers, Configuración, Básica.",
          },
    );
  }

  /* token */
  if (creds.appId && creds.appSecret) {
    const token = await debugToken({ token: creds.token, appId: creds.appId, appSecret: creds.appSecret });
    if (!token.ok || !token.data.valid) {
      checks.push({
        key: "token",
        label: "Token de acceso",
        level: "error",
        detail: token.ok ? (token.data.error ?? "Meta rechazó el token.") : token.error,
        action: "Generá uno nuevo en Configuración del negocio, Usuarios del sistema, y pegalo arriba.",
      });
      patch.token_expires_at = null;
    } else {
      const expira = token.data.expiresAt;
      patch.token_expires_at = expira?.toISOString() ?? null;
      patch.token_scopes = token.data.scopes;
      checks.push(
        expira
          ? {
              key: "token",
              label: "Token de acceso",
              level: "warn",
              detail: `El token vence el ${expira.toLocaleDateString("es-AR")}.`,
              action: "Cuando venza deja de entrar todo. Generá uno permanente desde Usuarios del sistema, con vencimiento Nunca.",
            }
          : { key: "token", label: "Token de acceso", level: "ok", detail: "Token permanente, no vence.", action: null },
      );
    }
  }

  /* cuenta */
  const waba = await getWaba(creds);
  if (!waba.ok) {
    checks.push({
      key: "cuenta",
      label: "Cuenta de WhatsApp",
      level: "error",
      detail: waba.error,
      action: "Revisá el WABA ID en WhatsApp Manager.",
    });
  } else {
    patch.waba_name = waba.data.name;
    patch.business_verification_status = waba.data.businessVerificationStatus;
    patch.account_review_status = waba.data.accountReviewStatus;

    // Si Meta bloquea la cuenta, muestra SU motivo y SU solución: son textos
    // que Meta mantiene al día, mejor que cualquier mapeo nuestro.
    if (waba.data.blockers.length > 0) {
      for (const b of waba.data.blockers) {
        checks.push({
          key: "cuenta",
          label: "Cuenta de WhatsApp",
          level: waba.data.canSendMessage === "BLOCKED" ? "error" : "warn",
          detail: b.description,
          action: b.solution,
        });
      }
    } else {
      const v = VERIFICACION_NEGOCIO[waba.data.businessVerificationStatus ?? ""] ?? {
        level: "warn" as const,
        detail: "No pudimos leer el estado de verificación del negocio.",
        action: "Revisalo en Configuración del negocio, Centro de seguridad.",
      };
      checks.push({ key: "cuenta", label: "Cuenta de WhatsApp", ...v });
    }
  }

  /* número */
  if (!ctx.phoneNumberId) {
    checks.push({
      key: "numero",
      label: "Número madre",
      level: "pending",
      detail: "Todavía no elegiste cuál de los números de la cuenta es el madre.",
      action: "Elegilo en la lista de arriba.",
    });
  } else {
    const number = await getPhoneNumber(creds);
    if (!number.ok) {
      checks.push({
        key: "numero",
        label: "Número madre",
        level: "error",
        detail: number.error,
        action: "Revisá que el número siga dado de alta en WhatsApp Manager.",
      });
    } else {
      const e = ESTADO_NUMERO[number.data.status ?? ""] ?? {
        level: "warn" as const,
        detail: `Meta reporta el número como ${number.data.status ?? "desconocido"}.`,
        action: "Revisalo en WhatsApp Manager.",
      };
      checks.push({ key: "numero", label: "Número madre", ...e });

      if (number.data.qualityRating === "RED" || number.data.qualityRating === "YELLOW") {
        checks.push({
          key: "numero",
          label: "Calidad del número",
          level: "warn",
          detail: "Meta bajó la calificación de calidad del número.",
          action: "Suele pasar cuando muchos clientes bloquean o reportan. Cuidá la frecuencia de los envíos.",
        });
      }
    }
  }

  /* webhook */
  const sub = await getWabaSubscription(creds);
  const base = appUrl();
  const esperada = base ? `${base}${webhookPathFor(ctx.row.webhook_slug)}` : null;
  if (!sub.ok) {
    checks.push({
      key: "webhook",
      label: "Webhook",
      level: "error",
      detail: sub.error,
      action: "Tocá Conectar para volver a suscribirlo.",
    });
  } else if (!sub.data.subscribed) {
    patch.webhook_subscribed = false;
    checks.push({
      key: "webhook",
      label: "Webhook",
      level: "error",
      detail: "La app no está suscripta a la cuenta de WhatsApp: Meta no te entrega ningún mensaje.",
      action: "Tocá Conectar acá arriba.",
    });
  } else {
    patch.webhook_subscribed = true;
    patch.webhook_callback_url = sub.data.callbackUrl;

    /* Estar suscripto NO alcanza: hace falta una URL a donde entregar.
       Meta acepta dos lugares —el override de la cuenta y la config de la app—
       y con cualquiera de los dos alcanza, así que si no hay override hay que
       ir a preguntar por la de la app ANTES de decir que está todo bien.

       Este chequeo daba verde cuando `callbackUrl` venía null, tratándolo como
       "no sabemos, asumimos que sí". Era el peor error posible en un
       diagnóstico: la agencia veía "Meta entrega los mensajes al sistema",
       mandaba un mensaje de prueba, no llegaba nada, y no había ni un renglón
       que explicara por qué. Sin URL, no llega nada: eso es un error, no una
       duda. */
    const appUrlConfigurada =
      creds.appId && creds.appSecret
        ? await getAppSubscription({ appId: creds.appId, appSecret: creds.appSecret })
        : null;
    const enElApp = appUrlConfigurada?.ok ? appUrlConfigurada.data.callbackUrl : null;
    const entregaA = sub.data.callbackUrl ?? enElApp;

    if (!entregaA) {
      checks.push({
        key: "webhook",
        label: "Webhook",
        level: "error",
        detail:
          "Meta no tiene ninguna dirección a la que entregarte los mensajes: la cuenta está suscripta, pero sin URL configurada.",
        action: "Tocá Conectar acá arriba: el sistema le carga la suya.",
      });
    } else {
      const apunta = !esperada || entregaA === esperada;
      checks.push(
        apunta
          ? {
              key: "webhook",
              label: "Webhook",
              level: "ok",
              detail: "Meta entrega los mensajes al sistema.",
              action: null,
            }
          : {
              key: "webhook",
              label: "Webhook",
              level: "warn",
              detail: `Meta está entregando los mensajes a ${entregaA}.`,
              action: "No es la dirección de este sistema. Tocá Conectar para corregirla.",
            },
      );
    }
  }

  const hayError = checks.some((c) => c.level === "error");
  const listo = !hayError && checks.some((c) => c.key === "numero" && c.level === "ok");

  patch.check_ok = !hayError;
  // el semáforo se guarda tal cual para que la pantalla se pinte sin volver a
  // llamar al Graph; la columna es jsonb y CloudCheck es plano y serializable
  patch.checks = checks as unknown as Json;
  patch.updated_at = new Date().toISOString();

  await admin.from("wa_cloud_credentials").update(patch).eq("channel_id", ctx.channelId);

  // El estado del canal es lo que mira el resto del sistema (el chat, el envío):
  // solo decimos "conectado" cuando Meta dice que el número está activo.
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

/* ═══════════════════════════════════════════════════════════
   Registrar el número
   ═══════════════════════════════════════════════════════════ */

const registerSchema = z.object({
  pin: z.string().trim().regex(/^\d{6}$/, "El PIN son 6 números, sin letras ni espacios."),
});

/**
 * Registra el número madre en la Cloud API.
 *
 * Meta agrega y verifica el número, pero el registro final va por API: en su
 * panel el botón queda gris y el número se queda "Pendiente" para siempre. El
 * PIN es la verificación en dos pasos y NO se guarda: un PIN en nuestra base es
 * un PIN que se filtra con nuestra base. Un intento por click, sin reintentos:
 * a los 10 Meta bloquea el número 72 horas.
 */
export async function registerMotherNumber(
  input: z.infer<typeof registerSchema>,
): Promise<ActionResult<CloudStatus>> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Revisá el PIN.");
  const loaded = await loadCtx();
  if (!loaded.ok) return fail(loaded.error);
  const ctx = loaded.ctx;

  const creds = await credsOf(ctx);
  if (!creds) return fail("Guardá primero las credenciales de Meta.");
  if (!ctx.phoneNumberId) return fail("Elegí primero cuál es el número madre.");

  const res = await registerCloudNumber(creds, parsed.data.pin);
  if (!res.ok) {
    await createAdminClient()
      .from("wa_channels")
      .update({ last_error: res.error, updated_at: new Date().toISOString() })
      .eq("id", ctx.channelId);
    return fail(res.error);
  }

  await logActivity({
    agencyId: ctx.agencyId,
    type: "sistema",
    body: "Se registró el número madre en la Cloud API de Meta",
  });

  return runCloudDiagnostics();
}

/* ═══════════════════════════════════════════════════════════
   Desconectar
   ═══════════════════════════════════════════════════════════ */

/**
 * Borra las credenciales del Vault y desuscribe la cuenta en Meta.
 * No toca el historial: los chats y los leads quedan como están.
 */
export async function disconnectCloud(): Promise<ActionResult<null>> {
  const loaded = await loadCtx();
  if (!loaded.ok) return fail(loaded.error);
  const ctx = loaded.ctx;

  const creds = await credsOf(ctx);
  // Primero le avisamos a Meta (necesita el token), después borramos.
  if (creds?.wabaId) await unsubscribeWaba(creds);

  const cleared = await clearCloudSecrets(ctx.channelId);
  if (!cleared.ok) return fail(cleared.error);

  const admin = createAdminClient();
  await admin
    .from("wa_cloud_credentials")
    .update({
      app_id: null,
      waba_id: null,
      business_id: null,
      waba_name: null,
      business_verification_status: null,
      account_review_status: null,
      webhook_callback_url: null,
      checked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("channel_id", ctx.channelId);

  await admin
    .from("wa_channels")
    .update({
      status: "desconectado",
      last_connected_at: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", ctx.channelId);

  await logActivity({
    agencyId: ctx.agencyId,
    type: "sistema",
    body: "Se desconectó la cuenta de Meta del número madre",
  });

  revalidate();
  return succeed(null);
}
