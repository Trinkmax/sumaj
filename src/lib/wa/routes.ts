/**
 * Rutas del webhook de WhatsApp. Vive aparte y sin dependencias a propósito:
 * lo necesitan el asistente (server action), las dos rutas del webhook y la
 * pantalla de configuración (client component), y un archivo `"use server"`
 * solo puede exportar funciones async — una constante ahí rompe el build.
 */

/** Ruta vieja, sin agencia. Sigue viva para no romper lo ya configurado en Meta. */
export const WEBHOOK_BASE_PATH = "/api/wa/cloud/webhook";

/** Ruta de una agencia: el slug es lo único que identifica al tenant en el GET. */
export function webhookPathFor(slug: string): string {
  return `${WEBHOOK_BASE_PATH}/${slug}`;
}
