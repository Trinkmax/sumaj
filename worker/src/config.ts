/** Config del worker. Todo por env: el worker no sabe nada de una agencia en particular. */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[config] Falta la variable de entorno ${name}`);
    process.exit(1);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8088),
  /** Supabase con service role: el worker escribe estado de sesión y credenciales. */
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  /**
   * La app viajerOS, para avisarle de los mensajes entrantes. Sin valor por
   * defecto a propósito: un worker apuntando a un localhost que no existe
   * arranca "sano" y pierde cada consulta en un console.error.
   */
  appUrl: required("APP_URL").replace(/\/$/, ""),
  /** Secreto compartido: firma HMAC de los eventos que manda el worker. */
  webhookSecret: required("WA_WEBHOOK_SECRET"),
  /** Secreto compartido: la app se autentica contra el worker con este bearer. */
  workerToken: required("WA_WORKER_TOKEN"),
  /** Nombre que ve el usuario en "dispositivos vinculados" de su WhatsApp. */
  deviceName: process.env.WA_DEVICE_NAME ?? "viajerOS",
  logLevel: process.env.LOG_LEVEL ?? "info",
};
