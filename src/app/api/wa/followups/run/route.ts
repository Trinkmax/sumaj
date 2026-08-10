import { NextResponse } from "next/server";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { sendCloudTemplateMessage } from "@/lib/wa/cloud";
import { getCloudCreds, type ResolvedCloudCreds } from "@/lib/wa/cloud-credentials";
import { hasWorker, sendViaBaileys } from "@/lib/wa/worker";
import { fillTemplate } from "@/lib/domain";
import { fmtDate } from "@/lib/format";

/**
 * Despacha los seguimientos encolados (app.enqueue_followups los crea cada hora).
 *
 * El punto de toda la arquitectura: el seguimiento sale por el número de la
 * SUCURSAL (Baileys) → texto libre, sin ventana de 24 hs y sin plantilla paga.
 * Solo si la sucursal no tiene número vinculado se cae al número madre con una
 * plantilla aprobada (eso sí se le paga a Meta).
 *
 * El lote mezcla agencias: las credenciales de Meta se resuelven POR FILA con
 * `getCloudCreds(followup.agency_id)`, memoizadas a mano en un Map local al
 * request. Acá NO alcanza el `cache()` de React que trae esa función: memoiza
 * dentro del render de un RSC y en un route handler no hay dispatcher, así que
 * cada fila volvería a pagar las consultas y los descifrados del Vault.
 * Resolverlas una sola vez para todo el lote haría que una agencia mande con el
 * token de otra: por eso la clave del memo es siempre el agency_id.
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

  /* Credenciales de Meta memoizadas para este lote, UNA ENTRADA POR AGENCIA:
     el lote mezcla agencias y una sola entrada compartida haría que una mande
     con el token de otra. Se llena la primera vez que una fila de esa agencia
     lo necesita; `null` (no hay token) también se cachea para no reintentar. */
  const credsPorAgencia = new Map<string, ResolvedCloudCreds | null>();
  async function credsDe(agencyId: string): Promise<ResolvedCloudCreds | null> {
    const memo = credsPorAgencia.get(agencyId);
    if (memo !== undefined) return memo;
    const creds = await getCloudCreds(agencyId);
    credsPorAgencia.set(agencyId, creds);
    return creds;
  }

  const { data: pending, error } = await supabase
    .from("followups")
    .select(
      `id, agency_id, lead_id, conversation_id, template_id,
       lead:leads(id, destination, branch_id, trip_date_from,
                  contact:contacts(id, full_name, phone),
                  assignee:members!leads_assigned_to_fkey(display_name)),
       template:wa_templates(id, meta_name, body, language, variables)`,
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

    /* Los valores de las variables. Se usan para DOS cosas que tienen que dar
       igual: el texto que se manda por el número de la sucursal (interpolado
       acá) y los parámetros que viajan a Meta si hay que caer en la plantilla
       paga. Si se separan, el cliente recibe una cosa y el hilo guarda otra. */
    const vars: Record<string, string> = {
      nombre: contact.full_name.split(" ")[0],
      vendedor: lead.assignee?.display_name ?? "",
      destino: lead.destination ?? "tu viaje",
      fecha: lead.trip_date_from ? fmtDate(lead.trip_date_from) : "",
    };

    const body = fillTemplate(
      followup.template?.body ??
        "Hola {{nombre}}, ¿seguís con la idea del viaje a {{destino}}? Cualquier cosa te armo opciones nuevas.",
      vars,
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
    } else if (followup.template?.meta_name) {
      /* 2. fallback: plantilla paga por el número madre DE ESA AGENCIA.
         Si esta agencia no tiene Meta conectado falla solo este seguimiento:
         el resto del lote —que puede ser de otras agencias— sigue. */
      const creds = await credsDe(followup.agency_id);
      if (creds?.phoneNumberId) {
        /* Las variables van con NOMBRE y tienen que ser exactamente las que la
           plantilla declara en Meta: una de más o de menos es un rechazo
           (132000). Antes acá se mandaba la plantilla PELADA, sin parámetros,
           que funcionaba solo mientras las plantillas eran texto suelto con un
           tilde manual; con las plantillas creadas de verdad contra Meta —las
           que usan las difusiones— eso falla siempre. */
        const declaradas = followup.template.variables ?? [];
        const faltantes = declaradas.filter((v) => !vars[v]);

        if (faltantes.length > 0) {
          /* Un parámetro vacío también lo rechaza Meta, y rellenarlo con algo
             inventado le manda al cliente una frase rota ("vence el "). Mejor
             que el seguimiento quede fallido con el motivo a la vista: es un
             dato que falta en el lead, y alguien lo puede completar. */
          errorDetail = `A la plantilla le faltan datos del lead: ${faltantes.join(", ")}.`;
        } else {
          const res = await sendCloudTemplateMessage(creds, phone, {
            name: followup.template.meta_name,
            language: followup.template.language,
            bodyParams: Object.fromEntries(declaradas.map((v) => [v, vars[v]])),
            // El seguimiento no lleva botones: no es una difusión, es una
            // conversación que ya venía.
            buttons: [],
          });
          ok = res.ok;
          templateName = followup.template.meta_name;
          if (res.ok) waMessageId = res.waMessageId;
          else errorDetail = res.error;
        }
      } else {
        errorDetail = "El número madre de la agencia no está conectado con Meta.";
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
