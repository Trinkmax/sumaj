"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  requireAction,
  succeed,
  fail,
  logActivity,
  type ActionResult,
} from "@/lib/actions/core";
import { hasCloudApi, sendCloudTemplate, sendCloudText } from "@/lib/wa/cloud";
import { hasWorker, sendViaBaileys } from "@/lib/wa/worker";
import { alertBranchOperators } from "@/lib/wa/inbound";
import type { MessageStatus } from "@/lib/types";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export type SentMessage = { id: string; status: MessageStatus; createdAt: string };

/** Todo lo que hace falta para saber por qué número sale el mensaje. */
const CONVERSATION_WITH_CHANNEL =
  "id, last_inbound_at, wa_id, branch_id, contact:contacts(id, full_name, phone), channel_ref:wa_channels(id, kind, status, phone_number_id, label)";

/* ───────────────────────────────────────────
   sendMessage — texto libre.
   · Sucursal (Baileys): sale por el número de la sucursal, SIN ventana de
     24 hs ni plantillas pagas. Es la razón de ser de la arquitectura.
   · Número madre (Cloud API): solo dentro de la ventana de 24 hs.
   ─────────────────────────────────────────── */

const sendSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1).max(4096),
});

export async function sendMessage(input: {
  conversationId: string;
  body: string;
}): Promise<ActionResult<SentMessage>> {
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return fail("El mensaje está vacío o es demasiado largo.");
  const { supabase, member, agency } = await requireAction();

  const { data: conversation } = await supabase
    .from("conversations")
    .select(CONVERSATION_WITH_CHANNEL)
    .eq("id", parsed.data.conversationId)
    .maybeSingle();
  if (!conversation) return fail("No encontramos la conversación.");

  const channel = conversation.channel_ref;
  const to = conversation.contact?.phone ?? conversation.wa_id;
  const isBaileys = channel?.kind === "baileys";

  // La ventana de 24 hs es una regla de la API oficial: por el número de la
  // sucursal no aplica.
  if (!isBaileys) {
    const inWindow =
      conversation.last_inbound_at != null &&
      Date.now() - new Date(conversation.last_inbound_at).getTime() < WINDOW_MS;
    if (!inWindow)
      return fail(
        "Fuera de la ventana de 24 hs del número madre. Derivá el chat a una sucursal para seguir sin costo.",
      );
  }

  /* envío real según el canal */
  let status: MessageStatus = "enviado";
  let waMessageId: string | null = null;
  let errorDetail: string | null = null;
  let simulated = false;

  if (isBaileys && hasWorker() && to) {
    if (channel?.status !== "conectado") {
      return fail("El WhatsApp de esa sucursal no está vinculado. Vinculalo en Configuración.");
    }
    const res = await sendViaBaileys(channel.id, to, parsed.data.body);
    if (res.ok) {
      waMessageId = res.data.waMessageId;
    } else {
      status = "fallido";
      errorDetail = res.error;
    }
  } else if (!isBaileys && hasCloudApi() && channel?.phone_number_id && to) {
    const res = await sendCloudText(channel.phone_number_id, to, parsed.data.body);
    if (res.ok) {
      waMessageId = res.waMessageId;
    } else {
      status = "fallido";
      errorDetail = res.error;
    }
  } else {
    // sin canal conectado el mensaje queda registrado igual (modo simulado)
    simulated = true;
  }

  // El trigger de DB actualiza last_message_at / preview de la conversación.
  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      agency_id: agency.id,
      conversation_id: conversation.id,
      direction: "out",
      kind: "texto",
      body: parsed.data.body,
      sent_by: member.id,
      status,
      wa_message_id: waMessageId,
      error_detail: errorDetail,
      metadata: simulated ? { simulated: true } : {},
    })
    .select("id, status, created_at")
    .single();
  if (error || !message) return fail("No se pudo enviar. Revisá tu conexión y probá de nuevo.");

  if (status === "fallido") {
    return fail(errorDetail ?? "WhatsApp rechazó el mensaje. Probá de nuevo.");
  }

  // Sin revalidatePath: el hilo ya se actualiza optimista + realtime.
  return succeed({ id: message.id, status: message.status, createdAt: message.created_at });
}

/* ───────────────────────────────────────────
   deriveToBranch — pasar la consulta del número
   madre al número de una sucursal.
   Abre (o reusa) el hilo de ese número, mueve el
   lead y avisa a los operadores.
   ─────────────────────────────────────────── */

const deriveSchema = z.object({
  conversationId: z.string().uuid(),
  branchId: z.string().uuid(),
});

export async function deriveToBranch(input: {
  conversationId: string;
  branchId: string;
}): Promise<ActionResult<{ conversationId: string; branchName: string }>> {
  const parsed = deriveSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, member, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail("La derivación a sucursales la maneja un admin.");

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, contact_id, wa_id, contact:contacts(id, full_name, phone)")
    .eq("id", parsed.data.conversationId)
    .maybeSingle();
  if (!conversation) return fail("No encontramos la conversación.");

  const { data: branch } = await supabase
    .from("branches")
    .select("id, name")
    .eq("id", parsed.data.branchId)
    .eq("agency_id", agency.id)
    .maybeSingle();
  if (!branch) return fail("Esa sucursal no existe.");

  const { data: channel } = await supabase
    .from("wa_channels")
    .select("id, status")
    .eq("branch_id", branch.id)
    .eq("kind", "baileys")
    .maybeSingle();
  if (!channel) return fail("La sucursal no tiene número de WhatsApp configurado.");

  /* hilo de la sucursal: existente o nuevo */
  let targetId: string;
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("agency_id", agency.id)
    .eq("contact_id", conversation.contact_id)
    .eq("channel", "whatsapp")
    .eq("channel_id", channel.id)
    .maybeSingle();

  if (existing) {
    targetId = existing.id;
    await supabase
      .from("conversations")
      .update({ branch_id: branch.id, status: "abierta" })
      .eq("id", targetId);
  } else {
    const { data: created, error } = await supabase
      .from("conversations")
      .insert({
        agency_id: agency.id,
        contact_id: conversation.contact_id,
        channel: "whatsapp",
        channel_id: channel.id,
        branch_id: branch.id,
        wa_id: conversation.contact?.phone ?? conversation.wa_id,
        origin_conversation_id: conversation.id,
      })
      .select("id")
      .single();
    if (error || !created) return fail("No se pudo abrir el chat en la sucursal.");
    targetId = created.id;
  }

  await supabase
    .from("conversations")
    .update({ branch_id: branch.id })
    .eq("id", conversation.id);

  /* el lead abierto del contacto se muda con la consulta */
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("agency_id", agency.id)
    .eq("contact_id", conversation.contact_id)
    .in("stage", ["nuevo", "contactado", "presupuestado", "negociacion"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lead) {
    await supabase.from("leads").update({ branch_id: branch.id }).eq("id", lead.id);
  }

  await alertBranchOperators(supabase, {
    agencyId: agency.id,
    branchId: branch.id,
    contactName: conversation.contact?.full_name ?? "Consulta",
    contactPhone: conversation.contact?.phone ?? conversation.wa_id,
    text: "Consulta derivada desde el número madre.",
    conversationId: targetId,
    leadId: lead?.id ?? null,
  });

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    contactId: conversation.contact_id,
    leadId: lead?.id ?? null,
    type: "whatsapp",
    body: `Consulta derivada a ${branch.name}`,
  });

  revalidatePath("/crm");
  return succeed({ conversationId: targetId, branchName: branch.name });
}

/* ───────────────────────────────────────────
   sendTemplate — plantilla aprobada (única vía
   fuera de la ventana de 24 hs). Recibe el body
   ya interpolado con fillTemplate en el cliente.
   ─────────────────────────────────────────── */

const templateSchema = z.object({
  conversationId: z.string().uuid(),
  templateId: z.string().uuid(),
  body: z.string().trim().min(1).max(4096),
});

export async function sendTemplate(input: {
  conversationId: string;
  templateId: string;
  body: string;
}): Promise<ActionResult<SentMessage>> {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, member, agency } = await requireAction();

  const { data: conversation } = await supabase
    .from("conversations")
    .select(CONVERSATION_WITH_CHANNEL)
    .eq("id", parsed.data.conversationId)
    .maybeSingle();
  if (!conversation) return fail("No encontramos la conversación.");

  const { data: template } = await supabase
    .from("wa_templates")
    .select("id, meta_name, is_approved")
    .eq("id", parsed.data.templateId)
    .maybeSingle();
  if (!template) return fail("No encontramos la plantilla.");
  if (!template.is_approved) return fail("Esa plantilla todavía no está aprobada por Meta.");

  const channel = conversation.channel_ref;
  const to = conversation.contact?.phone ?? conversation.wa_id;

  let status: MessageStatus = "enviado";
  let waMessageId: string | null = null;
  let errorDetail: string | null = null;
  let simulated = false;

  if (channel?.kind === "baileys" && hasWorker() && to) {
    // por el número de la sucursal no hace falta plantilla: va como texto
    if (channel.status !== "conectado") {
      return fail("El WhatsApp de esa sucursal no está vinculado.");
    }
    const res = await sendViaBaileys(channel.id, to, parsed.data.body);
    if (res.ok) waMessageId = res.data.waMessageId;
    else {
      status = "fallido";
      errorDetail = res.error;
    }
  } else if (hasCloudApi() && channel?.phone_number_id && to) {
    const res = await sendCloudTemplate(channel.phone_number_id, to, template.meta_name);
    if (res.ok) waMessageId = res.waMessageId;
    else {
      status = "fallido";
      errorDetail = res.error;
    }
  } else {
    simulated = true;
  }

  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      agency_id: agency.id,
      conversation_id: conversation.id,
      direction: "out",
      kind: "plantilla",
      body: parsed.data.body,
      template_name: template.meta_name,
      sent_by: member.id,
      status,
      wa_message_id: waMessageId,
      error_detail: errorDetail,
      metadata: simulated
        ? { simulated: true, template_id: template.id }
        : { template_id: template.id },
    })
    .select("id, status, created_at")
    .single();
  if (error || !message) return fail("No se pudo enviar la plantilla. Probá de nuevo.");

  if (status === "fallido") {
    return fail(errorDetail ?? "WhatsApp rechazó la plantilla. Probá de nuevo.");
  }

  // Sin revalidatePath: el hilo ya se actualiza optimista + realtime.
  return succeed({ id: message.id, status: message.status, createdAt: message.created_at });
}

/* ───────────────────────────────────────────
   markConversationRead — al abrir el hilo
   ─────────────────────────────────────────── */

const readSchema = z.object({ conversationId: z.string().uuid() });

export async function markConversationRead(input: {
  conversationId: string;
}): Promise<ActionResult<null>> {
  const parsed = readSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase } = await requireAction();

  const { error } = await supabase
    .from("conversations")
    .update({ unread_count: 0 })
    .eq("id", parsed.data.conversationId);
  if (error) return fail("No se pudo marcar como leída.");
  return succeed(null);
}

/* ───────────────────────────────────────────
   assignConversation — asignar / desasignar vendedor
   ─────────────────────────────────────────── */

const assignSchema = z.object({
  conversationId: z.string().uuid(),
  memberId: z.string().uuid().nullable(),
});

export async function assignConversation(input: {
  conversationId: string;
  memberId: string | null;
}): Promise<ActionResult<null>> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, agency, isAdmin } = await requireAction();
  // misma regla que reassignLead: repartir el trabajo lo hace un admin
  if (!isAdmin) return fail("La asignación de vendedores la maneja un admin.");

  // No confiar en el memberId del cliente: tiene que ser de la misma agencia.
  if (parsed.data.memberId) {
    const { data: target } = await supabase
      .from("members")
      .select("id")
      .eq("id", parsed.data.memberId)
      .eq("agency_id", agency.id)
      .maybeSingle();
    if (!target) return fail("Vendedor inválido.");
  }

  const { error } = await supabase
    .from("conversations")
    .update({ assigned_to: parsed.data.memberId })
    .eq("id", parsed.data.conversationId);
  if (error) return fail("No se pudo asignar la conversación.");

  revalidatePath("/crm");
  return succeed(null);
}

/* ───────────────────────────────────────────
   closeConversation
   ─────────────────────────────────────────── */

const closeSchema = z.object({ conversationId: z.string().uuid() });

export async function closeConversation(input: {
  conversationId: string;
}): Promise<ActionResult<null>> {
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, member, agency } = await requireAction();

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, contact_id")
    .eq("id", parsed.data.conversationId)
    .maybeSingle();
  if (!conversation) return fail("No encontramos la conversación.");

  const { error } = await supabase
    .from("conversations")
    .update({ status: "cerrada" })
    .eq("id", conversation.id);
  if (error) return fail("No se pudo cerrar la conversación.");

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    contactId: conversation.contact_id,
    type: "whatsapp",
    body: "Conversación de WhatsApp cerrada",
  });

  revalidatePath("/crm");
  return succeed(null);
}
