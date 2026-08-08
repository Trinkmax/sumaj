/**
 * Rutas del webhook de Instagram. Vive aparte y sin dependencias a propósito:
 * lo necesitan el asistente (server action), las dos rutas del webhook y la
 * pantalla de configuración (client component), y un archivo `"use server"`
 * solo puede exportar funciones async — una constante ahí rompe el build.
 */

export const IG_WEBHOOK_BASE_PATH = "/api/ig/webhook";

/**
 * La URL del webhook de una agencia. Siempre con slug: en Instagram la callback
 * URL es una sola por app de Meta, así que el modelo es **una app por agencia** y
 * el tenant sale de la URL, nunca del payload. Ver lib/ig/webhook.ts.
 */
export function igWebhookPathFor(slug: string): string {
  return `${IG_WEBHOOK_BASE_PATH}/${slug}`;
}
