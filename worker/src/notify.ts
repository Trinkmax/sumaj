import { createHmac } from "node:crypto";
import { config } from "./config.js";

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
      console.error(`[notify] la app respondió ${res.status}: ${await res.text().catch(() => "")}`);
    }
  } catch (error) {
    console.error("[notify] no se pudo avisar a la app:", error);
  }
}
