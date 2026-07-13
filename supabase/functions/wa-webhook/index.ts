// Webhook de WhatsApp Cloud API (Meta).
// GET  → verificación del webhook (hub.challenge)
// POST → mensajes entrantes y actualizaciones de estado
// Cada mensaje entrante: upsert contacto → conversación → mensaje,
// y si el contacto no tiene una consulta activa, crea el lead solo
// (con campaña de origen si viene de Click-to-WhatsApp).
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const ACTIVE_STAGES = ["nuevo", "contactado", "presupuestado", "negociacion"];

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // ── Verificación del webhook ──
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = Deno.env.get("WA_VERIFY_TOKEN") ?? "sumaj-verify";
    if (mode === "subscribe" && token === expected && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const rawBody = await req.text();

  // Verificación de firma de Meta (X-Hub-Signature-256 = HMAC-SHA256 del body
  // con el App Secret). Obligatoria si META_APP_SECRET está configurado.
  const appSecret = Deno.env.get("META_APP_SECRET");
  if (appSecret) {
    const signature = req.headers.get("x-hub-signature-256") ?? "";
    const valid = await verifySignature(rawBody, signature, appSecret);
    if (!valid) return new Response("invalid signature", { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("bad request", { status: 400 });
  }

  try {
    const entries = (payload.entry ?? []) as Array<{
      changes?: Array<{ value?: WebhookValue }>;
    }>;

    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;
        const phoneNumberId = value.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        // agencia dueña de este número
        const { data: agency } = await supabase
          .from("agencies")
          .select("id, settings")
          .eq("settings->whatsapp->>phone_number_id", phoneNumberId)
          .maybeSingle();
        if (!agency) continue;

        for (const status of value.statuses ?? []) {
          await handleStatus(status);
        }

        for (const msg of value.messages ?? []) {
          const profileName =
            value.contacts?.find((c) => c.wa_id === msg.from)?.profile?.name ?? null;
          await handleInbound(agency.id, msg, profileName);
        }
      }
    }
  } catch (e) {
    console.error("[wa-webhook]", e);
  }

  // Meta exige 200 rápido, siempre
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});

async function verifySignature(
  body: string,
  header: string,
  secret: string,
): Promise<boolean> {
  if (!header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected =
    "sha256=" +
    Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  // comparación de tiempo constante
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  }
  return diff === 0;
}

type WebhookValue = {
  metadata?: { phone_number_id?: string };
  contacts?: Array<{ wa_id: string; profile?: { name?: string } }>;
  messages?: Array<InboundMessage>;
  statuses?: Array<{
    id: string;
    status: string;
    errors?: Array<{ title?: string; message?: string }>;
  }>;
};

type InboundMessage = {
  id: string;
  from: string;
  type: string;
  timestamp?: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string };
  document?: { id?: string; filename?: string; caption?: string };
  audio?: { id?: string };
  video?: { id?: string; caption?: string };
  referral?: {
    headline?: string;
    body?: string;
    source_type?: string;
    source_id?: string;
    source_url?: string;
  };
};

async function handleStatus(status: {
  id: string;
  status: string;
  errors?: Array<{ title?: string; message?: string }>;
}) {
  const map: Record<string, string> = {
    sent: "enviado",
    delivered: "entregado",
    read: "leido",
    failed: "fallido",
  };
  const mapped = map[status.status];
  if (!mapped) return;
  await supabase
    .from("messages")
    .update({
      status: mapped,
      error_detail: status.errors?.[0]?.title ?? null,
    })
    .eq("wa_message_id", status.id);
}

async function handleInbound(
  agencyId: string,
  msg: InboundMessage,
  profileName: string | null,
) {
  // idempotencia: Meta reintenta entregas
  const { data: existing } = await supabase
    .from("messages")
    .select("id")
    .eq("wa_message_id", msg.id)
    .maybeSingle();
  if (existing) return;

  // contacto por teléfono
  let contactId: string;
  const { data: contact } = await supabase
    .from("contacts")
    .select("id")
    .eq("agency_id", agencyId)
    .eq("phone", msg.from)
    .maybeSingle();

  if (contact) {
    contactId = contact.id;
  } else {
    const { data: created, error } = await supabase
      .from("contacts")
      .insert({
        agency_id: agencyId,
        full_name: profileName ?? `+${msg.from}`,
        phone: msg.from,
        source: "whatsapp",
      })
      .select("id")
      .single();
    if (error || !created) return;
    contactId = created.id;
  }

  // conversación
  let conversationId: string;
  const { data: conv } = await supabase
    .from("conversations")
    .select("id")
    .eq("agency_id", agencyId)
    .eq("contact_id", contactId)
    .eq("channel", "whatsapp")
    .maybeSingle();

  if (conv) {
    conversationId = conv.id;
  } else {
    const { data: created, error } = await supabase
      .from("conversations")
      .insert({
        agency_id: agencyId,
        contact_id: contactId,
        channel: "whatsapp",
        wa_id: msg.from,
      })
      .select("id")
      .single();
    if (error || !created) return;
    conversationId = created.id;
  }

  const kindMap: Record<string, string> = {
    text: "texto",
    image: "imagen",
    document: "documento",
    audio: "audio",
    video: "video",
  };
  const body =
    msg.text?.body ??
    msg.image?.caption ??
    msg.document?.caption ??
    msg.video?.caption ??
    (msg.type !== "text" ? `[${msg.type}]` : null);

  await supabase.from("messages").insert({
    agency_id: agencyId,
    conversation_id: conversationId,
    direction: "in",
    kind: kindMap[msg.type] ?? "texto",
    body,
    wa_message_id: msg.id,
    status: "entregado",
    created_at: msg.timestamp
      ? new Date(Number(msg.timestamp) * 1000).toISOString()
      : new Date().toISOString(),
  });

  // ¿tiene una consulta activa? si no, el lead entra solo
  const { data: activeLead } = await supabase
    .from("leads")
    .select("id")
    .eq("contact_id", contactId)
    .in("stage", ACTIVE_STAGES)
    .limit(1)
    .maybeSingle();

  if (!activeLead) {
    const campaign = msg.referral?.headline ?? msg.referral?.body ?? null;
    const { data: lead } = await supabase
      .from("leads")
      .insert({
        agency_id: agencyId,
        contact_id: contactId,
        stage: "nuevo",
        origin_channel: "whatsapp",
        origin_campaign: campaign ? `CTWA — ${campaign}` : null,
        origin_ad_id: msg.referral?.source_id ?? null,
        initial_message: body,
        position: 0,
      })
      .select("id")
      .single();

    // avisar a los admins
    const { data: admins } = await supabase
      .from("members")
      .select("id")
      .eq("agency_id", agencyId)
      .eq("role", "admin")
      .eq("is_active", true);
    if (admins?.length && lead) {
      await supabase.from("notifications").insert(
        admins.map((a) => ({
          agency_id: agencyId,
          member_id: a.id,
          type: "lead_nuevo",
          title: "Nuevo lead de WhatsApp",
          body: `${profileName ?? `+${msg.from}`}${campaign ? ` — ${campaign}` : ""}`,
          link: `/crm/${lead.id}`,
        })),
      );
    }

    // respuesta automática instantánea que califica (ventana de 24h abierta)
    await sendAutoReply(agencyId, msg.from, conversationId, profileName);
  }
}

async function sendAutoReply(
  agencyId: string,
  to: string,
  conversationId: string,
  profileName: string | null,
) {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  if (!token) return;

  const { data: agency } = await supabase
    .from("agencies")
    .select("settings")
    .eq("id", agencyId)
    .single();
  const wa = (agency?.settings as Record<string, { phone_number_id?: string }>)?.whatsapp;
  if (!wa?.phone_number_id) return;

  const { data: tpl } = await supabase
    .from("wa_templates")
    .select("body")
    .eq("agency_id", agencyId)
    .eq("meta_name", "bienvenida_calificacion")
    .maybeSingle();

  const text = (tpl?.body ?? "¡Hola{{nombre}}! Gracias por escribirnos 🌎 ¿A qué destino querés viajar, en qué fechas y cuántos son?")
    .replaceAll("{{nombre}}", profileName ? ` ${profileName.split(" ")[0]}` : "")
    .replaceAll("{{vendedor}}", "el equipo")
    .replaceAll("{{destino}}", "tu viaje")
    .replaceAll("{{fecha}}", "");

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${wa.phone_number_id}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    },
  );
  const json = await res.json().catch(() => null);
  const waId = json?.messages?.[0]?.id ?? null;

  await supabase.from("messages").insert({
    agency_id: agencyId,
    conversation_id: conversationId,
    direction: "out",
    kind: "texto",
    body: text,
    wa_message_id: waId,
    status: res.ok ? "enviado" : "fallido",
    is_automated: true,
    error_detail: res.ok ? null : JSON.stringify(json?.error ?? {}),
  });
}
