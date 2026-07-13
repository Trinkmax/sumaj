// Procesa la cola de seguimientos (followups pendientes y vencidos).
// La encola app.enqueue_followups() (pg_cron, cada hora); acá se ENVÍA
// con plantillas pre-aprobadas — solo para agencias con Cloud API conectada.
// Cadencia por defecto: 48h → día 7 → día 21 (solo presupuestado/negociación).
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const token = Deno.env.get("WHATSAPP_TOKEN");

  // seguimientos viejos sin poder de envío → cancelar para que no se acumulen
  await supabase
    .from("followups")
    .update({ status: "cancelado" })
    .eq("status", "pendiente")
    .lt("scheduled_at", new Date(Date.now() - 30 * 86400000).toISOString());

  const { data: due } = await supabase
    .from("followups")
    .select(
      `id, agency_id, touch_number, template_id, conversation_id,
       lead:leads(id, destination, stage, assigned_to, contact:contacts(full_name, phone)),
       template:wa_templates(meta_name, language, body),
       conversation:conversations(id, wa_id, last_inbound_at)`,
    )
    .eq("status", "pendiente")
    .lte("scheduled_at", new Date().toISOString())
    .limit(50);

  let sent = 0;
  let skipped = 0;

  for (const f of due ?? []) {
    const lead = f.lead as unknown as {
      id: string;
      destination: string | null;
      stage: string;
      assigned_to: string | null;
      contact: { full_name: string; phone: string | null };
    } | null;
    const template = f.template as unknown as {
      meta_name: string;
      language: string;
      body: string;
    } | null;
    const conversation = f.conversation as unknown as {
      id: string;
      wa_id: string | null;
    } | null;

    if (!lead || !template || !conversation?.wa_id) {
      await supabase.from("followups").update({ status: "cancelado" }).eq("id", f.id);
      continue;
    }

    const { data: agency } = await supabase
      .from("agencies")
      .select("settings")
      .eq("id", f.agency_id)
      .single();
    const wa = (agency?.settings as Record<string, { phone_number_id?: string; connected?: boolean }>)
      ?.whatsapp;

    if (!token || !wa?.connected || !wa?.phone_number_id) {
      skipped++;
      continue; // queda pendiente hasta que conecten la API
    }

    // vendedor asignado (para {{vendedor}})
    let sellerName = "el equipo";
    if (lead.assigned_to) {
      const { data: seller } = await supabase
        .from("members")
        .select("display_name")
        .eq("id", lead.assigned_to)
        .maybeSingle();
      if (seller) sellerName = seller.display_name;
    }

    const vars: Record<string, string> = {
      nombre: lead.contact.full_name.split(" ")[0],
      vendedor: sellerName,
      destino: lead.destination ?? "tu viaje",
      fecha: "",
    };
    const filledBody = template.body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
    // orden de parámetros según aparición en el body de la plantilla
    const paramOrder = [...template.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);

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
          to: conversation.wa_id,
          type: "template",
          template: {
            name: template.meta_name,
            language: { code: template.language || "es_AR" },
            components: paramOrder.length
              ? [
                  {
                    type: "body",
                    parameters: paramOrder.map((k) => ({ type: "text", text: vars[k] ?? "" })),
                  },
                ]
              : [],
          },
        }),
      },
    );
    const result = await res.json().catch(() => null);
    const waId = result?.messages?.[0]?.id ?? null;

    const { data: message } = await supabase
      .from("messages")
      .insert({
        agency_id: f.agency_id,
        conversation_id: conversation.id,
        direction: "out",
        kind: "plantilla",
        body: filledBody,
        template_name: template.meta_name,
        wa_message_id: waId,
        status: res.ok ? "enviado" : "fallido",
        is_automated: true,
        error_detail: res.ok ? null : JSON.stringify(result?.error ?? {}),
        metadata: { followup_id: f.id, touch: f.touch_number },
      })
      .select("id")
      .single();

    await supabase
      .from("followups")
      .update({
        status: res.ok ? "enviado" : "fallido",
        sent_at: new Date().toISOString(),
        sent_message_id: message?.id ?? null,
      })
      .eq("id", f.id);

    if (res.ok) {
      sent++;
      await supabase.from("activities").insert({
        agency_id: f.agency_id,
        lead_id: lead.id,
        member_id: null,
        type: "whatsapp",
        body: `Reenganche automático enviado (toque ${f.touch_number}) 🤖`,
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, sent, skipped, due: due?.length ?? 0 }), {
    headers: { "Content-Type": "application/json" },
  });
});
