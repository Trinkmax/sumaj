"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  requireAction,
  succeed,
  fail,
  logActivity,
  ensureConversation,
  convertLeadToSale,
  type ActionResult,
} from "@/lib/actions/core";
import { CHANNELS, STAGE_BY_KEY } from "@/lib/domain";
import { normalizePhone } from "@/lib/format";
import type { LeadStage } from "@/lib/types";

const LEAD_STAGES = [
  "nuevo",
  "contactado",
  "presupuestado",
  "negociacion",
  "ganado",
  "perdido",
] as const;
const LEAD_CHANNELS = [
  "whatsapp",
  "instagram",
  "messenger",
  "lead_form",
  "web",
  "referido",
  "manual",
] as const;
const TRIP_TYPES_KEYS = ["familiar", "pareja", "grupal", "corporativo", "solo"] as const;

/** La asignación de vendedores la maneja un admin (pedido del dueño). */
const ASSIGN_ADMIN_ONLY = "La asignación de vendedores la maneja un admin.";

function revalidateLead(leadId?: string) {
  revalidatePath("/crm");
  if (leadId) revalidatePath(`/crm/${leadId}`);
}

/** Posición nueva arriba de todo en una columna: min − 1 (0 si está vacía). */
async function topPosition(
  supabase: Awaited<ReturnType<typeof requireAction>>["supabase"],
  stage: LeadStage,
  excludeLeadId?: string,
): Promise<number> {
  let query = supabase
    .from("leads")
    .select("position")
    .eq("stage", stage)
    .order("position", { ascending: true })
    .limit(1);
  if (excludeLeadId) query = query.neq("id", excludeLeadId);
  const { data } = await query;
  return data && data.length > 0 ? Number(data[0].position) - 1 : 0;
}

/* ───────────────────────────────────────────
   Dedupe de contacto por teléfono (para el dialog Nuevo lead)
   ─────────────────────────────────────────── */
const findContactSchema = z.object({ phone: z.string().min(6) });

export async function findContactByPhone(input: {
  phone: string;
}): Promise<ActionResult<{ id: string; full_name: string } | null>> {
  const parsed = findContactSchema.safeParse(input);
  if (!parsed.success) return succeed(null);
  const { supabase } = await requireAction();

  const phone = normalizePhone(parsed.data.phone);
  if (phone.length < 8) return succeed(null);

  const { data } = await supabase
    .from("contacts")
    .select("id, full_name")
    .eq("phone", phone)
    .limit(1);

  return succeed(data && data.length > 0 ? data[0] : null);
}

/* ───────────────────────────────────────────
   Crear lead (regla de oro: < 30 segundos)
   ─────────────────────────────────────────── */
const createLeadSchema = z.object({
  fullName: z.string().trim().min(2, "El nombre es muy corto").max(120),
  phone: z.string().trim().max(30).optional().nullable(),
  destination: z.string().trim().max(120).optional().nullable(),
  channel: z.enum(LEAD_CHANNELS),
  assignedTo: z.uuid().optional().nullable(),
  initialMessage: z.string().trim().max(2000).optional().nullable(),
});

export async function createLead(
  input: z.infer<typeof createLeadSchema>,
): Promise<
  ActionResult<{
    leadId: string;
    contactId: string;
    position: number;
    existingContact: boolean;
    /** a quién quedó asignado de verdad (el no-admin siempre a sí mismo) */
    assignedTo: string;
  }>
> {
  const parsed = createLeadSchema.safeParse(input);
  if (!parsed.success) return fail("Revisá los datos: el nombre es obligatorio.");
  const { supabase, agency, member, isAdmin } = await requireAction();
  const data = parsed.data;

  // solo el admin reparte leads: el resto se queda con el suyo
  const assignedTo = isAdmin ? (data.assignedTo ?? member.id) : member.id;

  /* Sucursal dueña del lead: la del vendedor; si trabaja en todas (admins),
     la sucursal por defecto. Sin sucursal el seguimiento automático no puede
     salir por el número de la sucursal y volvería a caer en plantillas pagas. */
  let branchId = member.branch_id;
  if (!branchId) {
    const { data: defaultBranch } = await supabase
      .from("branches")
      .select("id")
      .eq("agency_id", agency.id)
      .eq("is_default", true)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    branchId = defaultBranch?.id ?? null;
  }

  // contacto: dedupe por teléfono dentro de la agencia (RLS filtra)
  let contactId: string | null = null;
  let existingContact = false;
  const phone = data.phone ? normalizePhone(data.phone) : null;

  if (phone && phone.length >= 8) {
    const { data: found } = await supabase
      .from("contacts")
      .select("id")
      .eq("phone", phone)
      .limit(1);
    if (found && found.length > 0) {
      contactId = found[0].id;
      existingContact = true;
    }
  }

  if (!contactId) {
    const { data: created, error: contactError } = await supabase
      .from("contacts")
      .insert({
        agency_id: agency.id,
        full_name: data.fullName,
        phone: phone && phone.length >= 8 ? phone : null,
        source: data.channel,
      })
      .select("id")
      .single();
    if (contactError || !created) return fail("No se pudo crear el contacto.");
    contactId = created.id;
  }

  const position = await topPosition(supabase, "nuevo");

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      agency_id: agency.id,
      contact_id: contactId,
      branch_id: branchId,
      stage: "nuevo",
      position,
      destination: data.destination || null,
      origin_channel: data.channel,
      assigned_to: assignedTo,
      initial_message: data.initialMessage || null,
    })
    .select("id")
    .single();

  if (error || !lead) return fail("No se pudo crear el lead. Probá de nuevo.");

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    leadId: lead.id,
    contactId,
    type: "sistema",
    body: `Lead creado desde ${CHANNELS[data.channel].label}`,
  });

  revalidateLead(lead.id);
  return succeed({ leadId: lead.id, contactId, position, existingContact, assignedTo });
}

/* ───────────────────────────────────────────
   Mover de etapa (kanban / stepper)
   ─────────────────────────────────────────── */
const updateStageSchema = z.object({
  leadId: z.uuid(),
  stage: z.enum(LEAD_STAGES),
  position: z.number().optional(),
});

export async function updateLeadStage(
  input: z.infer<typeof updateStageSchema>,
): Promise<ActionResult<null>> {
  const parsed = updateStageSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, agency, member } = await requireAction();
  const { leadId, stage } = parsed.data;

  const { data: lead } = await supabase
    .from("leads")
    .select("id, stage, contact_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return fail("Lead no encontrado.");

  const position =
    parsed.data.position ?? (await topPosition(supabase, stage, leadId));

  const isActive = STAGE_BY_KEY[stage].active;
  const { error } = await supabase
    .from("leads")
    .update({
      stage,
      position,
      closed_at: isActive ? null : new Date().toISOString(),
      ...(isActive ? { lost_reason: null } : {}),
    })
    .eq("id", leadId);

  if (error) return fail("No se pudo mover el lead.");

  if (lead.stage !== stage) {
    await logActivity({
      agencyId: agency.id,
      memberId: member.id,
      leadId,
      contactId: lead.contact_id,
      type: "etapa",
      body: `Etapa: ${STAGE_BY_KEY[lead.stage as LeadStage].label} → ${STAGE_BY_KEY[stage].label}`,
    });
  }

  revalidateLead(leadId);
  return succeed(null);
}

/* ───────────────────────────────────────────
   Reordenar dentro de la columna (fractional index)
   ─────────────────────────────────────────── */
const reorderSchema = z.object({ leadId: z.uuid(), position: z.number() });

export async function reorderLead(
  input: z.infer<typeof reorderSchema>,
): Promise<ActionResult<null>> {
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase } = await requireAction();

  const { error } = await supabase
    .from("leads")
    .update({ position: parsed.data.position })
    .eq("id", parsed.data.leadId);
  if (error) return fail("No se pudo reordenar.");

  revalidatePath("/crm");
  return succeed(null);
}

/* ───────────────────────────────────────────
   Datos del viaje
   ─────────────────────────────────────────── */
const detailsSchema = z.object({
  leadId: z.uuid(),
  destination: z.string().trim().max(120).nullable(),
  tripDateFrom: z.string().nullable(),
  tripDateTo: z.string().nullable(),
  paxAdults: z.number().int().min(0).max(99),
  paxChildren: z.number().int().min(0).max(99),
  tripType: z.enum(TRIP_TYPES_KEYS).nullable(),
  budgetEstimate: z.number().min(0).nullable(),
  budgetCurrency: z.enum(["USD", "ARS"]),
});

export async function updateLeadDetails(
  input: z.infer<typeof detailsSchema>,
): Promise<ActionResult<null>> {
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) return fail("Revisá los datos del viaje.");
  const { supabase } = await requireAction();
  const d = parsed.data;

  const { error } = await supabase
    .from("leads")
    .update({
      destination: d.destination || null,
      trip_date_from: d.tripDateFrom || null,
      trip_date_to: d.tripDateTo || null,
      pax_adults: d.paxAdults,
      pax_children: d.paxChildren,
      trip_type: d.tripType,
      budget_estimate: d.budgetEstimate,
      budget_currency: d.budgetCurrency,
    })
    .eq("id", d.leadId);

  if (error) return fail("No se pudieron guardar los datos del viaje.");

  revalidateLead(d.leadId);
  return succeed(null);
}

/* ───────────────────────────────────────────
   Próxima acción (seguimiento manual)
   ─────────────────────────────────────────── */
const nextActionSchema = z.object({
  leadId: z.uuid(),
  nextAction: z.string().trim().max(200).nullable(),
  nextActionAt: z.string().nullable(),
});

export async function setNextAction(
  input: z.infer<typeof nextActionSchema>,
): Promise<ActionResult<null>> {
  const parsed = nextActionSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase } = await requireAction();
  const d = parsed.data;

  if (d.nextActionAt && isNaN(new Date(d.nextActionAt).getTime()))
    return fail("La fecha del seguimiento no es válida.");

  const { error } = await supabase
    .from("leads")
    .update({
      next_action: d.nextAction || null,
      next_action_at: d.nextActionAt ? new Date(d.nextActionAt).toISOString() : null,
    })
    .eq("id", d.leadId);

  if (error) return fail("No se pudo guardar el seguimiento.");

  revalidateLead(d.leadId);
  return succeed(null);
}

/* ───────────────────────────────────────────
   Nota rápida en el historial
   ─────────────────────────────────────────── */
const noteSchema = z.object({
  leadId: z.uuid(),
  body: z.string().trim().min(1, "Escribí algo").max(2000),
});

export async function addLeadNote(
  input: z.infer<typeof noteSchema>,
): Promise<ActionResult<{ id: string; created_at: string }>> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return fail("Escribí una nota antes de guardar.");
  const { supabase, agency, member } = await requireAction();

  const { data: lead } = await supabase
    .from("leads")
    .select("contact_id")
    .eq("id", parsed.data.leadId)
    .maybeSingle();
  if (!lead) return fail("Lead no encontrado.");

  const { data, error } = await supabase
    .from("activities")
    .insert({
      agency_id: agency.id,
      member_id: member.id,
      lead_id: parsed.data.leadId,
      contact_id: lead.contact_id,
      type: "nota",
      body: parsed.data.body,
    })
    .select("id, created_at")
    .single();

  if (error || !data) return fail("No se pudo guardar la nota.");

  revalidateLead(parsed.data.leadId);
  return succeed({ id: data.id, created_at: data.created_at });
}

/* ───────────────────────────────────────────
   Reasignar vendedor — SOLO admin.
   El vendedor ve a quién está asignado el lead,
   pero no lo mueve de manos.
   ─────────────────────────────────────────── */
const reassignSchema = z.object({
  leadId: z.uuid(),
  memberId: z.uuid().nullable(),
});

export async function reassignLead(
  input: z.infer<typeof reassignSchema>,
): Promise<ActionResult<null>> {
  const parsed = reassignSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, agency, member, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ASSIGN_ADMIN_ONLY);

  const { leadId, memberId } = parsed.data;

  let assigneeName = "Sin asignar";
  if (memberId) {
    const { data: assignee } = await supabase
      .from("members")
      .select("display_name")
      .eq("id", memberId)
      .maybeSingle();
    if (!assignee) return fail("Vendedor no encontrado.");
    assigneeName = assignee.display_name;
  }

  const { error } = await supabase
    .from("leads")
    .update({ assigned_to: memberId })
    .eq("id", leadId);
  if (error) return fail("No se pudo reasignar el lead.");

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    leadId,
    type: "sistema",
    body: memberId ? `Lead asignado a ${assigneeName}` : "Lead sin asignar",
  });

  revalidateLead(leadId);
  return succeed(null);
}

/* ───────────────────────────────────────────
   Marcar perdido (con motivo)
   ─────────────────────────────────────────── */
const lostSchema = z.object({
  leadId: z.uuid(),
  reason: z.string().trim().max(300).optional().nullable(),
  position: z.number().optional(),
});

export async function markLeadLost(
  input: z.infer<typeof lostSchema>,
): Promise<ActionResult<null>> {
  const parsed = lostSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, agency, member } = await requireAction();
  const { leadId, reason } = parsed.data;

  const { data: lead } = await supabase
    .from("leads")
    .select("id, contact_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return fail("Lead no encontrado.");

  const { error } = await supabase
    .from("leads")
    .update({
      stage: "perdido",
      lost_reason: reason || null,
      closed_at: new Date().toISOString(),
      ...(parsed.data.position != null ? { position: parsed.data.position } : {}),
    })
    .eq("id", leadId);

  if (error) return fail("No se pudo marcar como perdido.");

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    leadId,
    contactId: lead.contact_id,
    type: "etapa",
    body: reason ? `Lead perdido — ${reason}` : "Lead perdido",
  });

  revalidateLead(leadId);
  return succeed(null);
}

/* ───────────────────────────────────────────
   Abrir chat del lead (contrato con módulo chats)
   ─────────────────────────────────────────── */
const chatSchema = z.object({ leadId: z.uuid() });

export async function openLeadChat(
  input: z.infer<typeof chatSchema>,
): Promise<ActionResult<null>> {
  const parsed = chatSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase } = await requireAction();

  const { data: lead } = await supabase
    .from("leads")
    .select("contact_id")
    .eq("id", parsed.data.leadId)
    .maybeSingle();
  if (!lead) return fail("Lead no encontrado.");

  const res = await ensureConversation(lead.contact_id);
  if (!res.ok) return res;

  redirect(`/crm?vista=chats&c=${res.data.conversationId}`);
}

/* ───────────────────────────────────────────
   Conversación del contacto para el chat embebido
   (contrato: wrapper de ensureConversation SIN redirect)
   ─────────────────────────────────────────── */
const conversationSchema = z.object({ contactId: z.uuid() });

export async function getLeadConversationId(input: {
  contactId: string;
}): Promise<ActionResult<{ conversationId: string }>> {
  const parsed = conversationSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");

  const res = await ensureConversation(parsed.data.contactId);
  if (!res.ok) return res;

  revalidatePath("/crm");
  return succeed({ conversationId: res.data.conversationId });
}

/* ───────────────────────────────────────────
   Ganar el lead (contrato: convertLeadToSale de core)
   ─────────────────────────────────────────── */
const winSchema = z.object({ leadId: z.uuid(), quoteId: z.uuid().optional().nullable() });

export async function winLead(
  input: z.infer<typeof winSchema>,
): Promise<ActionResult<{ fileId: string; fileCode: string }>> {
  const parsed = winSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");

  const res = await convertLeadToSale({
    leadId: parsed.data.leadId,
    quoteId: parsed.data.quoteId ?? null,
  });
  if (!res.ok) return res;

  revalidateLead(parsed.data.leadId);
  revalidatePath("/files");
  return res;
}

/* ───────────────────────────────────────────
   Etiquetas del contacto (agregar / quitar)
   ─────────────────────────────────────────── */
const tagSchema = z.object({
  contactId: z.uuid(),
  tagId: z.uuid(),
  on: z.boolean(),
  leadId: z.uuid().optional(),
});

export async function toggleContactTag(
  input: z.infer<typeof tagSchema>,
): Promise<ActionResult<null>> {
  const parsed = tagSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, agency } = await requireAction();
  const { contactId, tagId, on, leadId } = parsed.data;

  if (on) {
    const { error } = await supabase.from("contact_tags").insert({
      agency_id: agency.id,
      contact_id: contactId,
      tag_id: tagId,
    });
    // 23505 = ya estaba etiquetado: lo tomamos como éxito
    if (error && error.code !== "23505") return fail("No se pudo agregar la etiqueta.");
  } else {
    const { error } = await supabase
      .from("contact_tags")
      .delete()
      .eq("contact_id", contactId)
      .eq("tag_id", tagId);
    if (error) return fail("No se pudo quitar la etiqueta.");
  }

  revalidateLead(leadId);
  return succeed(null);
}
