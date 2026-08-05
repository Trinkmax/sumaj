import { handleCloudWebhook, verifyCloudWebhook } from "@/lib/wa/cloud-webhook";

/**
 * Webhook del NÚMERO MADRE (Cloud API de Meta) — RUTA VIEJA, sin slug.
 *
 * Se queda viva por compatibilidad: es la URL que ya está cargada en Meta en las
 * cuentas conectadas antes de que las credenciales pasaran a la app. Si se
 * apagara, esas agencias dejarían de recibir consultas y nadie se enteraría
 * hasta que un cliente reclamara.
 *
 * Lo nuevo va por /api/wa/cloud/webhook/{webhook_slug} (una URL por agencia, la
 * que muestra Configuración → WhatsApp). Cuando no quede ninguna cuenta apuntada
 * acá, este archivo se borra.
 *
 * Las dos limitaciones de no tener slug, y por qué la otra ruta existe:
 *   · GET: Meta manda solo hub.mode / hub.verify_token / hub.challenge, así que
 *     hay que preguntarle a la base si ese verify token es de ALGUNA agencia.
 *   · POST: el tenant se resuelve por el phone_number_id que viene en el
 *     payload — el único dato que se lee antes de validar la firma.
 *
 * El detalle del orden de validación (y por qué es seguro) está arriba de
 * lib/wa/cloud-webhook.ts.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verificación del webhook (Meta pega un GET con hub.challenge). */
export async function GET(request: Request) {
  return verifyCloudWebhook(request, null);
}

export async function POST(request: Request) {
  return handleCloudWebhook(request, null);
}
