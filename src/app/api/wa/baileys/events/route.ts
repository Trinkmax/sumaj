import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { handleInboundMessage } from "@/lib/wa/inbound";
import type { Enums } from "@/lib/types";

/**
 * Eventos del worker de Baileys (los números de las sucursales).
 * El worker firma el body con HMAC-SHA256 y el mismo secreto compartido.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WorkerEvent = {
  type: "message";
  channelId: string;
  from: string;
  waMessageId: string | null;
  pushName: string | null;
  text: string;
  kind: "texto" | "imagen" | "video" | "audio" | "documento";
  timestamp: number;
};

function validSignature(raw: string, signature: string | null): boolean {
  const secret = process.env.WA_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-wa-signature"))) {
    return NextResponse.json({ ok: false, error: "Firma inválida" }, { status: 401 });
  }

  let event: WorkerEvent;
  try {
    event = JSON.parse(raw) as WorkerEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  if (event.type !== "message" || !event.channelId || !event.from) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const result = await handleInboundMessage({
    channelId: event.channelId,
    from: event.from,
    text: event.text ?? "",
    kind: (event.kind ?? "texto") as Enums<"message_kind">,
    waMessageId: event.waMessageId ?? null,
    pushName: event.pushName ?? null,
    timestamp: event.timestamp ?? Date.now(),
  });

  // 200 siempre que el evento sea válido: el worker no tiene por qué reintentar
  // un error nuestro de negocio, queda registrado en el log.
  if (!result.ok) console.error("[wa/baileys] ", result.error);
  return NextResponse.json({ ok: result.ok, error: result.error });
}
