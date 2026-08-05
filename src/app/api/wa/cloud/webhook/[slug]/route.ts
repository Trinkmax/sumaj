import { handleCloudWebhook, verifyCloudWebhook } from "@/lib/wa/cloud-webhook";

/**
 * Webhook del NÚMERO MADRE (Cloud API de Meta) — UNA URL POR AGENCIA.
 *
 * En Meta: WhatsApp → Configuration → Webhook
 *   URL: {NEXT_PUBLIC_APP_URL}/api/wa/cloud/webhook/{webhook_slug}
 *   Verify token: el que muestra Configuración → WhatsApp de esa agencia
 *   Campo suscripto: messages
 * (La pantalla arma la URL sola y el asistente la configura por API; esto es
 * para cuando hay que pegarla a mano.)
 *
 * POR QUÉ EL SLUG. El GET de verificación de Meta no manda nada que diga de qué
 * cuenta se trata: con un verify token por agencia, la agencia tiene que venir
 * en la URL o el handshake es imposible de resolver. El slug son 128 bits
 * opacos (no expone el uuid del canal ni se adivina), así que además funciona
 * como primera prueba de propiedad en el POST: el tenant sale de la URL y no de
 * lo que diga el payload.
 *
 * Un slug desconocido devuelve lo mismo que un token equivocado (403 en el GET,
 * 401 seco en el POST): que no se pueda distinguir "no existe" de "no coincide"
 * es lo que impide usar esto para descubrir agencias.
 *
 * El orden de validación del POST y por qué es seguro: arriba de
 * lib/wa/cloud-webhook.ts.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verificación del webhook (Meta pega un GET con hub.challenge). */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return verifyCloudWebhook(request, slug);
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return handleCloudWebhook(request, slug);
}
