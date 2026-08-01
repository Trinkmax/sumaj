/**
 * Cliente de la WhatsApp Cloud API de Meta — el NÚMERO MADRE.
 *
 * SOLO SERVIDOR. Por acá entran todas las consultas nuevas y sale la respuesta
 * automática que le avisa al cliente que un operador lo va a contactar.
 * El seguimiento NO sale por acá (fuera de las 24 hs habría que pagar
 * plantillas): eso va por el número de la sucursal con Baileys.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export function hasCloudApi(): boolean {
  return !!process.env.WA_CLOUD_TOKEN;
}

/** Token que Meta manda en la verificación del webhook (GET). */
export function cloudVerifyToken(): string {
  return process.env.WA_CLOUD_VERIFY_TOKEN ?? "";
}

export type CloudResult = { ok: true; waMessageId: string | null } | { ok: false; error: string };

async function post(phoneNumberId: string, payload: unknown): Promise<CloudResult> {
  const token = process.env.WA_CLOUD_TOKEN;
  if (!token) return { ok: false, error: "Falta el token de la Cloud API." };
  if (!phoneNumberId) return { ok: false, error: "El número madre no tiene phone number ID." };

  try {
    const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => null)) as {
      messages?: { id: string }[];
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      return { ok: false, error: data?.error?.message ?? `Meta respondió ${res.status}.` };
    }
    return { ok: true, waMessageId: data?.messages?.[0]?.id ?? null };
  } catch {
    return { ok: false, error: "No se pudo conectar con la Cloud API." };
  }
}

/** Texto libre — solo válido dentro de la ventana de 24 hs. */
export function sendCloudText(
  phoneNumberId: string,
  to: string,
  body: string,
): Promise<CloudResult> {
  return post(phoneNumberId, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to.replace(/\D/g, ""),
    type: "text",
    text: { preview_url: true, body },
  });
}

export type CloudRegisterResult = { ok: true } | { ok: false; error: string };

/**
 * Registra el número madre en la Cloud API (`POST /{phone_number_id}/register`).
 *
 * Es el paso que Meta NO deja hacer desde su panel nuevo cuando el número se dio
 * de alta a mano: el botón "Registrarte" queda gris ("number registration is
 * unavailable for this account now") y el número se queda en "Pendiente", con el
 * tooltip pidiendo justamente que se lo registre por la API. Mientras tanto Meta
 * no entrega nada al webhook, aunque el número ya esté verificado y el webhook
 * suscripto.
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
  phoneNumberId: string,
  pin: string,
): Promise<CloudRegisterResult> {
  const token = process.env.WA_CLOUD_TOKEN;
  if (!token) return { ok: false, error: "Falta el token de la Cloud API en el servidor." };
  if (!phoneNumberId) return { ok: false, error: "El número madre no tiene phone number ID." };
  // el ID se interpola en la URL del Graph y sale con el token de la plataforma:
  // un valor con "/" o "?" apuntaría ese token a otro edge de Meta.
  if (!/^\d{5,20}$/.test(phoneNumberId)) {
    return { ok: false, error: "El phone number ID de Meta son solo números." };
  }

  try {
    const res = await fetch(`${GRAPH}/${phoneNumberId}/register`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", pin }),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => null)) as {
      success?: boolean;
      error?: { message?: string; error_data?: { details?: string } };
    } | null;
    // Meta contesta 200 {"success":true}. En los errores de registro (133000
    // "desregistralo primero", 133005 PIN que no coincide, 133006 re-verificación,
    // 133008 demasiados intentos con el tiempo de espera, 133016 bloqueo de 72 hs)
    // la instrucción accionable viaja en error_data.details; `message` es el
    // genérico con el código. Por eso details va primero.
    if (!res.ok || data?.success === false) {
      return {
        ok: false,
        error:
          data?.error?.error_data?.details ??
          data?.error?.message ??
          `Meta respondió ${res.status}.`,
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "No se pudo conectar con la Cloud API." };
  }
}

/** Plantilla aprobada — la única vía fuera de la ventana de 24 hs. */
export function sendCloudTemplate(
  phoneNumberId: string,
  to: string,
  templateName: string,
  language = "es_AR",
): Promise<CloudResult> {
  return post(phoneNumberId, {
    messaging_product: "whatsapp",
    to: to.replace(/\D/g, ""),
    type: "template",
    template: { name: templateName, language: { code: language } },
  });
}
