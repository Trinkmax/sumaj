import { handleIgWebhook, verifyIgWebhook } from "@/lib/ig/webhook";

/**
 * Webhook de Instagram Direct — UNA URL POR AGENCIA.
 *
 * En Meta: Instagram → API setup with Instagram login → Configure webhooks
 *   Callback URL: {NEXT_PUBLIC_APP_URL}/api/ig/webhook/{webhook_slug}
 *   Verify token: el que muestra Configuración → Instagram de esa agencia
 *   Campos: messages (los demás los suscribe el sistema por API)
 *
 * OJO — a diferencia de WhatsApp, esto hay que pegarlo A MANO. Instagram no
 * deja configurar la callback URL por cuenta desde la API ("Account level
 * webhooks customization is not supported"): es una sola por app, del lado de
 * Meta. Por eso la pantalla de configuración muestra la URL y el verify token
 * grandes y con botón de copiar, en vez de esconderlos como en WhatsApp.
 *
 * Y por eso ESTA ES LA ÚNICA RUTA: **una app de Meta por agencia**. La variante
 * sin slug, que resolvía el tenant por el id de la cuenta del payload, se borró
 * — con una app compartida el App Secret también es compartido y la firma deja
 * de probar de quién es el mensaje. El razonamiento completo está arriba de
 * lib/ig/webhook.ts.
 *
 * El slug son 128 bits opacos: no expone el uuid del canal, no se adivina, y
 * funciona como primera prueba de propiedad en el POST — el tenant sale de la
 * URL y no de lo que diga el payload.
 *
 * El orden de validación y por qué es seguro: arriba de lib/ig/webhook.ts.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verificación del webhook (Meta pega un GET con hub.challenge). */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return verifyIgWebhook(request, slug);
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return handleIgWebhook(request, slug);
}
