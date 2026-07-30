import { createHmac } from "node:crypto";
import { config } from "./config.js";
import { patchChannel } from "./supabase.js";

export type InboundEvent = {
  type: "message";
  channelId: string;
  /** número del cliente, solo dígitos (E.164 sin +) */
  from: string;
  waMessageId: string | null;
  pushName: string | null;
  text: string;
  kind: "texto" | "imagen" | "video" | "audio" | "documento";
  timestamp: number;
};

/**
 * Un mensaje que no llega a la app es una consulta perdida: dejamos el motivo en
 * la fila del canal para que no muera en el stdout del worker. Se limpia sola
 * cuando la sesión se reconecta o se vuelve a vincular el número.
 */
async function flagChannel(channelId: string, detail: string): Promise<void> {
  try {
    await patchChannel(channelId, {
      last_error: `No se pudo avisarle a la app de un mensaje entrante: ${detail}`,
    });
  } catch {
    // si tampoco se puede escribir en la base, ya lo dijimos por consola
  }
}

/**
 * Avisa a la app de un mensaje entrante. La lógica de negocio (crear el lead,
 * derivar a la sucursal, avisarle al operador) vive allá, no acá.
 * Firma HMAC para que el endpoint no lo pueda llamar cualquiera.
 */
export async function notifyApp(event: InboundEvent): Promise<void> {
  const body = JSON.stringify(event);
  const signature = createHmac("sha256", config.webhookSecret).update(body).digest("hex");

  try {
    const res = await fetch(`${config.appUrl}/api/wa/baileys/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-wa-signature": signature,
      },
      body,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[notify] la app respondió ${res.status}: ${detail}`);
      await flagChannel(event.channelId, `la app respondió ${res.status}`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "error desconocido";
    console.error("[notify] no se pudo avisar a la app:", error);
    await flagChannel(event.channelId, detail);
  }
}
