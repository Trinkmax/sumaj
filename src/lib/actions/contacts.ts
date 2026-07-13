"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  requireAction,
  succeed,
  fail,
  logActivity,
  ensureConversation,
  type ActionResult,
} from "@/lib/actions/core";
import { normalizePhone } from "@/lib/format";
import type { Tables, TablesUpdate } from "@/lib/types";

const CHANNEL_KEYS = [
  "whatsapp",
  "instagram",
  "messenger",
  "lead_form",
  "web",
  "referido",
  "manual",
] as const;

const DOC_TYPE_KEYS = ["dni", "pasaporte", "visa", "otro"] as const;

/* ───────────────────────────────────────────
   Contactos
   ─────────────────────────────────────────── */

const createContactSchema = z.object({
  fullName: z.string().trim().min(2, "Poné el nombre completo."),
  phone: z.string().trim().optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  city: z.string().trim().optional(),
  source: z.enum(CHANNEL_KEYS).default("manual"),
});

export async function createContact(
  input: z.input<typeof createContactSchema>,
): Promise<ActionResult<{ contactId: string }>> {
  const parsed = createContactSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos. Revisá el nombre y el email.");
  const { supabase, member, agency } = await requireAction();

  const phone = parsed.data.phone ? normalizePhone(parsed.data.phone) : null;

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      agency_id: agency.id,
      full_name: parsed.data.fullName,
      phone: phone || null,
      email: parsed.data.email || null,
      city: parsed.data.city || null,
      source: parsed.data.source,
    })
    .select("id")
    .single();

  if (error || !data) return fail("No se pudo crear el contacto. Probá de nuevo.");

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    contactId: data.id,
    type: "sistema",
    body: `Contacto creado por ${member.display_name}`,
  });

  revalidatePath("/clientes");
  return succeed({ contactId: data.id });
}

const updateContactSchema = z.object({
  contactId: z.uuid(),
  fullName: z.string().trim().min(2).optional(),
  phone: z.string().trim().nullable().optional(),
  email: z.string().trim().email().nullable().optional().or(z.literal("")),
  instagram: z.string().trim().nullable().optional(),
  city: z.string().trim().nullable().optional(),
  address: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
  documentType: z.enum(DOC_TYPE_KEYS).nullable().optional(),
  documentNumber: z.string().trim().nullable().optional(),
  birthDate: z.string().nullable().optional(),
});

export async function updateContact(
  input: z.input<typeof updateContactSchema>,
): Promise<ActionResult<null>> {
  const parsed = updateContactSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase } = await requireAction();
  const d = parsed.data;

  const patch: TablesUpdate<"contacts"> = {};
  if (d.fullName !== undefined) patch.full_name = d.fullName;
  if (d.phone !== undefined) patch.phone = d.phone ? normalizePhone(d.phone) : null;
  if (d.email !== undefined) patch.email = d.email || null;
  if (d.instagram !== undefined) patch.instagram = d.instagram || null;
  if (d.city !== undefined) patch.city = d.city || null;
  if (d.address !== undefined) patch.address = d.address || null;
  if (d.notes !== undefined) patch.notes = d.notes || null;
  if (d.documentType !== undefined) patch.document_type = d.documentType;
  if (d.documentNumber !== undefined) patch.document_number = d.documentNumber || null;
  if (d.birthDate !== undefined) patch.birth_date = d.birthDate || null;

  const { error } = await supabase.from("contacts").update(patch).eq("id", d.contactId);
  if (error) return fail("No se pudieron guardar los cambios.");

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${d.contactId}`);
  return succeed(null);
}

/* ───────────────────────────────────────────
   Grupo de viaje (travelers)
   ─────────────────────────────────────────── */

const travelerFields = {
  fullName: z.string().trim().min(2, "Poné el nombre."),
  relationship: z.string().trim().nullable().optional(),
  documentType: z.enum(DOC_TYPE_KEYS).nullable().optional(),
  documentNumber: z.string().trim().nullable().optional(),
  documentExpiry: z.string().nullable().optional(),
  birthDate: z.string().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
};

const addTravelerSchema = z.object({ contactId: z.uuid(), ...travelerFields });

export async function addTraveler(
  input: z.input<typeof addTravelerSchema>,
): Promise<ActionResult<{ travelerId: string }>> {
  const parsed = addTravelerSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos. Revisá el nombre.");
  const { supabase, agency } = await requireAction();
  const d = parsed.data;

  const { data, error } = await supabase
    .from("travelers")
    .insert({
      agency_id: agency.id,
      contact_id: d.contactId,
      full_name: d.fullName,
      relationship: d.relationship || null,
      document_type: d.documentType ?? null,
      document_number: d.documentNumber || null,
      document_expiry: d.documentExpiry || null,
      birth_date: d.birthDate || null,
      notes: d.notes || null,
    })
    .select("id")
    .single();

  if (error || !data) return fail("No se pudo agregar el pasajero.");

  revalidatePath(`/clientes/${d.contactId}`);
  revalidatePath("/clientes");
  return succeed({ travelerId: data.id });
}

const updateTravelerSchema = z.object({
  travelerId: z.uuid(),
  contactId: z.uuid(),
  ...travelerFields,
});

export async function updateTraveler(
  input: z.input<typeof updateTravelerSchema>,
): Promise<ActionResult<null>> {
  const parsed = updateTravelerSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos. Revisá el nombre.");
  const { supabase } = await requireAction();
  const d = parsed.data;

  const { error } = await supabase
    .from("travelers")
    .update({
      full_name: d.fullName,
      relationship: d.relationship || null,
      document_type: d.documentType ?? null,
      document_number: d.documentNumber || null,
      document_expiry: d.documentExpiry || null,
      birth_date: d.birthDate || null,
      notes: d.notes || null,
    })
    .eq("id", d.travelerId);

  if (error) return fail("No se pudieron guardar los cambios.");

  revalidatePath(`/clientes/${d.contactId}`);
  revalidatePath("/clientes");
  return succeed(null);
}

const promoteTravelerSchema = z.object({ travelerId: z.uuid() });

/**
 * Promueve un pasajero del grupo de viaje a contacto con ficha propia.
 * Crea el contacto con los datos del traveler, setea linked_contact_id
 * y deja rastro en el historial de ambas fichas. Idempotente: si ya
 * tiene ficha vinculada, devuelve esa.
 */
export async function promoteTravelerToContact(
  input: z.input<typeof promoteTravelerSchema>,
): Promise<ActionResult<{ contactId: string }>> {
  const parsed = promoteTravelerSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, member, agency } = await requireAction();

  const { data: traveler, error: travelerError } = await supabase
    .from("travelers")
    .select("*, owner:contacts!travelers_contact_id_fkey(id, full_name)")
    .eq("id", parsed.data.travelerId)
    .maybeSingle();

  if (travelerError || !traveler) return fail("No encontramos al pasajero.");
  if (traveler.linked_contact_id) {
    // ya tiene ficha propia: navegamos a esa
    return succeed({ contactId: traveler.linked_contact_id });
  }

  const { data: contact, error: contactError } = await supabase
    .from("contacts")
    .insert({
      agency_id: agency.id,
      full_name: traveler.full_name,
      birth_date: traveler.birth_date,
      document_type: traveler.document_type,
      document_number: traveler.document_number,
      notes: traveler.notes,
      source: "manual",
    })
    .select("id")
    .single();

  if (contactError || !contact) return fail("No se pudo crear la ficha. Probá de nuevo.");

  // vínculo condicional: si otra llamada concurrente ya lo linkeó, esta pierde
  // (0 filas) y borramos la ficha duplicada que acabamos de crear.
  const { data: linked, error: linkError } = await supabase
    .from("travelers")
    .update({ linked_contact_id: contact.id })
    .eq("id", traveler.id)
    .is("linked_contact_id", null)
    .select("id");

  if (linkError || !linked || linked.length === 0) {
    await supabase.from("contacts").delete().eq("id", contact.id);
    if (linkError) return fail("No se pudo vincular la ficha. Probá de nuevo.");
    const { data: again } = await supabase
      .from("travelers")
      .select("linked_contact_id")
      .eq("id", traveler.id)
      .maybeSingle();
    if (again?.linked_contact_id) return succeed({ contactId: again.linked_contact_id });
    return fail("No se pudo vincular la ficha. Probá de nuevo.");
  }

  const ownerName = traveler.owner?.full_name ?? "otro contacto";
  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    contactId: contact.id,
    type: "sistema",
    body: `Ficha creada desde el grupo de viaje de ${ownerName}`,
  });
  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    contactId: traveler.contact_id,
    type: "sistema",
    body: `${traveler.full_name} ahora tiene ficha propia`,
  });

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${traveler.contact_id}`);
  revalidatePath(`/clientes/${contact.id}`);
  return succeed({ contactId: contact.id });
}

const deleteTravelerSchema = z.object({ travelerId: z.uuid(), contactId: z.uuid() });

export async function deleteTraveler(
  input: z.input<typeof deleteTravelerSchema>,
): Promise<ActionResult<null>> {
  const parsed = deleteTravelerSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase } = await requireAction();

  const { error } = await supabase.from("travelers").delete().eq("id", parsed.data.travelerId);
  if (error) return fail("No se pudo eliminar el pasajero.");

  revalidatePath(`/clientes/${parsed.data.contactId}`);
  revalidatePath("/clientes");
  return succeed(null);
}

/* ───────────────────────────────────────────
   Etiquetas
   ─────────────────────────────────────────── */

const contactTagSchema = z.object({ contactId: z.uuid(), tagId: z.uuid() });

export async function addContactTag(
  input: z.input<typeof contactTagSchema>,
): Promise<ActionResult<null>> {
  const parsed = contactTagSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, agency } = await requireAction();

  const { error } = await supabase.from("contact_tags").insert({
    agency_id: agency.id,
    contact_id: parsed.data.contactId,
    tag_id: parsed.data.tagId,
  });
  if (error) return fail("No se pudo agregar la etiqueta.");

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${parsed.data.contactId}`);
  return succeed(null);
}

export async function removeContactTag(
  input: z.input<typeof contactTagSchema>,
): Promise<ActionResult<null>> {
  const parsed = contactTagSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase } = await requireAction();

  const { error } = await supabase
    .from("contact_tags")
    .delete()
    .eq("contact_id", parsed.data.contactId)
    .eq("tag_id", parsed.data.tagId);
  if (error) return fail("No se pudo quitar la etiqueta.");

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${parsed.data.contactId}`);
  return succeed(null);
}

const createTagSchema = z.object({
  contactId: z.uuid(),
  name: z.string().trim().min(1, "Poné un nombre."),
  category: z.string().trim().min(1),
  color: z.string().trim().min(1),
});

/** Crea una etiqueta nueva y se la asigna al contacto en un solo paso. */
export async function createTagForContact(
  input: z.input<typeof createTagSchema>,
): Promise<ActionResult<{ tag: Tables<"tags"> }>> {
  const parsed = createTagSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos. Poné un nombre para la etiqueta.");
  const { supabase, agency } = await requireAction();
  const d = parsed.data;

  const { data: tag, error } = await supabase
    .from("tags")
    .insert({
      agency_id: agency.id,
      name: d.name,
      category: d.category,
      color: d.color,
    })
    .select("*")
    .single();

  if (error || !tag) return fail("No se pudo crear la etiqueta.");

  const { error: linkError } = await supabase.from("contact_tags").insert({
    agency_id: agency.id,
    contact_id: d.contactId,
    tag_id: tag.id,
  });
  if (linkError) return fail("Se creó la etiqueta pero no se pudo asignar.");

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${d.contactId}`);
  return succeed({ tag });
}

/* ───────────────────────────────────────────
   Notas / historial
   ─────────────────────────────────────────── */

const noteSchema = z.object({
  contactId: z.uuid(),
  body: z.string().trim().min(1, "Escribí algo primero."),
});

export async function addContactNote(
  input: z.input<typeof noteSchema>,
): Promise<ActionResult<null>> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return fail("Escribí algo primero.");
  const { supabase, member, agency } = await requireAction();

  const { error } = await supabase.from("activities").insert({
    agency_id: agency.id,
    member_id: member.id,
    contact_id: parsed.data.contactId,
    type: "nota",
    body: parsed.data.body,
  });
  if (error) return fail("No se pudo guardar la nota. Probá de nuevo.");

  revalidatePath(`/clientes/${parsed.data.contactId}`);
  return succeed(null);
}

/* ───────────────────────────────────────────
   Nueva consulta (lead) para el contacto
   ─────────────────────────────────────────── */

const createLeadSchema = z.object({
  contactId: z.uuid(),
  destination: z.string().trim().optional(),
});

export async function createLeadForContact(
  input: z.input<typeof createLeadSchema>,
): Promise<ActionResult<{ leadId: string }>> {
  const parsed = createLeadSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, member, agency } = await requireAction();
  const d = parsed.data;

  // al final de la columna "nuevo" del kanban
  const { data: top } = await supabase
    .from("leads")
    .select("position")
    .eq("agency_id", agency.id)
    .eq("stage", "nuevo")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      agency_id: agency.id,
      contact_id: d.contactId,
      stage: "nuevo",
      origin_channel: "manual",
      assigned_to: member.id,
      destination: d.destination || null,
      position: (Number(top?.position) || 0) + 1000,
    })
    .select("id")
    .single();

  if (error || !lead) return fail("No se pudo crear la consulta. Probá de nuevo.");

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    contactId: d.contactId,
    leadId: lead.id,
    type: "sistema",
    body: d.destination
      ? `Nueva consulta creada: ${d.destination}`
      : "Nueva consulta creada",
  });

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${d.contactId}`);
  revalidatePath("/crm");
  return succeed({ leadId: lead.id });
}

/* ───────────────────────────────────────────
   Chat: abre (o crea) la conversación del contacto
   ─────────────────────────────────────────── */

const openChatSchema = z.object({ contactId: z.uuid() });

export async function openContactChat(
  input: z.input<typeof openChatSchema>,
): Promise<ActionResult<{ conversationId: string }>> {
  const parsed = openChatSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  return ensureConversation(parsed.data.contactId);
}
