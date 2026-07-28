import { NextResponse } from "next/server";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { hasCloudApi, sendCloudTemplate } from "@/lib/wa/cloud";
import { hasWorker, sendViaBaileys } from "@/lib/wa/worker";
import { fillTemplate } from "@/lib/domain";

/**
 * Despacha los seguimientos encolados (app.enqueue_followups los crea cada hora).
 *
 * El punto de toda la arquitectura: el seguimiento sale por el número de la
 * SUCURSAL (Baileys) → texto libre, sin ventana de 24 hs y sin plantilla paga.
 * Solo si la sucursal no tiene número vinculado se cae al número madre con una
 * plantilla aprobada (eso sí se le paga a Meta).
 *
 * Lo llama el cron de Postgres con el header x-cron-secret.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 40;

export async function POST(request: Request) {
  const secret = process.env.WA_CRON_SECRET;
  if (!secret || request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  if (!hasAdminClient()) {
    return NextResponse.json({ ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }

  const supabase = createAdminClient();

  const { data: pending, error } = await supabase
    .from("followups")
    .select(
      `id, agency_id, lead_id, conversation_id, template_id,
       lead:leads(id, destination, branch_id, trip_date_from,
                  contact:contacts(id, full_name, phone),
                  assignee:members!leads_assigned_to_fkey(display_name)),
       template:wa_templates(id, meta_name, body)`,
    )
    .eq("status", "pendiente")
    .lte("scheduled_at", new Date().toISOString())
    .limit(BATCH);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const followup of pending ?? []) {
    const lead = followup.lead;
    const contact = lead?.contact;
    const phone = contact?.phone;
    if (!lead || !contact || !phone) {
      await supabase.from("followups").update({ status: "cancelado" }).eq("id", followup.id);
      skipped += 1;
      continue;
    }

    const body = fillTemplate(
      followup.template?.body ??
        "Hola {{nombre}}, ¿seguís con la idea del viaje a {{destino}}? Cualquier cosa te armo opciones nuevas.",
      {
        nombre: contact.full_name.split(" ")[0],
        vendedor: lead.assignee?.display_name ?? "",
        destino: lead.destination ?? "tu viaje",
        fecha: lead.trip_date_from ?? "",
      },
    );

    /* 1. por el número de la sucursal — gratis */
    let channelId: string | null = null;
    let conversationId: string | null = followup.conversation_id;

    if (lead.branch_id && hasWorker()) {
      const { data: branchChannel } = await supabase
        .from("wa_channels")
        .select("id, status")
        .eq("branch_id", lead.branch_id)
        .eq("kind", "baileys")
        .maybeSingle();
      if (branchChannel?.status === "conectado") channelId = branchChannel.id;
    }

    let ok = false;
    let waMessageId: string | null = null;
    let errorDetail: string | null = null;
    let templateName: string | null = null;

    if (channelId) {
      const res = await sendViaBaileys(channelId, phone, body);
      ok = res.ok;
      if (res.ok) waMessageId = res.data.waMessageId;
      else errorDetail = res.error;

      // el hilo de la sucursal: se crea si es el primer contacto por ese número
      const { data: conv } = await supabase
        .from("conversations")
        .select("id")
        .eq("agency_id", followup.agency_id)
        .eq("contact_id", contact.id)
        .eq("channel_id", channelId)
        .maybeSingle();
      if (conv) {
        conversationId = conv.id;
      } else {
        const { data: created } = await supabase
          .from("conversations")
          .insert({
            agency_id: followup.agency_id,
            contact_id: contact.id,
            channel: "whatsapp",
            channel_id: channelId,
            branch_id: lead.branch_id,
            wa_id: phone,
          })
          .select("id")
          .single();
        conversationId = created?.id ?? conversationId;
      }
    } else if (hasCloudApi() && followup.template?.meta_name) {
      /* 2. fallback: plantilla paga por el número madre */
      const { data: mother } = await supabase
        .from("wa_channels")
        .select("id, phone_number_id")
        .eq("agency_id", followup.agency_id)
        .eq("is_mother", true)
        .maybeSingle();
      if (mother?.phone_number_id) {
        const res = await sendCloudTemplate(
          mother.phone_number_id,
          phone,
          followup.template.meta_name,
        );
        ok = res.ok;
        templateName = followup.template.meta_name;
        if (res.ok) waMessageId = res.waMessageId;
        else errorDetail = res.error;
      } else {
        errorDetail = "El número madre no tiene phone number ID.";
      }
    } else {
      errorDetail = "La sucursal no tiene WhatsApp vinculado.";
    }

    if (conversationId) {
      const { data: message } = await supabase
        .from("messages")
        .insert({
          agency_id: followup.agency_id,
          conversation_id: conversationId,
          direction: "out",
          kind: templateName ? "plantilla" : "texto",
          body,
          template_name: templateName,
          is_automated: true,
          status: ok ? "enviado" : "fallido",
          wa_message_id: waMessageId,
          error_detail: errorDetail,
          metadata: { followup_id: followup.id },
        })
        .select("id")
        .single();

      await supabase
        .from("followups")
        .update({
          status: ok ? "enviado" : "fallido",
          sent_at: ok ? new Date().toISOString() : null,
          sent_message_id: message?.id ?? null,
        })
        .eq("id", followup.id);
    } else {
      await supabase
        .from("followups")
        .update({ status: ok ? "enviado" : "fallido" })
        .eq("id", followup.id);
    }

    if (ok) sent += 1;
    else failed += 1;
  }

  return NextResponse.json({ ok: true, sent, failed, skipped });
}
