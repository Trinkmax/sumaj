"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  requireAction,
  succeed,
  fail,
  type ActionResult,
} from "@/lib/actions/core";
import { TAG_COLORS, TAG_CATEGORIES } from "@/lib/domain";
import type { AgencySettings, TablesUpdate } from "@/lib/types";
import type { Json } from "@/lib/database.types";

const ADMIN_ONLY = "Esto lo maneja un admin de la agencia.";

/* ───────────────────────────────────────────
   Mi perfil (cualquier miembro)
   ─────────────────────────────────────────── */

const profileSchema = z.object({
  display_name: z.string().trim().min(2, "Muy corto").max(80),
});

export async function updateMyProfile(
  input: z.infer<typeof profileSchema>,
): Promise<ActionResult<null>> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return fail("Poné un nombre válido (mínimo 2 letras).");
  const { supabase, member } = await requireAction();

  const { error } = await supabase
    .from("members")
    .update({ display_name: parsed.data.display_name })
    .eq("id", member.id);
  if (error) return fail("No se pudo guardar tu nombre. Probá de nuevo.");

  revalidatePath("/", "layout");
  return succeed(null);
}

/* ───────────────────────────────────────────
   Agencia (datos + settings jsonb con merge)
   ─────────────────────────────────────────── */

const agencySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.email("Email inválido").nullable().optional().or(z.literal("").transform(() => null)),
  address: z.string().trim().max(200).nullable().optional(),
  logo_url: z.string().max(500).nullable().optional(),
  settings: z
    .object({
      usd_rate: z.number().positive().nullable().optional(),
      quote_theme: z
        .object({ color: z.string().max(30), font: z.string().max(30) })
        .optional(),
      whatsapp: z
        .object({
          phone_number_id: z.string().trim().max(80).nullable().optional(),
          display_number: z.string().trim().max(40).nullable().optional(),
          connected: z.boolean().optional(),
        })
        .optional(),
      quote_saved_notes: z.array(z.string().max(500)).max(30).optional(),
    })
    .optional(),
});

export async function updateAgency(
  input: z.infer<typeof agencySchema>,
): Promise<ActionResult<null>> {
  const parsed = agencySchema.safeParse(input);
  if (!parsed.success) return fail("Revisá los datos: hay algún campo inválido.");
  const { supabase, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const { settings: settingsPatch, ...fields } = parsed.data;

  const update: TablesUpdate<"agencies"> = { ...fields };

  if (settingsPatch) {
    // merge sobre lo que hay guardado, sin pisar claves que no vienen
    const { data: row } = await supabase
      .from("agencies")
      .select("settings")
      .eq("id", agency.id)
      .single();
    const current = ((row?.settings ?? {}) as Partial<AgencySettings>) ?? {};
    const merged: Partial<AgencySettings> = {
      ...current,
      ...(settingsPatch.usd_rate !== undefined && { usd_rate: settingsPatch.usd_rate }),
      ...(settingsPatch.quote_theme && { quote_theme: settingsPatch.quote_theme }),
      ...(settingsPatch.quote_saved_notes && {
        quote_saved_notes: settingsPatch.quote_saved_notes,
      }),
      ...(settingsPatch.whatsapp && {
        whatsapp: {
          phone_number_id:
            settingsPatch.whatsapp.phone_number_id !== undefined
              ? settingsPatch.whatsapp.phone_number_id
              : (current.whatsapp?.phone_number_id ?? null),
          display_number:
            settingsPatch.whatsapp.display_number !== undefined
              ? settingsPatch.whatsapp.display_number
              : (current.whatsapp?.display_number ?? null),
          connected:
            settingsPatch.whatsapp.connected !== undefined
              ? settingsPatch.whatsapp.connected
              : (current.whatsapp?.connected ?? false),
        },
      }),
    };
    update.settings = merged as Json;
  }

  if (Object.keys(update).length === 0) return succeed(null);

  const { error } = await supabase.from("agencies").update(update).eq("id", agency.id);
  if (error) return fail("No se pudieron guardar los cambios de la agencia.");

  revalidatePath("/", "layout");
  return succeed(null);
}

/* ───────────────────────────────────────────
   Equipo
   ─────────────────────────────────────────── */

const roleSchema = z.object({
  memberId: z.uuid(),
  role: z.enum(["admin", "vendedor", "freelance"]),
});

export async function updateMemberRole(
  input: z.infer<typeof roleSchema>,
): Promise<ActionResult<null>> {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, member, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);
  if (parsed.data.memberId === member.id && parsed.data.role !== "admin")
    return fail("No podés quitarte el rol de admin a vos mismo.");

  const { error } = await supabase
    .from("members")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.memberId);
  if (error) return fail("No se pudo cambiar el rol.");

  revalidatePath("/config/equipo");
  return succeed(null);
}

const commissionSchema = z.object({
  memberId: z.uuid(),
  commission_pct: z.number().min(0, "Mínimo 0").max(100, "Máximo 100"),
});

export async function updateMemberCommission(
  input: z.infer<typeof commissionSchema>,
): Promise<ActionResult<null>> {
  const parsed = commissionSchema.safeParse(input);
  if (!parsed.success) return fail("La comisión tiene que estar entre 0 y 100.");
  const { supabase, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const { error } = await supabase
    .from("members")
    .update({ commission_pct: parsed.data.commission_pct })
    .eq("id", parsed.data.memberId);
  if (error) return fail("No se pudo guardar la comisión.");

  revalidatePath("/config/equipo");
  return succeed(null);
}

const activeSchema = z.object({
  memberId: z.uuid(),
  is_active: z.boolean(),
});

export async function toggleMemberActive(
  input: z.infer<typeof activeSchema>,
): Promise<ActionResult<null>> {
  const parsed = activeSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, member, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);
  if (parsed.data.memberId === member.id && !parsed.data.is_active)
    return fail("No podés desactivarte a vos mismo.");

  const { error } = await supabase
    .from("members")
    .update({ is_active: parsed.data.is_active })
    .eq("id", parsed.data.memberId);
  if (error) return fail("No se pudo actualizar el estado.");

  revalidatePath("/config/equipo");
  return succeed(null);
}

/* ───────────────────────────────────────────
   Invitaciones
   ─────────────────────────────────────────── */

const invitationSchema = z.object({
  email: z.email("Email inválido"),
  role: z.enum(["admin", "vendedor", "freelance"]),
  display_name: z.string().trim().max(80).optional(),
  commission_pct: z.number().min(0).max(100).default(0),
});

export async function createInvitation(
  input: z.infer<typeof invitationSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = invitationSchema.safeParse(input);
  if (!parsed.success) return fail("Revisá el email: no parece válido.");
  const { supabase, member, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const email = parsed.data.email.toLowerCase().trim();

  const { data: existingMember } = await supabase
    .from("members")
    .select("id")
    .eq("agency_id", agency.id)
    .eq("email", email)
    .maybeSingle();
  if (existingMember) return fail("Esa persona ya es parte del equipo.");

  const { data: pending } = await supabase
    .from("invitations")
    .select("id")
    .eq("agency_id", agency.id)
    .eq("email", email)
    .is("accepted_at", null)
    .maybeSingle();
  if (pending) return fail("Ya hay una invitación pendiente para ese email.");

  const { data, error } = await supabase
    .from("invitations")
    .insert({
      agency_id: agency.id,
      email,
      role: parsed.data.role,
      display_name: parsed.data.display_name || null,
      commission_pct: parsed.data.commission_pct,
      invited_by: member.id,
    })
    .select("id")
    .single();
  if (error || !data) return fail("No se pudo crear la invitación.");

  revalidatePath("/config/equipo");
  return succeed({ id: data.id });
}

export async function deleteInvitation(input: {
  id: string;
}): Promise<ActionResult<null>> {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const { error } = await supabase.from("invitations").delete().eq("id", parsed.data.id);
  if (error) return fail("No se pudo eliminar la invitación.");

  revalidatePath("/config/equipo");
  return succeed(null);
}

/* ───────────────────────────────────────────
   Etiquetas
   ─────────────────────────────────────────── */

const CATEGORY_KEYS = TAG_CATEGORIES.map((c) => c.key) as [string, ...string[]];

const tagSchema = z.object({
  name: z.string().trim().min(1, "Poné un nombre").max(40),
  category: z.enum(CATEGORY_KEYS),
  color: z.string().refine((c) => c in TAG_COLORS, "Color inválido"),
});

export async function createTag(
  input: z.infer<typeof tagSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = tagSchema.safeParse(input);
  if (!parsed.success) return fail("Revisá el nombre y el color de la etiqueta.");
  const { supabase, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const { data, error } = await supabase
    .from("tags")
    .insert({
      agency_id: agency.id,
      name: parsed.data.name,
      category: parsed.data.category,
      color: parsed.data.color,
    })
    .select("id")
    .single();
  if (error || !data) return fail("No se pudo crear la etiqueta. ¿Ya existe una igual?");

  revalidatePath("/config/etiquetas");
  return succeed({ id: data.id });
}

export async function deleteTag(input: { id: string }): Promise<ActionResult<null>> {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const { error } = await supabase.from("tags").delete().eq("id", parsed.data.id);
  if (error) return fail("No se pudo eliminar la etiqueta.");

  revalidatePath("/config/etiquetas");
  return succeed(null);
}

/* ───────────────────────────────────────────
   Proveedores
   ─────────────────────────────────────────── */

const supplierSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Poné el nombre").max(120),
  website: z.string().trim().max(200).nullable().optional(),
  default_commission_pct: z.number().min(0).max(100).default(0),
  notes: z.string().trim().max(500).nullable().optional(),
  is_active: z.boolean().default(true),
});

export async function upsertSupplier(
  input: z.infer<typeof supplierSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = supplierSchema.safeParse(input);
  if (!parsed.success) return fail("Revisá los datos del proveedor.");
  const { supabase, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const { id, ...fields } = parsed.data;
  const row = {
    name: fields.name,
    website: fields.website || null,
    default_commission_pct: fields.default_commission_pct,
    notes: fields.notes || null,
    is_active: fields.is_active,
  };

  if (id) {
    const { error } = await supabase.from("suppliers").update(row).eq("id", id);
    if (error) return fail("No se pudo guardar el proveedor.");
    revalidatePath("/config/proveedores");
    return succeed({ id });
  }

  const { data, error } = await supabase
    .from("suppliers")
    .insert({ agency_id: agency.id, ...row })
    .select("id")
    .single();
  if (error || !data) return fail("No se pudo crear el proveedor.");

  revalidatePath("/config/proveedores");
  return succeed({ id: data.id });
}

export async function deleteSupplier(input: { id: string }): Promise<ActionResult<null>> {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const { error } = await supabase.from("suppliers").delete().eq("id", parsed.data.id);
  if (error)
    return fail("No se pudo eliminar: puede tener cotizaciones o servicios asociados. Desactivalo en su lugar.");

  revalidatePath("/config/proveedores");
  return succeed(null);
}

/* ───────────────────────────────────────────
   Plantillas de WhatsApp
   ─────────────────────────────────────────── */

const templateSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Poné un nombre").max(80),
  meta_name: z
    .string()
    .trim()
    .min(1, "Falta el nombre técnico")
    .max(80)
    .regex(/^[a-z0-9_]+$/, "Solo minúsculas, números y guión bajo"),
  stage: z
    .enum(["nuevo", "contactado", "presupuestado", "negociacion", "ganado", "perdido"])
    .nullable(),
  body: z.string().trim().min(1, "El mensaje no puede estar vacío").max(2000),
  is_approved: z.boolean().default(false),
});

export async function upsertTemplate(
  input: z.infer<typeof templateSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Revisá los datos de la plantilla.";
    return fail(first);
  }
  const { supabase, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const { id, ...fields } = parsed.data;

  if (id) {
    const { error } = await supabase.from("wa_templates").update(fields).eq("id", id);
    if (error) return fail("No se pudo guardar la plantilla.");
    revalidatePath("/config/plantillas");
    return succeed({ id });
  }

  const { data, error } = await supabase
    .from("wa_templates")
    .insert({ agency_id: agency.id, ...fields })
    .select("id")
    .single();
  if (error || !data) return fail("No se pudo crear la plantilla.");

  revalidatePath("/config/plantillas");
  return succeed({ id: data.id });
}

export async function deleteTemplate(input: { id: string }): Promise<ActionResult<null>> {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const { error } = await supabase.from("wa_templates").delete().eq("id", parsed.data.id);
  if (error) return fail("No se pudo eliminar la plantilla.");

  revalidatePath("/config/plantillas");
  return succeed(null);
}

/* ───────────────────────────────────────────
   Seguimiento automático
   ─────────────────────────────────────────── */

const followupSchema = z.object({
  id: z.uuid(),
  hours_after_silence: z.number().int().min(1, "Mínimo 1 hora").max(2160).optional(),
  applies_to_stages: z
    .array(z.enum(["nuevo", "contactado", "presupuestado", "negociacion", "ganado", "perdido"]))
    .min(1, "Elegí al menos una etapa")
    .optional(),
  is_active: z.boolean().optional(),
});

export async function updateFollowupRule(
  input: z.infer<typeof followupSchema>,
): Promise<ActionResult<null>> {
  const parsed = followupSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Datos inválidos.";
    return fail(first);
  }
  const { supabase, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const { id, ...fields } = parsed.data;
  if (Object.keys(fields).length === 0) return succeed(null);

  const { error } = await supabase.from("followup_rules").update(fields).eq("id", id);
  if (error) return fail("No se pudo guardar la regla de seguimiento.");

  revalidatePath("/config/seguimiento");
  return succeed(null);
}
