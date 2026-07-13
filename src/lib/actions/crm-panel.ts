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
import type { MessageStatus } from "@/lib/types";

export type SentNote = { id: string; status: MessageStatus; createdAt: string };

/* ───────────────────────────────────────────
   sendInternalNote — nota interna en el hilo.
   Se guarda como mensaje kind "nota_interna": vive en la
   conversación pero NUNCA sale por WhatsApp, así que no
   valida ventana de 24 hs ni estado de conexión.
   ─────────────────────────────────────────── */

const noteSchema = z.object({
  conversationId: z.uuid(),
  body: z.string().trim().min(1).max(4096),
});

export async function sendInternalNote(input: {
  conversationId: string;
  body: string;
}): Promise<ActionResult<SentNote>> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return fail("La nota está vacía o es demasiado larga.");
  const { supabase, member, agency } = await requireAction();

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, contact_id")
    .eq("id", parsed.data.conversationId)
    .maybeSingle();
  if (!conversation) return fail("No encontramos la conversación.");

  // El trigger de DB actualiza last_message_at / preview de la conversación.
  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      agency_id: agency.id,
      conversation_id: conversation.id,
      direction: "out",
      kind: "nota_interna",
      body: parsed.data.body,
      sent_by: member.id,
      // interna: nunca viaja a Meta, queda "enviado" directo
      status: "enviado",
      metadata: { internal: true },
    })
    .select("id, status, created_at")
    .single();
  if (error || !message) return fail("No se pudo guardar la nota. Probá de nuevo.");

  // también queda en el historial del contacto (best-effort)
  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    contactId: conversation.contact_id,
    type: "nota",
    body: parsed.data.body,
    metadata: { source: "chat" },
  });

  // Sin revalidatePath: el hilo se actualiza optimista + realtime.
  return succeed({ id: message.id, status: message.status, createdAt: message.created_at });
}

/* ───────────────────────────────────────────
   toggleFollowups — pausar / reactivar el
   seguimiento automático de un lead desde el chat.
   ─────────────────────────────────────────── */

const followupsSchema = z.object({
  leadId: z.uuid(),
  paused: z.boolean(),
});

export async function toggleFollowups(input: {
  leadId: string;
  paused: boolean;
}): Promise<ActionResult<null>> {
  const parsed = followupsSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, member, agency } = await requireAction();

  const { data: lead } = await supabase
    .from("leads")
    .select("id, contact_id")
    .eq("id", parsed.data.leadId)
    .maybeSingle();
  if (!lead) return fail("Lead no encontrado.");

  const { error } = await supabase
    .from("leads")
    .update({ followups_paused: parsed.data.paused })
    .eq("id", lead.id);
  if (error) return fail("No se pudo cambiar el seguimiento automático.");

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    leadId: lead.id,
    contactId: lead.contact_id,
    type: "sistema",
    body: parsed.data.paused
      ? "Seguimiento automático pausado"
      : "Seguimiento automático reactivado",
  });

  revalidatePath("/crm");
  return succeed(null);
}
