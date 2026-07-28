import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { cloudVerifyToken } from "@/lib/wa/cloud";
import { handleInboundMessage } from "@/lib/wa/inbound";
import type { Enums } from "@/lib/types";

/**
 * Webhook del NÚMERO MADRE (WhatsApp Cloud API de Meta).
 * Por acá entran todas las consultas nuevas: el sistema contesta solo,
 * crea el lead y lo deriva a la sucursal (ver lib/wa/inbound.ts).
 *
 * En Meta: WhatsApp → Configuration → Webhook
 *   URL: {NEXT_PUBLIC_APP_URL}/api/wa/cloud/webhook
 *   Verify token: WA_CLOUD_VERIFY_TOKEN
 *   Campo suscripto: messages
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verificación del webhook (Meta pega un GET con hub.challenge). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const expected = cloudVerifyToken();

  if (mode === "subscribe" && expected && token === expected) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/** Si está configurado el app secret de Meta, validamos la firma del body. */
function validMetaSignature(raw: string, header: string | null): boolean {
  const secret = process.env.WA_CLOUD_APP_SECRET;
  if (!secret) return true; // sin app secret configurado no exigimos firma
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(header.slice("sha256=".length), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const KIND_BY_TYPE: Record<string, Enums<"message_kind">> = {
  text: "texto",
  image: "imagen",
  video: "video",
  audio: "audio",
  document: "documento",
  sticker: "imagen",
};

type CloudPayload = {
  entry?: {
    changes?: {
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { profile?: { name?: string }; wa_id?: string }[];
        messages?: {
          id?: string;
          from?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          image?: { caption?: string };
          video?: { caption?: string };
          document?: { filename?: string };
          button?: { text?: string };
          referral?: { source_id?: string; headline?: string; source_type?: string };
          context?: { referred_product?: unknown };
        }[];
        statuses?: { id?: string; status?: string; errors?: { title?: string }[] }[];
      };
    }[];
  }[];
};

export async function POST(request: Request) {
  const raw = await request.text();
  if (!validMetaSignature(raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!hasAdminClient()) {
    console.error("[wa/cloud] falta SUPABASE_SERVICE_ROLE_KEY");
    return NextResponse.json({ ok: true });
  }

  let payload: CloudPayload;
  try {
    payload = JSON.parse(raw) as CloudPayload;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const supabase = createAdminClient();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;

      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      // el canal madre de la agencia dueña de ese número
      const { data: channel } = await supabase
        .from("wa_channels")
        .select("id")
        .eq("phone_number_id", phoneNumberId)
        .maybeSingle();
      if (!channel) {
        console.warn(`[wa/cloud] phone_number_id sin canal: ${phoneNumberId}`);
        continue;
      }

      /* estados de entrega de lo que mandamos */
      for (const status of value.statuses ?? []) {
        if (!status.id) continue;
        const mapped: Enums<"message_status"> | null =
          status.status === "sent"
            ? "enviado"
            : status.status === "delivered"
              ? "entregado"
              : status.status === "read"
                ? "leido"
                : status.status === "failed"
                  ? "fallido"
                  : null;
        if (!mapped) continue;
        await supabase
          .from("messages")
          .update({
            status: mapped,
            error_detail: status.errors?.[0]?.title ?? null,
          })
          .eq("wa_message_id", status.id);
      }

      /* mensajes entrantes */
      for (const message of value.messages ?? []) {
        if (!message.from) continue;
        const profileName = value.contacts?.[0]?.profile?.name ?? null;
        const text =
          message.text?.body ??
          message.image?.caption ??
          message.video?.caption ??
          message.button?.text ??
          message.document?.filename ??
          "";

        const result = await handleInboundMessage({
          channelId: channel.id,
          from: message.from,
          text,
          kind: KIND_BY_TYPE[message.type ?? "text"] ?? "texto",
          waMessageId: message.id ?? null,
          pushName: profileName,
          timestamp: message.timestamp ? Number(message.timestamp) * 1000 : Date.now(),
          // anuncios click-to-WhatsApp: Meta manda el referral del aviso
          campaign: message.referral?.headline ?? message.referral?.source_id ?? null,
        });
        if (!result.ok) console.error("[wa/cloud] ", result.error);
      }
    }
  }

  // Meta exige 200 rápido: si devolvemos error reintenta y duplica.
  return NextResponse.json({ ok: true });
}
