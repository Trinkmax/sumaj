/**
 * Cliente de la WhatsApp Cloud API de Meta — el NÚMERO MADRE.
 *
 * SOLO SERVIDOR. Por acá entran todas las consultas nuevas y sale la respuesta
 * automática que le avisa al cliente que un operador lo va a contactar.
 * El seguimiento NO sale por acá (fuera de las 24 hs habría que pagar
 * plantillas): eso va por el número de la sucursal con Baileys.
 *
 * Este módulo es SOLO el cliente HTTP: no sabe de Supabase ni de sesiones.
 * Recibe las credenciales ya resueltas y devuelve resultados tipados, nunca
 * excepciones. Quién las resuelve: `lib/wa/cloud-credentials.ts`.
 */

/**
 * Versión del Graph API. v21 (la que había hardcodeada) expira en enero de 2027;
 * v25 es la que usan hoy los ejemplos oficiales y vence en julio de 2028.
 * Se puede subir sin tocar código con WA_GRAPH_VERSION.
 */
const GRAPH_VERSION = process.env.WA_GRAPH_VERSION?.trim() || "v25.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Los tres permisos que Meta exige para que todo esto funcione. */
export const REQUIRED_SCOPES = [
  "whatsapp_business_management",
  "whatsapp_business_messaging",
] as const;

/**
 * Campos del webhook que pedimos. `messages` es el único imprescindible (es el
 * que trae las consultas); el resto avisa de plantillas aprobadas y de líos con
 * la cuenta, y solo llega si la suscripción se pudo hacer a nivel app.
 */
export const WEBHOOK_FIELDS = [
  "messages",
  "message_template_status_update",
  "account_update",
  "account_alerts",
  "phone_number_quality_update",
] as const;

/**
 * Credenciales de una agencia. `token` y `phoneNumberId` alcanzan para mandar;
 * el resto lo usa el asistente de conexión y el diagnóstico.
 */
export type CloudCreds = {
  token: string;
  phoneNumberId: string | null;
  appId: string | null;
  appSecret: string | null;
  verifyToken: string | null;
  wabaId: string | null;
  businessId: string | null;
};

export type GraphResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: number | null };

type GraphError = {
  message?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
  error_data?: { details?: string };
};

/**
 * El texto accionable de Meta no siempre está en el mismo lugar: en los errores
 * de registro y de mensajería viaja en `error_data.details` y `message` es el
 * genérico con el código. Por eso el orden.
 */
function graphError(payload: { error?: GraphError } | null, status: number): string {
  const e = payload?.error;
  return (
    e?.error_data?.details ??
    e?.error_user_msg ??
    e?.message ??
    `Meta respondió ${status}.`
  );
}

/** El ID se interpola en una URL que sale con el token: no puede traer basura. */
function isMetaId(value: string | null | undefined): value is string {
  return !!value && /^\d{5,25}$/.test(value);
}

/** App access token: es literalmente "{APP_ID}|{APP_SECRET}". */
function appAccessToken(appId: string, appSecret: string): string {
  return `${appId}|${appSecret}`;
}

async function graph<T>(
  path: string,
  init: {
    method?: "GET" | "POST" | "DELETE";
    token: string;
    query?: Record<string, string | undefined>;
    body?: unknown;
  },
): Promise<GraphResult<T>> {
  const url = new URL(`${GRAPH}${path}`);
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
      // Meta a veces se toma su tiempo; sin corte, un request colgado se lleva
      // puesto el render del Server Component o la corrida del cron.
      signal: AbortSignal.timeout(15_000),
    });

    const payload = (await res.json().catch(() => null)) as
      | (T & { error?: GraphError })
      | null;

    if (!res.ok || payload?.error) {
      return {
        ok: false,
        error: graphError(payload, res.status),
        code: payload?.error?.code ?? res.status,
      };
    }
    return { ok: true, data: (payload ?? {}) as T };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "TimeoutError";
    return {
      ok: false,
      error: aborted
        ? "Meta tardó demasiado en responder. Probá de nuevo en un minuto."
        : "No se pudo conectar con la Cloud API de Meta.",
      code: null,
    };
  }
}

/* ═══════════════════════════════════════════════════════════
   ENVÍO DE MENSAJES
   ═══════════════════════════════════════════════════════════ */

export type CloudResult = { ok: true; waMessageId: string | null } | { ok: false; error: string };

type SendResponse = { messages?: { id: string }[] };

async function send(creds: CloudCreds, payload: unknown): Promise<CloudResult> {
  if (!creds.token) return { ok: false, error: "Falta el token de la Cloud API." };
  if (!isMetaId(creds.phoneNumberId)) {
    return { ok: false, error: "El número madre no tiene un phone number ID válido." };
  }

  const res = await graph<SendResponse>(`/${creds.phoneNumberId}/messages`, {
    method: "POST",
    token: creds.token,
    body: payload,
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, waMessageId: res.data.messages?.[0]?.id ?? null };
}

/** Texto libre — solo válido dentro de la ventana de 24 hs. */
export function sendCloudText(creds: CloudCreds, to: string, body: string): Promise<CloudResult> {
  return send(creds, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to.replace(/\D/g, ""),
    type: "text",
    text: { preview_url: true, body },
  });
}

/** Plantilla aprobada — la única vía fuera de la ventana de 24 hs. */
export function sendCloudTemplate(
  creds: CloudCreds,
  to: string,
  templateName: string,
  language = "es_AR",
): Promise<CloudResult> {
  return send(creds, {
    messaging_product: "whatsapp",
    to: to.replace(/\D/g, ""),
    type: "template",
    template: { name: templateName, language: { code: language } },
  });
}

/** Un botón de respuesta rápida de la plantilla, con el dato que queremos que vuelva. */
export type CloudTemplateButton = {
  /** posición del botón en la plantilla (la que Meta usa para identificarlo) */
  index: number;
  /** lo que Meta nos devuelve en el webhook cuando lo tocan */
  payload: string;
};

/**
 * Meta rechaza (132000) los parámetros con saltos de línea, tabulaciones o más
 * de cuatro espacios seguidos. Un nombre pegado de una planilla trae cualquiera
 * de las tres y tira abajo el envío entero, así que se limpian acá y no en cada
 * caller.
 */
function templateParam(value: string): string {
  return value
    .replace(/[\n\r\t]+/g, " ")
    .replace(/ {5,}/g, "    ")
    .trim()
    .slice(0, 1024);
}

/**
 * Plantilla aprobada CON contenido: variables del cuerpo y botones de respuesta
 * rápida con payload propio. Es la que usan las difusiones.
 *
 * Dos cosas que no son obvias:
 *   · Las variables van por NOMBRE (`parameter_name`), que es como las declara
 *     la plantilla al crearse ({{nombre}}) y como las escribe `fillTemplate`.
 *     Con nombres el orden deja de importar, pero la cantidad sigue importando:
 *     una variable de más o de menos es un rechazo.
 *   · Cada botón viaja en su PROPIO componente con su índice. El payload es lo
 *     que hace que un toque se pueda atribuir a la difusión y a la persona: sin
 *     mandarlo, Meta devuelve el texto del botón y dos difusiones con el mismo
 *     botón se vuelven indistinguibles.
 */
export function sendCloudTemplateMessage(
  creds: CloudCreds,
  to: string,
  input: {
    name: string;
    language: string;
    bodyParams: Record<string, string>;
    buttons: CloudTemplateButton[];
  },
): Promise<CloudResult> {
  const components: unknown[] = [];

  const parameters = Object.entries(input.bodyParams).map(([name, value]) => ({
    type: "text",
    parameter_name: name,
    text: templateParam(value),
  }));
  if (parameters.length > 0) components.push({ type: "body", parameters });

  for (const button of input.buttons) {
    components.push({
      type: "button",
      sub_type: "quick_reply",
      // Meta lo quiere como string, aunque sea un número.
      index: String(button.index),
      parameters: [{ type: "payload", payload: button.payload }],
    });
  }

  return send(creds, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to.replace(/\D/g, ""),
    type: "template",
    template: {
      name: input.name,
      language: { code: input.language },
      // Una plantilla sin variables ni botones no lleva `components`: mandarlo
      // vacío es un 100.
      ...(components.length > 0 ? { components } : {}),
    },
  });
}

/* ═══════════════════════════════════════════════════════════
   VALIDACIÓN DE CREDENCIALES
   ═══════════════════════════════════════════════════════════ */

export type MetaApp = { id: string; name: string };

/**
 * El chequeo más barato de todos: ¿existe esa app y el App Secret es el suyo?
 * Si esto da 190, el par App ID + App Secret está mal y no tiene sentido seguir.
 */
export async function checkApp(appId: string, appSecret: string): Promise<GraphResult<MetaApp>> {
  if (!isMetaId(appId)) {
    return { ok: false, error: "El App ID de Meta son solo números.", code: null };
  }
  return graph<MetaApp>(`/${appId}`, {
    token: appAccessToken(appId, appSecret),
    query: { fields: "id,name" },
  });
}

export type TokenInfo = {
  valid: boolean;
  /** app dueña del token — si no coincide con la que cargó el admin, es de otra app */
  appId: string | null;
  appName: string | null;
  /** null = permanente (System User). Es el token que queremos. */
  expiresAt: Date | null;
  scopes: string[];
  /**
   * WABA IDs sobre los que los permisos de WhatsApp tienen alcance real.
   * Solo de los scopes de WhatsApp: `business_management` apunta al ID del
   * portafolio comercial, que no es una WABA, y mezclarlo hacía rechazar tokens
   * buenos.
   */
  wabaTargets: string[];
  /**
   * El token tiene los permisos de WhatsApp SIN lista de activos, o sea alcance
   * sobre todo. Cuando es true no hay nada que comparar contra el WABA ID.
   */
  unrestricted: boolean;
  error: string | null;
};

type DebugTokenResponse = {
  data?: {
    app_id?: string;
    application?: string;
    is_valid?: boolean;
    expires_at?: number;
    issued_at?: number;
    scopes?: string[];
    granular_scopes?: { scope?: string; target_ids?: (string | number)[] }[];
    error?: { message?: string };
  };
};

/**
 * Radiografía del access token: de qué app es, cuándo vence, qué permisos tiene
 * y —lo más importante— sobre qué WABA tiene alcance.
 *
 * No alcanza con que `scopes` liste los permisos: si el WABA que cargó el admin
 * no está en los `target_ids`, el System User no la tiene asignada como activo y
 * todo va a fallar con un error de permisos aunque el token parezca correcto.
 * Ese chequeo es el que evita casi todos los "no me anda y no sé por qué".
 */
export async function debugToken(input: {
  token: string;
  appId: string;
  appSecret: string;
}): Promise<GraphResult<TokenInfo>> {
  const res = await graph<DebugTokenResponse>("/debug_token", {
    token: appAccessToken(input.appId, input.appSecret),
    query: { input_token: input.token },
  });
  if (!res.ok) return res;

  const d = res.data.data ?? {};

  // Solo los granular_scopes de WhatsApp: los target_ids de `business_management`
  // son IDs de portafolio comercial, no WABAs, y meterlos en la misma bolsa
  // hacía que un token con permisos de WhatsApp sin restricción de activos
  // pareciera "sin alcance" sobre la cuenta y se rechazara sin motivo.
  const wa = (d.granular_scopes ?? []).filter((g) =>
    REQUIRED_SCOPES.includes((g.scope ?? "") as (typeof REQUIRED_SCOPES)[number]),
  );
  const targets = new Set<string>();
  for (const g of wa) {
    for (const id of g.target_ids ?? []) targets.add(String(id));
  }
  // Un permiso de WhatsApp presente pero sin target_ids significa "sobre todo".
  // Si no vino ningún granular_scope de WhatsApp, tampoco hay nada que comparar.
  const unrestricted = wa.length === 0 || wa.some((g) => (g.target_ids ?? []).length === 0);

  return {
    ok: true,
    data: {
      valid: d.is_valid === true,
      appId: d.app_id ? String(d.app_id) : null,
      appName: d.application ?? null,
      // expires_at 0 (o ausente) = no vence: es el permanente de System User
      expiresAt: d.expires_at ? new Date(d.expires_at * 1000) : null,
      scopes: d.scopes ?? [],
      wabaTargets: [...targets],
      unrestricted,
      error: d.error?.message ?? null,
    },
  };
}

/* ═══════════════════════════════════════════════════════════
   CUENTA DE WHATSAPP (WABA) Y NÚMEROS
   ═══════════════════════════════════════════════════════════ */

export type WabaInfo = {
  id: string;
  name: string | null;
  /** VERIFIED | PENDING | PENDING_SUBMISSION | NOT_VERIFIED | REJECTED | … */
  businessVerificationStatus: string | null;
  /** APPROVED | PENDING | DEFERRED | REJECTED */
  accountReviewStatus: string | null;
  country: string | null;
  /** Motivos por los que Meta bloquea o limita la cuenta, en su propio texto. */
  blockers: { entity: string; description: string; solution: string | null }[];
  canSendMessage: string | null;
};

type WabaResponse = {
  id?: string;
  name?: string;
  country?: string;
  business_verification_status?: string;
  account_review_status?: string;
  health_status?: {
    can_send_message?: string;
    entities?: {
      entity_type?: string;
      can_send_message?: string;
      errors?: { error_description?: string; possible_solution?: string }[];
    }[];
  };
};

/**
 * Estado de la cuenta de WhatsApp Business. `health_status` es la joya: cuando
 * algo bloquea la cuenta, Meta devuelve el motivo y la solución ya redactados
 * —los mostramos tal cual en vez de inventar un mapeo nuestro que envejezca.
 */
export async function getWaba(creds: CloudCreds): Promise<GraphResult<WabaInfo>> {
  if (!isMetaId(creds.wabaId)) {
    return { ok: false, error: "El WABA ID de Meta son solo números.", code: null };
  }
  const res = await graph<WabaResponse>(`/${creds.wabaId}`, {
    token: creds.token,
    query: {
      fields:
        "id,name,country,business_verification_status,account_review_status,health_status",
    },
  });
  if (!res.ok) return res;

  const d = res.data;
  const blockers: WabaInfo["blockers"] = [];
  for (const entity of d.health_status?.entities ?? []) {
    for (const err of entity.errors ?? []) {
      if (!err.error_description) continue;
      blockers.push({
        entity: entity.entity_type ?? "CUENTA",
        description: err.error_description,
        solution: err.possible_solution ?? null,
      });
    }
  }

  return {
    ok: true,
    data: {
      id: d.id ?? creds.wabaId,
      name: d.name ?? null,
      // el enum está documentado en MAYÚSCULA pero Meta a veces contesta en
      // minúscula ("verified"): normalizamos o el chequeo falla en silencio
      businessVerificationStatus: d.business_verification_status?.toUpperCase() ?? null,
      accountReviewStatus: d.account_review_status?.toUpperCase() ?? null,
      country: d.country ?? null,
      blockers,
      canSendMessage: d.health_status?.can_send_message?.toUpperCase() ?? null,
    },
  };
}

export type CloudPhoneNumber = {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  /** CONNECTED = listo · PENDING = falta registrarlo · el resto son líos */
  status: string | null;
  qualityRating: string | null;
  codeVerificationStatus: string | null;
  nameStatus: string | null;
  platformType: string | null;
};

type PhoneNumberResponse = {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  status?: string;
  quality_rating?: string;
  code_verification_status?: string;
  name_status?: string;
  platform_type?: string;
};

const PHONE_FIELDS =
  "id,display_phone_number,verified_name,status,quality_rating,code_verification_status,name_status,platform_type";

function toPhoneNumber(d: PhoneNumberResponse): CloudPhoneNumber {
  return {
    id: d.id ?? "",
    displayPhoneNumber: d.display_phone_number ?? null,
    verifiedName: d.verified_name ?? null,
    status: d.status?.toUpperCase() ?? null,
    qualityRating: d.quality_rating?.toUpperCase() ?? null,
    codeVerificationStatus: d.code_verification_status?.toUpperCase() ?? null,
    nameStatus: d.name_status?.toUpperCase() ?? null,
    platformType: d.platform_type?.toUpperCase() ?? null,
  };
}

/** Los números de la WABA: el admin elige de una lista en vez de tipear el ID. */
export async function listPhoneNumbers(
  creds: CloudCreds,
): Promise<GraphResult<CloudPhoneNumber[]>> {
  if (!isMetaId(creds.wabaId)) {
    return { ok: false, error: "El WABA ID de Meta son solo números.", code: null };
  }
  const res = await graph<{ data?: PhoneNumberResponse[] }>(`/${creds.wabaId}/phone_numbers`, {
    token: creds.token,
    query: { fields: PHONE_FIELDS, limit: "50" },
  });
  if (!res.ok) return res;
  return { ok: true, data: (res.data.data ?? []).map(toPhoneNumber) };
}

/** Estado del número madre, para el diagnóstico. */
export async function getPhoneNumber(creds: CloudCreds): Promise<GraphResult<CloudPhoneNumber>> {
  if (!isMetaId(creds.phoneNumberId)) {
    return { ok: false, error: "El phone number ID de Meta son solo números.", code: null };
  }
  const res = await graph<PhoneNumberResponse>(`/${creds.phoneNumberId}`, {
    token: creds.token,
    query: { fields: PHONE_FIELDS },
  });
  if (!res.ok) return res;
  return { ok: true, data: toPhoneNumber(res.data) };
}

/* ═══════════════════════════════════════════════════════════
   WEBHOOK
   ═══════════════════════════════════════════════════════════ */

/**
 * Suscribe la app a la cuenta de WhatsApp Y le dice a Meta a qué URL entregar
 * los mensajes de ESTA agencia (`override_callback_uri`).
 *
 * Es el paso sin el cual Meta no entrega una sola consulta, por más que el
 * número esté registrado y el webhook cargado en el panel. Y el override es lo
 * que hace posible el multi-tenant: cada agencia apunta su WABA a su propia URL
 * con su propio verify token, sin tocar la configuración de la app.
 *
 * OJO: Meta pega el GET de verificación a esa URL EN ESTE MOMENTO. Por eso las
 * credenciales se guardan ANTES de llamar acá — si el verify token todavía no
 * está en la base, el handshake falla y Meta rechaza todo con el error 2200.
 */
export async function subscribeWaba(input: {
  creds: CloudCreds;
  /** Sin URL: solo suscribe la app a la cuenta (el paso imprescindible). */
  callbackUrl?: string;
  verifyToken?: string;
}): Promise<GraphResult<{ overrideCallbackUri: string | null }>> {
  const { creds } = input;
  if (!isMetaId(creds.wabaId)) {
    return { ok: false, error: "El WABA ID de Meta son solo números.", code: null };
  }
  const res = await graph<{
    success?: boolean | string;
    data?: { override_callback_uri?: string }[];
  }>(`/${creds.wabaId}/subscribed_apps`, {
    method: "POST",
    token: creds.token,
    body:
      input.callbackUrl && input.verifyToken
        ? { override_callback_uri: input.callbackUrl, verify_token: input.verifyToken }
        : undefined,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    data: { overrideCallbackUri: res.data.data?.[0]?.override_callback_uri ?? null },
  };
}

/** ¿Está la app suscripta a la WABA, y con qué URL? (diagnóstico) */
export async function getWabaSubscription(
  creds: CloudCreds,
): Promise<GraphResult<{ subscribed: boolean; callbackUrl: string | null }>> {
  if (!isMetaId(creds.wabaId)) {
    return { ok: false, error: "El WABA ID de Meta son solo números.", code: null };
  }
  const res = await graph<{
    data?: {
      whatsapp_business_api_data?: { id?: string };
      override_callback_uri?: string;
    }[];
  }>(`/${creds.wabaId}/subscribed_apps`, { token: creds.token });
  if (!res.ok) return res;

  const apps = res.data.data ?? [];
  // Si sabemos el App ID, exigimos que sea EL nuestro: otra app suscripta a la
  // misma WABA no hace que nos lleguen los mensajes a nosotros.
  const mine = creds.appId
    ? apps.find((a) => String(a.whatsapp_business_api_data?.id ?? "") === creds.appId)
    : apps[0];

  return {
    ok: true,
    data: {
      subscribed: !!mine,
      callbackUrl: mine?.override_callback_uri ?? null,
    },
  };
}

/** Corta la entrega de webhooks. No borra el número ni el historial. */
export async function unsubscribeWaba(creds: CloudCreds): Promise<GraphResult<null>> {
  if (!isMetaId(creds.wabaId)) {
    return { ok: false, error: "El WABA ID de Meta son solo números.", code: null };
  }
  const res = await graph<{ success?: boolean }>(`/${creds.wabaId}/subscribed_apps`, {
    method: "DELETE",
    token: creds.token,
  });
  if (!res.ok) return res;
  return { ok: true, data: null };
}

/**
 * ¿La app ya tiene configurado su webhook de WhatsApp, y apuntando a dónde?
 *
 * Hace falta para NO pisar lo que ya está: la URL de la app es una sola para
 * todas las agencias que compartan esa app de Meta, así que sobrescribirla desde
 * la conexión de una agencia le cambiaría la configuración a las demás.
 */
export async function getAppSubscription(input: {
  appId: string;
  appSecret: string;
}): Promise<GraphResult<{ callbackUrl: string | null; active: boolean }>> {
  if (!isMetaId(input.appId)) {
    return { ok: false, error: "El App ID de Meta son solo números.", code: null };
  }
  const res = await graph<{
    data?: { object?: string; callback_url?: string; active?: boolean }[];
  }>(`/${input.appId}/subscriptions`, {
    token: appAccessToken(input.appId, input.appSecret),
  });
  if (!res.ok) return res;

  const wa = (res.data.data ?? []).find((s) => s.object === "whatsapp_business_account");
  return { ok: true, data: { callbackUrl: wa?.callback_url ?? null, active: wa?.active !== false } };
}

/**
 * Suscripción a nivel APP (el webhook "del panel de apps").
 *
 * El override de la WABA cubre los mensajes, que es lo que mueve el sistema,
 * pero los avisos de plantilla aprobada y de cuenta restringida SIEMPRE se
 * entregan a la URL de la app. Esto la configura por API para que también
 * lleguen. La referencia del Graph dice que WhatsApp no está soportado en este
 * endpoint, pero el propio tooling de Meta lo usa y funciona.
 *
 * OJO — no es un extra: es el PRERREQUISITO del override por cuenta. Sin esta
 * suscripción (con el campo `messages`), `subscribeWaba` con
 * `override_callback_uri` devuelve un (#100) "Before override the current
 * callback uri, your app must be subscribed to receive messages". Por eso
 * `connectCloud` la hace ANTES del override, no después.
 */
export async function subscribeAppWebhook(input: {
  appId: string;
  appSecret: string;
  callbackUrl: string;
  verifyToken: string;
}): Promise<GraphResult<null>> {
  if (!isMetaId(input.appId)) {
    return { ok: false, error: "El App ID de Meta son solo números.", code: null };
  }
  const res = await graph<{ success?: boolean }>(`/${input.appId}/subscriptions`, {
    method: "POST",
    token: appAccessToken(input.appId, input.appSecret),
    query: {
      object: "whatsapp_business_account",
      callback_url: input.callbackUrl,
      verify_token: input.verifyToken,
      fields: WEBHOOK_FIELDS.join(","),
      include_values: "true",
    },
  });
  if (!res.ok) return res;
  return { ok: true, data: null };
}

/* ═══════════════════════════════════════════════════════════
   REGISTRO DEL NÚMERO
   ═══════════════════════════════════════════════════════════ */

export type CloudRegisterResult = { ok: true } | { ok: false; error: string };

/**
 * Registra el número madre en la Cloud API (`POST /{phone_number_id}/register`).
 *
 * Es el paso que Meta NO deja hacer desde su panel nuevo cuando el número se dio
 * de alta a mano: el botón "Registrarte" queda gris y el número se queda en
 * "Pendiente", con el tooltip pidiendo justamente que se lo registre por la API.
 * Mientras tanto Meta no entrega nada al webhook, aunque el número ya esté
 * verificado y el webhook suscripto.
 *
 * El `pin` es la verificación en dos pasos del número. OJO con el sentido:
 * si el número YA tiene la verificación en dos pasos activa hay que mandar **ese**
 * PIN, no uno nuevo (si no, Meta contesta 133005). Recién si no la tiene, el que
 * se manda queda fijado como PIN. Y no se reintenta a ciegas: Meta permite 10
 * registros por número cada 72 hs y al pasarse devuelve 133016 y bloquea el
 * número tres días. NO se guarda de este lado — un PIN que vive en nuestra base
 * es un PIN que se filtra con nuestra base.
 */
export async function registerCloudNumber(
  creds: CloudCreds,
  pin: string,
): Promise<CloudRegisterResult> {
  if (!creds.token) return { ok: false, error: "Falta el token de la Cloud API." };
  if (!isMetaId(creds.phoneNumberId)) {
    return { ok: false, error: "El phone number ID de Meta son solo números." };
  }

  const res = await graph<{ success?: boolean | string }>(`/${creds.phoneNumberId}/register`, {
    method: "POST",
    token: creds.token,
    body: { messaging_product: "whatsapp", pin },
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true };
}

/* ═══════════════════════════════════════════════════════════
   MEDIA — bajar lo que mandan, subir lo que mandamos

   Meta no manda archivos por el webhook: manda un id. Ese id se cambia por una
   URL que vive CINCO MINUTOS y que hay que pedir con el token (un GET pelado
   devuelve 401). Para mandar, al revés: primero se sube el archivo y recién con
   el id que devuelve se manda el mensaje.

   Acá va solo la conversación con Meta. Dónde termina el archivo lo decide
   `lib/media/store.ts`: este módulo no sabe que existe Supabase.
   ═══════════════════════════════════════════════════════════ */

export type CloudMediaInfo = {
  /** vence a los 5 minutos y hay que bajarla con el token */
  url: string;
  mime: string;
  size: number | null;
};

/** La URL de descarga de un media entrante, a partir de su id. */
export async function getCloudMedia(
  creds: CloudCreds,
  mediaId: string,
): Promise<GraphResult<CloudMediaInfo>> {
  if (!creds.token) return { ok: false, error: "Falta el token de la Cloud API.", code: null };
  if (!isMetaId(mediaId)) {
    return { ok: false, error: "El id del archivo no es válido.", code: null };
  }
  const res = await graph<{ url?: string; mime_type?: string; file_size?: string | number }>(
    `/${mediaId}`,
    {
      token: creds.token,
      // Meta valida que el archivo sea de ESTE número: es gratis y evita bajar
      // por accidente el adjunto de otra cuenta si un id se cruza.
      query: isMetaId(creds.phoneNumberId) ? { phone_number_id: creds.phoneNumberId } : undefined,
    },
  );
  if (!res.ok) return res;
  if (!res.data.url) {
    return { ok: false, error: "Meta no devolvió la dirección del archivo.", code: null };
  }
  return {
    ok: true,
    data: {
      url: res.data.url,
      mime: res.data.mime_type ?? "application/octet-stream",
      size: res.data.file_size != null ? Number(res.data.file_size) : null,
    },
  };
}

/**
 * Sube un archivo y devuelve su id, que es lo que después viaja en el mensaje.
 *
 * Va como multipart y no como JSON, así que no puede usar el helper `graph()`.
 * El MIME viaja DOS VECES —en el campo `type` y pegado al archivo— porque así lo
 * pide la documentación; y el error más común de este endpoint (131053) es
 * justamente que el MIME declarado no coincida con el contenido real.
 */
export async function uploadCloudMedia(
  creds: CloudCreds,
  input: { body: Blob | ArrayBuffer; mime: string; filename: string },
): Promise<GraphResult<{ id: string }>> {
  if (!creds.token) return { ok: false, error: "Falta el token de la Cloud API.", code: null };
  if (!isMetaId(creds.phoneNumberId)) {
    return { ok: false, error: "El número madre no tiene un phone number ID válido.", code: null };
  }

  const blob =
    input.body instanceof Blob ? input.body : new Blob([input.body], { type: input.mime });

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", input.mime);
  form.append("file", blob, input.filename);

  try {
    const res = await fetch(`${GRAPH}/${creds.phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.token}` },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await res.json().catch(() => null)) as
      | { id?: string; error?: GraphError }
      | null;
    if (!res.ok || payload?.error || !payload?.id) {
      return {
        ok: false,
        error: graphError(payload, res.status),
        code: payload?.error?.code ?? res.status,
      };
    }
    return { ok: true, data: { id: payload.id } };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "TimeoutError";
    return {
      ok: false,
      error: aborted
        ? "Meta tardó demasiado en recibir el archivo."
        : "No se pudo subir el archivo a Meta.",
      code: null,
    };
  }
}

/** Los tipos de adjunto que entiende la Cloud API al enviar. */
export type CloudMediaKind = "image" | "video" | "audio" | "document" | "sticker";

/**
 * Manda un archivo ya subido.
 *
 * `voice: true` es lo que separa una NOTA DE VOZ de un archivo de audio: con eso
 * WhatsApp le muestra al cliente la onda y el play, y sin eso le muestra un
 * ícono de descarga. Meta solo lo acepta si el archivo es Ogg/Opus.
 */
export function sendCloudMedia(
  creds: CloudCreds,
  to: string,
  input: {
    kind: CloudMediaKind;
    mediaId: string;
    caption?: string | null;
    filename?: string | null;
    voice?: boolean;
  },
): Promise<CloudResult> {
  const media: Record<string, unknown> = { id: input.mediaId };
  // El audio no admite caption y el sticker tampoco: mandárselo es un 100 seguro.
  if (input.caption && (input.kind === "image" || input.kind === "video" || input.kind === "document")) {
    media.caption = input.caption.slice(0, 1024);
  }
  if (input.kind === "document" && input.filename) media.filename = input.filename;
  if (input.kind === "audio" && input.voice) media.voice = true;

  return send(creds, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to.replace(/\D/g, ""),
    type: input.kind,
    [input.kind]: media,
  });
}

/**
 * Reacciona a un mensaje. Con `emoji` en null se saca la reacción — es la misma
 * llamada con el emoji vacío, tal como lo define Meta.
 */
export function sendCloudReaction(
  creds: CloudCreds,
  to: string,
  messageId: string,
  emoji: string | null,
): Promise<CloudResult> {
  return send(creds, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to.replace(/\D/g, ""),
    type: "reaction",
    reaction: { message_id: messageId, emoji: emoji ?? "" },
  });
}
