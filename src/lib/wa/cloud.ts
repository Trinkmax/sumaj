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
