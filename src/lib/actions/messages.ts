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
import type { AgencySettings, MessageStatus } from "@/lib/types";

const WINDOW_MS = 24 * 60 * 60 * 1000;

function isWaConnected(settings: unknown): boolean {
  const s = (settings ?? {}) as Partial<AgencySettings>;
  return s.whatsapp?.connected === true;
}

export type SentMessage = { id: string; status: MessageStatus; createdAt: string };

/* ───────────────────────────────────────────
   sendMessage — texto libre, solo dentro de la
   ventana de 24 hs desde el último mensaje entrante.
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
    .select("id, last_inbound_at")
    .eq("id", parsed.data.conversationId)
    .maybeSingle();
  if (!conversation) return fail("No encontramos la conversación.");

  const inWindow =
    conversation.last_inbound_at != null &&
    Date.now() - new Date(conversation.last_inbound_at).getTime() < WINDOW_MS;
  if (!inWindow)
    return fail("Fuera de la ventana de 24 hs. Solo se pueden enviar plantillas aprobadas.");

  const connected = isWaConnected(agency.settings);

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
      // Sin Cloud API conectada el envío es simulado y queda "enviado" directo.
      // Con la API conectada queda "pendiente" hasta que la capa de envío confirme.
      status: connected ? "pendiente" : "enviado",
      metadata: connected ? {} : { simulated: true },
    })
    .select("id, status, created_at")
    .single();
  if (error || !message) return fail("No se pudo enviar. Revisá tu conexión y probá de nuevo.");

  // PUNTO DE EXTENSIÓN — WhatsApp Cloud API:
  // cuando agency.settings.whatsapp.connected sea true, acá va el POST a
  // graph.facebook.com/v-latest/{phone_number_id}/messages con el body,
  // persistiendo wa_message_id y actualizando status a "enviado"
  // (o "fallido" + error_detail). Lo agrega la capa de integración.

  // Sin revalidatePath: el hilo ya se actualiza optimista + realtime.
  return succeed({ id: message.id, status: message.status, createdAt: message.created_at });
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
    .select("id")
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

  const connected = isWaConnected(agency.settings);

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
      status: connected ? "pendiente" : "enviado",
      metadata: connected
        ? { template_id: template.id }
        : { simulated: true, template_id: template.id },
    })
    .select("id, status, created_at")
    .single();
  if (error || !message) return fail("No se pudo enviar la plantilla. Probá de nuevo.");

  // PUNTO DE EXTENSIÓN — WhatsApp Cloud API: envío real del template
  // (type: "template", name: meta_name, components con las variables).
  // Lo agrega la capa de integración; el flujo ya queda registrado acá.

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
  const { supabase, agency } = await requireAction();

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
