/**
 * Cliente de la API de mensajería de Instagram — los DMs de la cuenta de la
 * agencia.
 *
 * SOLO SERVIDOR. Espejo exacto de `lib/wa/cloud.ts`: es SOLO el cliente HTTP,
 * no sabe de Supabase ni de sesiones, recibe las credenciales ya resueltas y
 * devuelve resultados tipados — nunca tira excepciones. Quién resuelve las
 * credenciales: `lib/ig/credentials.ts`.
 *
 * ─────────────────────────────────────────────
 * DOS CAMINOS Y NO SON INTERCAMBIABLES
 *
 * Meta ofrece dos formas de conectar una cuenta profesional, y cambian el host,
 * el id al que se postea y hasta el tipo de id de las personas:
 *
 *   · instagram_login — "Instagram API with Instagram Login". Host
 *     graph.instagram.com, se postea a /{ig_user_id}/messages con el token de
 *     Instagram en el header. NO necesita Página de Facebook. Es el camino
 *     recomendado y el que la agencia puede conectar sola: para SU PROPIA cuenta
 *     alcanza el acceso estándar, sin App Review ni verificación del negocio.
 *
 *   · facebook_login — la cuenta está linkeada a una Página. Host
 *     graph.facebook.com, se postea a /{page_id}/messages con el token de la
 *     Página. Solo tiene sentido si la agencia ya tenía todo armado así.
 *
 * En los dos casos el destinatario es el IGSID (el id de la persona DENTRO de
 * esta cuenta): los ids de un camino no sirven en el otro.
 *
 * ─────────────────────────────────────────────
 * LA VENTANA
 *
 * En Instagram la conversación SIEMPRE la empieza la persona y hay 24 hs para
 * contestar. Fuera de eso no existen las plantillas pagas de WhatsApp: la única
 * vía documentada es el tag HUMAN_AGENT (hasta 7 días desde el último mensaje de
 * la persona), y es un feature que Meta aprueba en App Review — por eso viaja
 * como un flag explícito y no se manda "por las dudas".
 */

/**
 * Versión del Graph API. La doc de mensajería de Instagram está escrita con
 * v25.0 (vigente hasta julio de 2028). Se puede subir sin tocar código.
 */
const GRAPH_VERSION = process.env.IG_GRAPH_VERSION?.trim() || "v25.0";

const IG_HOST = "https://graph.instagram.com";
const FB_HOST = "https://graph.facebook.com";

/** Los dos permisos que Meta exige para leer y contestar DMs con Instagram Login. */
export const IG_REQUIRED_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
] as const;

/**
 * Campos del webhook que pedimos. `messages` es el imprescindible y además trae
 * los ecos (lo que la agencia contesta desde la app de Instagram). El resto
 * suma contexto: botones tocados, avisos de leído, reacciones y el anuncio del
 * que vino la persona.
 */
export const IG_WEBHOOK_FIELDS = [
  "messages",
  "messaging_postbacks",
  "messaging_seen",
  "message_reactions",
  "messaging_referral",
] as const;

/** Instagram corta el texto en 1000 bytes UTF-8 (no caracteres). */
export const IG_TEXT_MAX_BYTES = 1000;

export type IgAuthMode = "instagram_login" | "facebook_login";

/**
 * Credenciales de una agencia. `token` + el id al que se postea alcanzan para
 * mandar; el resto lo usan el asistente de conexión y el webhook.
 */
export type IgCreds = {
  token: string;
  authMode: IgAuthMode;
  /** id de la cuenta profesional (el que Meta manda como entry[].id) */
  igUserId: string | null;
  /** Página de Facebook vinculada — solo en facebook_login */
  pageId: string | null;
  /** App de Meta (Configuración → Básica) */
  appId: string | null;
  appSecret: string | null;
  /** App de Instagram (Instagram → API setup with Instagram login) */
  igAppId: string | null;
  igAppSecret: string | null;
  verifyToken: string | null;
  /** Meta le aprobó el feature Human Agent (contestar hasta 7 días). */
  humanAgentEnabled: boolean;
};

export type GraphResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: number | null; subcode: number | null };

export type IgSendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string; windowClosed: boolean };

type GraphError = {
  message?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
  error_user_title?: string;
};

/* ═══════════════════════════════════════════════════════════
   Errores de Meta, en criollo
   ═══════════════════════════════════════════════════════════ */

/**
 * Los subcódigos que significan "se cerró la ventana". Meta los reparte entre
 * varios códigos principales distintos (10, 200, 551) y hasta tiene uno suelto
 * sin código, así que la detección va por subcódigo.
 */
const WINDOW_SUBCODES = new Set([2534022, 2018278, 1545041]);

function isWindowClosed(code: number | null, subcode: number | null): boolean {
  if (subcode != null && WINDOW_SUBCODES.has(subcode)) return true;
  // 1545041 aparece también como código principal en la tabla de errores del
  // Send API ("Messaging window closed").
  return code === 1545041;
}

/**
 * Traducción de los errores que la agencia va a ver de verdad. Lo que no está
 * acá cae en el texto de Meta, que suele ser más útil que un genérico nuestro.
 */
function humanError(e: GraphError | undefined, status: number): string {
  const code = e?.code ?? null;
  const subcode = e?.error_subcode ?? null;

  if (isWindowClosed(code, subcode)) {
    return "Se cerró la ventana de 24 hs de Instagram. Podés seguir por WhatsApp o esperar a que la persona vuelva a escribir.";
  }
  if (code === 190) {
    return "El token de Instagram venció o dejó de valer. Renovalo en Configuración · Instagram.";
  }
  if (code === 613) {
    return "Instagram está limitando los envíos por volumen. Esperá unos minutos y probá de nuevo.";
  }
  if (subcode === 2534041) {
    return "El dueño de la cuenta desactivó el acceso de la app a los mensajes directos. Volvé a conectarla desde Instagram.";
  }
  if (code === 551) {
    return "Esa persona no está recibiendo mensajes: puede haber bloqueado la cuenta o dado de baja la suya.";
  }
  if (subcode === 2534013) {
    return "La Página de Facebook no está vinculada a la cuenta de Instagram. Revisá la vinculación en Meta.";
  }
  if (code === 36103) {
    return "Meta todavía no habilitó esta cuenta de Instagram para la API.";
  }
  if (code === 10) {
    return "A la app le faltan permisos sobre los mensajes de Instagram. Revisá el diagnóstico en Configuración · Instagram.";
  }
  return e?.error_user_msg ?? e?.message ?? `Instagram respondió ${status}.`;
}

/** El id se interpola en una URL que sale con el token: no puede traer basura. */
function isMetaId(value: string | null | undefined): value is string {
  return !!value && /^\d{5,25}$/.test(value);
}

/* ═══════════════════════════════════════════════════════════
   El fetch
   ═══════════════════════════════════════════════════════════ */

function hostFor(mode: IgAuthMode): string {
  return mode === "facebook_login" ? FB_HOST : IG_HOST;
}

async function graph<T>(
  path: string,
  init: {
    host: string;
    method?: "GET" | "POST" | "DELETE";
    token: string;
    /** Sin versión en el path: los endpoints de OAuth de Instagram no la llevan. */
    unversioned?: boolean;
    query?: Record<string, string | undefined>;
    body?: unknown;
  },
): Promise<GraphResult<T>> {
  const base = init.unversioned ? init.host : `${init.host}/${GRAPH_VERSION}`;
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${init.token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      // Sin corte, un request colgado se lleva puesto el render del Server
      // Component o la corrida del webhook.
      signal: AbortSignal.timeout(15_000),
    });

    const payload = (await res.json().catch(() => null)) as
      | (T & { error?: GraphError })
      | null;

    if (!res.ok || payload?.error) {
      return {
        ok: false,
        error: humanError(payload?.error, res.status),
        code: payload?.error?.code ?? res.status,
        subcode: payload?.error?.error_subcode ?? null,
      };
    }
    return { ok: true, data: (payload ?? {}) as T };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "TimeoutError";
    return {
      ok: false,
      error: aborted
        ? "Instagram tardó demasiado en responder. Probá de nuevo en un minuto."
        : "No se pudo conectar con Instagram.",
      code: null,
      subcode: null,
    };
  }
}

/* ═══════════════════════════════════════════════════════════
   ENVÍO
   ═══════════════════════════════════════════════════════════ */

type SendResponse = { recipient_id?: string; message_id?: string };

/**
 * A qué id se le postea el mensaje. No es un detalle: con Instagram Login es la
 * cuenta de Instagram y con Facebook Login es la PÁGINA. Postearle al id
 * equivocado devuelve un error que no se entiende ("Invalid FBID").
 */
function sendTarget(creds: IgCreds): string | null {
  const id = creds.authMode === "facebook_login" ? creds.pageId : creds.igUserId;
  return isMetaId(id) ? id : null;
}

/** Quick reply: los botones que aparecen abajo del mensaje. */
export type IgQuickReply =
  | { kind: "texto"; title: string; payload: string }
  /**
   * Instagram le ofrece a la persona su propio teléfono (o su mail) sacado de su
   * perfil, y con un toque nos lo manda. Es la forma más corta que existe de
   * pasar de un DM a un WhatsApp: no hay que tipear nada.
   */
  | { kind: "telefono" }
  | { kind: "email" };

function quickReplyPayload(qr: IgQuickReply) {
  if (qr.kind === "telefono") return { content_type: "user_phone_number" };
  if (qr.kind === "email") return { content_type: "user_email" };
  // Instagram trunca los títulos a los 20 caracteres.
  return { content_type: "text", title: qr.title.slice(0, 20), payload: qr.payload };
}

/** Corta el texto a los 1000 BYTES que acepta Instagram, sin partir un emoji. */
export function clampIgText(text: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= IG_TEXT_MAX_BYTES) return text;
  // Se recorta por code points (no por bytes) para no dejar un carácter partido
  // a la mitad, que Instagram rechaza con un 100 sin explicación.
  const chars = [...text];
  let out = "";
  for (const ch of chars) {
    if (encoder.encode(out + ch).length > IG_TEXT_MAX_BYTES - 1) break;
    out += ch;
  }
  return `${out}…`;
}

async function send(creds: IgCreds, body: Record<string, unknown>): Promise<IgSendResult> {
  if (!creds.token) return { ok: false, error: "Falta el token de Instagram.", windowClosed: false };
  const target = sendTarget(creds);
  if (!target) {
    return {
      ok: false,
      error:
        creds.authMode === "facebook_login"
          ? "Falta el ID de la Página de Facebook vinculada."
          : "Falta el ID de la cuenta de Instagram.",
      windowClosed: false,
    };
  }

  const res = await graph<SendResponse>(`/${target}/messages`, {
    host: hostFor(creds.authMode),
    method: "POST",
    token: creds.token,
    body,
  });
  if (!res.ok) {
    return { ok: false, error: res.error, windowClosed: isWindowClosed(res.code, res.subcode) };
  }
  return { ok: true, messageId: res.data.message_id ?? null };
}

/**
 * Texto libre a una persona.
 *
 * `humanAgent` solo se manda cuando la agencia tiene el feature aprobado: es lo
 * que permite contestar entre las 24 hs y los 7 días. Dentro de la ventana NO se
 * manda `messaging_type`: los ejemplos oficiales de Instagram Login lo omiten y
 * mandar un parámetro de más contra ese host es pedir un 100 sin motivo.
 */
export function sendIgText(
  creds: IgCreds,
  to: string,
  text: string,
  opts?: { quickReplies?: IgQuickReply[]; humanAgent?: boolean },
): Promise<IgSendResult> {
  const message: Record<string, unknown> = { text: clampIgText(text) };
  const quickReplies = opts?.quickReplies ?? [];
  if (quickReplies.length > 0) {
    // Instagram acepta hasta 13.
    message.quick_replies = quickReplies.slice(0, 13).map(quickReplyPayload);
  }

  return send(creds, {
    recipient: { id: to },
    message,
    ...(opts?.humanAgent ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : {}),
  });
}

/**
 * Marca el DM como leído y muestra los puntitos de "escribiendo".
 *
 * Best-effort a propósito: es cortesía, no funcionalidad. La página de Sender
 * Actions de Meta está escrita contra el host de Facebook incluso dentro de la
 * sección de Instagram Login, así que puede fallar en el host de Instagram. Si
 * falla, el mensaje se manda igual y nadie se entera.
 */
export async function markIgSeenAndTyping(creds: IgCreds, to: string): Promise<void> {
  const target = sendTarget(creds);
  if (!creds.token || !target) return;
  const host = hostFor(creds.authMode);
  await Promise.all(
    ["mark_seen", "typing_on"].map((action) =>
      graph(`/${target}/messages`, {
        host,
        method: "POST",
        token: creds.token,
        body: { recipient: { id: to }, sender_action: action },
      }).catch(() => null),
    ),
  );
}

/* ═══════════════════════════════════════════════════════════
   LA CUENTA Y LAS PERSONAS
   ═══════════════════════════════════════════════════════════ */

export type IgAccount = {
  /** el que Meta manda como entry[].id en el webhook */
  userId: string | null;
  username: string | null;
  name: string | null;
  accountType: string | null;
  profilePictureUrl: string | null;
  followersCount: number | null;
};

type MeResponse = {
  id?: string;
  user_id?: string;
  username?: string;
  name?: string;
  account_type?: string;
  profile_picture_url?: string;
  followers_count?: number;
};

/**
 * La cuenta conectada. Es además el chequeo más barato de que el token sirve:
 * si esto responde, el token vale y tiene el permiso básico.
 *
 * Ojo con `id` vs `user_id`: son campos distintos y el que aparece en los
 * webhooks —el que hay que guardar para resolver el tenant— es `user_id`.
 */
export async function getIgAccount(creds: IgCreds): Promise<GraphResult<IgAccount>> {
  const res = await graph<MeResponse>("/me", {
    host: hostFor(creds.authMode),
    token: creds.token,
    query: {
      fields: "id,user_id,username,name,account_type,profile_picture_url,followers_count",
    },
  });
  if (!res.ok) return res;
  const d = res.data;
  return {
    ok: true,
    data: {
      userId: d.user_id ?? d.id ?? null,
      username: d.username ?? null,
      name: d.name ?? null,
      accountType: d.account_type ?? null,
      profilePictureUrl: d.profile_picture_url ?? null,
      followersCount: typeof d.followers_count === "number" ? d.followers_count : null,
    },
  };
}

export type IgUserProfile = {
  name: string | null;
  username: string | null;
  /** URL firmada de Meta: vence a los pocos días, no sirve para guardar. */
  profilePic: string | null;
  followerCount: number | null;
  /** ¿nos sigue? */
  followsUs: boolean | null;
  /** ¿la seguimos? */
  weFollow: boolean | null;
  verified: boolean | null;
};

type ProfileResponse = {
  name?: string;
  username?: string;
  profile_pic?: string;
  follower_count?: number;
  is_user_follow_business?: boolean;
  is_business_follow_user?: boolean;
  is_verified_user?: boolean;
};

/**
 * El perfil de quien nos escribió, por su IGSID.
 *
 * Es lo que convierte un id numérico en una persona con nombre y arroba en el
 * CRM. Meta lo permite solo con consentimiento, y el consentimiento es
 * justamente habernos escrito — así que se pide al recibir el primer mensaje.
 * Si la persona bloqueó la cuenta, esto falla y el contacto se queda con el
 * nombre que haya: no es motivo para perder el mensaje.
 */
export async function getIgUserProfile(
  creds: IgCreds,
  igsid: string,
): Promise<GraphResult<IgUserProfile>> {
  if (!isMetaId(igsid)) {
    return { ok: false, error: "IGSID inválido.", code: null, subcode: null };
  }
  const res = await graph<ProfileResponse>(`/${igsid}`, {
    host: hostFor(creds.authMode),
    token: creds.token,
    query: {
      fields:
        "name,username,profile_pic,follower_count,is_user_follow_business,is_business_follow_user,is_verified_user",
    },
  });
  if (!res.ok) return res;
  const d = res.data;
  return {
    ok: true,
    data: {
      name: d.name ?? null,
      username: d.username ?? null,
      profilePic: d.profile_pic ?? null,
      followerCount: typeof d.follower_count === "number" ? d.follower_count : null,
      followsUs: d.is_user_follow_business ?? null,
      weFollow: d.is_business_follow_user ?? null,
      verified: d.is_verified_user ?? null,
    },
  };
}

/* ═══════════════════════════════════════════════════════════
   WEBHOOK
   ═══════════════════════════════════════════════════════════ */

/**
 * Le dice a Meta que nos entregue los eventos de ESTA cuenta.
 *
 * OJO — esto NO configura a dónde los manda. A diferencia de WhatsApp, Instagram
 * no acepta una callback URL por cuenta (`override_callback_uri` es exclusivo de
 * WhatsApp) y lo dice explícito: "Account level webhooks customization is not
 * supported". La URL y el verify token se cargan a mano UNA VEZ en el panel de
 * Meta de la app, y por eso la pantalla de configuración los muestra grandes con
 * botón de copiar en vez de esconderlos.
 */
export async function subscribeIgWebhook(creds: IgCreds): Promise<GraphResult<{ success: boolean }>> {
  const target = sendTarget(creds);
  if (!target) {
    return { ok: false, error: "Falta el ID de la cuenta de Instagram.", code: null, subcode: null };
  }
  return graph<{ success: boolean }>(`/${target}/subscribed_apps`, {
    host: hostFor(creds.authMode),
    method: "POST",
    token: creds.token,
    query: { subscribed_fields: IG_WEBHOOK_FIELDS.join(",") },
  });
}

export type IgSubscription = { subscribed: boolean; fields: string[] };

type SubscribedAppsResponse = {
  data?: { subscribed_fields?: string[]; id?: string; name?: string }[];
};

export async function getIgSubscription(creds: IgCreds): Promise<GraphResult<IgSubscription>> {
  const target = sendTarget(creds);
  if (!target) {
    return { ok: false, error: "Falta el ID de la cuenta de Instagram.", code: null, subcode: null };
  }
  const res = await graph<SubscribedAppsResponse>(`/${target}/subscribed_apps`, {
    host: hostFor(creds.authMode),
    token: creds.token,
  });
  if (!res.ok) return res;
  const entry = res.data.data?.[0];
  return {
    ok: true,
    data: { subscribed: !!entry, fields: entry?.subscribed_fields ?? [] },
  };
}

export async function unsubscribeIgWebhook(creds: IgCreds): Promise<GraphResult<{ success: boolean }>> {
  const target = sendTarget(creds);
  if (!target) {
    return { ok: false, error: "Falta el ID de la cuenta de Instagram.", code: null, subcode: null };
  }
  return graph<{ success: boolean }>(`/${target}/subscribed_apps`, {
    host: hostFor(creds.authMode),
    method: "DELETE",
    token: creds.token,
  });
}

/* ═══════════════════════════════════════════════════════════
   TOKENS
   ═══════════════════════════════════════════════════════════

   El token de Instagram VENCE A LOS 60 DÍAS. No hay token permanente como el
   del usuario del sistema de WhatsApp: si nadie lo renueva, un día la agencia
   deja de recibir DMs sin que nada haya cambiado. Por eso el sistema lo renueva
   solo (cron + al abrir la pantalla) y la pantalla muestra cuánto le queda.
   ═══════════════════════════════════════════════════════════ */

export type IgToken = { token: string; expiresAt: Date | null };

type TokenResponse = { access_token?: string; token_type?: string; expires_in?: number };

function toToken(data: TokenResponse): IgToken | null {
  if (!data.access_token) return null;
  return {
    token: data.access_token,
    expiresAt:
      typeof data.expires_in === "number"
        ? new Date(Date.now() + data.expires_in * 1000)
        : null,
  };
}

/**
 * Cambia un token corto (1 hora) por uno largo (60 días).
 *
 * El token que Meta muestra en el panel ya viene largo, así que esto falla con
 * "already long-lived" en el caso normal: se intenta igual porque el que sale
 * del login sí es corto, y un token de una hora guardado como si fuera bueno es
 * una agencia que deja de recibir mensajes al mediodía sin explicación.
 */
export async function exchangeIgLongLived(
  igAppSecret: string,
  shortToken: string,
): Promise<GraphResult<IgToken>> {
  const res = await graph<TokenResponse>("/access_token", {
    host: IG_HOST,
    unversioned: true,
    token: shortToken,
    query: { grant_type: "ig_exchange_token", client_secret: igAppSecret },
  });
  if (!res.ok) return res;
  const token = toToken(res.data);
  if (!token) {
    return { ok: false, error: "Meta no devolvió un token nuevo.", code: null, subcode: null };
  }
  return { ok: true, data: token };
}

/**
 * Renueva el token largo por otros 60 días.
 * Meta exige que el token tenga al menos 24 hs de vida y que no esté vencido:
 * renovarlo el mismo día que se cargó devuelve error, y está bien.
 */
export async function refreshIgToken(token: string): Promise<GraphResult<IgToken>> {
  const res = await graph<TokenResponse>("/refresh_access_token", {
    host: IG_HOST,
    unversioned: true,
    token,
    query: { grant_type: "ig_refresh_token" },
  });
  if (!res.ok) return res;
  const fresh = toToken(res.data);
  if (!fresh) {
    return { ok: false, error: "Meta no devolvió un token nuevo.", code: null, subcode: null };
  }
  return { ok: true, data: fresh };
}
