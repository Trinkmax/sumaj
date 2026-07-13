// Envía por la Cloud API un mensaje ya registrado en la DB.
// Lo llama el server de Next después de insertar el mensaje (status pendiente).
// Body: { messageId: string }
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const token = Deno.env.get("WHATSAPP_TOKEN");
  if (!token) {
    return json({ ok: false, error: "WHATSAPP_TOKEN no configurado" }, 400);
  }

  const { messageId } = await req.json().catch(() => ({}));
  if (!messageId) return json({ ok: false, error: "messageId requerido" }, 400);

  const { data: message } = await supabase
    .from("messages")
    .select("*, conversation:conversations(wa_id, agency_id)")
    .eq("id", messageId)
    .single();
  if (!message || message.direction !== "out") {
    return json({ ok: false, error: "mensaje no encontrado" }, 404);
  }

  const { data: agency } = await supabase
    .from("agencies")
    .select("settings")
    .eq("id", message.agency_id)
    .single();
  const wa = (agency?.settings as Record<string, { phone_number_id?: string }>)?.whatsapp;
  const to = message.conversation?.wa_id;
  if (!wa?.phone_number_id || !to) {
    return json({ ok: false, error: "WhatsApp no conectado para esta agencia" }, 400);
  }

  const body =
    message.kind === "plantilla" && message.template_name
      ? {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: message.template_name,
            language: { code: (message.metadata?.language as string) ?? "es_AR" },
            components: message.metadata?.components ?? [],
          },
        }
      : {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: message.body ?? "" },
        };

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${wa.phone_number_id}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const result = await res.json().catch(() => null);
  const waId = result?.messages?.[0]?.id ?? null;

  await supabase
    .from("messages")
    .update({
      wa_message_id: waId,
      status: res.ok ? "enviado" : "fallido",
      error_detail: res.ok ? null : JSON.stringify(result?.error ?? {}),
    })
    .eq("id", messageId);

  return json({ ok: res.ok, waMessageId: waId });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
