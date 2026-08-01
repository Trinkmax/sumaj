"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  requireAction,
  succeed,
  fail,
  type ActionResult,
} from "@/lib/actions/core";
import { createAnonClient } from "@/lib/supabase/server";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { TAG_COLORS, TAG_CATEGORIES } from "@/lib/domain";
import type { AgencySettings, Tables, TablesUpdate } from "@/lib/types";
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
      quote_fees: z
        .object({
          aereo_pct: z.number().min(0).max(100),
          terrestre_pct: z.number().min(0).max(100),
        })
        .optional(),
      quote_seller_commission_pct: z.number().min(0).max(100).optional(),
      legal: z
        .object({
          legal_name: z.string().trim().max(160).nullable().optional(),
          cuit: z.string().trim().max(20).nullable().optional(),
          address: z.string().trim().max(200).nullable().optional(),
          city: z.string().trim().max(80).nullable().optional(),
          province: z.string().trim().max(80).nullable().optional(),
          postal_code: z.string().trim().max(20).nullable().optional(),
          country: z.string().trim().max(80).nullable().optional(),
          phone: z.string().trim().max(40).nullable().optional(),
          email: z.string().trim().max(160).nullable().optional(),
          website: z.string().trim().max(200).nullable().optional(),
          evyt: z.string().trim().max(40).nullable().optional(),
        })
        .optional(),
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
      ...(settingsPatch.quote_fees && { quote_fees: settingsPatch.quote_fees }),
      ...(settingsPatch.quote_seller_commission_pct !== undefined && {
        quote_seller_commission_pct: settingsPatch.quote_seller_commission_pct,
      }),
      // merge campo a campo: un patch parcial no tiene que borrar el resto
      ...(settingsPatch.legal && {
        legal: { ...(current.legal ?? {}), ...settingsPatch.legal },
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
   Equipo — alta de usuarios con email + contraseña
   ─────────────────────────────────────────── */

const teamMemberSchema = z.object({
  email: z.email("Ese email no parece válido."),
  password: z.string().min(8, "La contraseña necesita al menos 8 caracteres."),
  displayName: z
    .string()
    .trim()
    .min(2, "Poné el nombre de la persona.")
    .max(80, "El nombre es muy largo."),
  role: z.enum(["admin", "vendedor", "freelance"]),
  commissionPct: z.number().min(0, "Mínimo 0").max(100, "Máximo 100"),
});

/** Resultado del alta: cómo quedó el acceso de la persona. */
export type CreateTeamMemberResult = {
  /** "directo": la cuenta ya está lista · "invitacion": entra sola la primera vez */
  mode: "directo" | "invitacion";
  /** el email ya tenía cuenta en el sistema: entra con SU contraseña, no con la nueva */
  reusedAccount: boolean;
};

const ALREADY_REGISTERED =
  /already been registered|already registered|already exists|user_exists|email_exists/i;

/** ¿El error de auth dice "ese email ya tiene cuenta"? (mensaje o code) */
function isAlreadyRegistered(
  error: { message: string; code?: string | null } | null,
): boolean {
  if (!error) return false;
  if (error.code === "email_exists" || error.code === "user_already_exists") return true;
  return ALREADY_REGISTERED.test(error.message);
}

/** Busca un usuario de auth por email paginando el listado admin. */
async function findAuthUserId(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<string | null> {
  const perPage = 200;
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data) return null;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < perPage) return null;
  }
  return null;
}

/**
 * Crea un usuario del equipo con email y contraseña.
 * Con SUPABASE_SERVICE_ROLE_KEY la cuenta queda lista al toque (mode "directo").
 * Sin ella, deja la invitación + la cuenta creada para que entre la primera vez
 * con ese mismo email y contraseña (mode "invitacion"). Nunca queda a medias.
 */
export async function createTeamMember(
  input: z.infer<typeof teamMemberSchema>,
): Promise<ActionResult<CreateTeamMemberResult>> {
  const parsed = teamMemberSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Revisá los datos del usuario.";
    return fail(first);
  }
  const { supabase, member, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const email = parsed.data.email.toLowerCase().trim();
  const { password, displayName, role, commissionPct } = parsed.data;

  const { data: existingMember } = await supabase
    .from("members")
    .select("id")
    .eq("agency_id", agency.id)
    .eq("email", email)
    .maybeSingle();
  if (existingMember) return fail("Esa persona ya es parte del equipo.");

  /* ── Camino A: service role key → la cuenta queda lista ── */
  if (hasAdminClient()) {
    try {
      const admin = createAdminClient();
      let userId: string | null = null;
      let reusedAccount = false;
      let createdNow = false;

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: displayName },
      });

      if (created?.user) {
        userId = created.user.id;
        createdNow = true;
      } else if (isAlreadyRegistered(createError)) {
        // ese email ya tiene cuenta en el sistema: lo sumamos a esta agencia
        userId = await findAuthUserId(admin, email);
        reusedAccount = true;
        if (!userId)
          return fail(
            "Ese email ya tiene una cuenta y no pudimos encontrarla. Probá con otro email.",
          );
      } else {
        return fail("No se pudo crear el usuario. Revisá el email y probá de nuevo.");
      }

      const { data: alreadyInAgency } = await admin
        .from("members")
        .select("id")
        .eq("agency_id", agency.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (alreadyInAgency) return fail("Esa cuenta ya está en el equipo de la agencia.");

      const { error: memberError } = await admin.from("members").insert({
        agency_id: agency.id,
        user_id: userId,
        role,
        display_name: displayName,
        email,
        commission_pct: commissionPct,
        is_active: true,
      });
      if (memberError) {
        // si la cuenta la creamos recién, la borramos: así reintentar no cae en
        // "ese email ya tiene cuenta" con una contraseña que nadie conoce
        if (createdNow) await admin.auth.admin.deleteUser(userId).catch(() => {});
        return fail("No pudimos sumar a la persona al equipo. Probá de nuevo.");
      }

      revalidatePath("/config/equipo");
      return succeed<CreateTeamMemberResult>({ mode: "directo", reusedAccount });
    } catch {
      return fail("No se pudo crear el usuario. Probá de nuevo en un momento.");
    }
  }

  /* ── Camino B: sin service role key → invitación + cuenta con esa contraseña ── */
  const { data: pending } = await supabase
    .from("invitations")
    .select("id")
    .eq("agency_id", agency.id)
    .eq("email", email)
    .is("accepted_at", null)
    .maybeSingle();

  if (pending) {
    const { error } = await supabase
      .from("invitations")
      .update({ role, display_name: displayName, commission_pct: commissionPct })
      .eq("id", pending.id);
    if (error) return fail("No se pudo guardar el acceso. Probá de nuevo.");
  } else {
    const { error } = await supabase.from("invitations").insert({
      agency_id: agency.id,
      email,
      role,
      display_name: displayName,
      commission_pct: commissionPct,
      invited_by: member.id,
    });
    if (error) return fail("No se pudo crear el acceso. Probá de nuevo.");
  }

  // dejamos la cuenta creada con esa contraseña (best-effort: si ya existe, entra con la suya)
  let reusedAccount = false;
  try {
    const anon = createAnonClient();
    const { error: signUpError } = await anon.auth.signUp({
      email,
      password,
      options: { data: { full_name: displayName } },
    });
    if (isAlreadyRegistered(signUpError)) reusedAccount = true;
  } catch {
    // la persona igual puede registrarse sola con ese email: la invitación la espera
  }

  revalidatePath("/config/equipo");
  return succeed<CreateTeamMemberResult>({ mode: "invitacion", reusedAccount });
}

/* ───────────────────────────────────────────
   Equipo — rol, comisión y estado
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

/** Tope de toques por agencia: más que esto ya es perseguir al cliente. */
const MAX_TOUCHES = 6;

const newFollowupSchema = z.object({
  hours_after_silence: z.number().int().min(1, "Mínimo 1 hora").max(2160),
  applies_to_stages: z
    .array(z.enum(["nuevo", "contactado", "presupuestado", "negociacion", "ganado", "perdido"]))
    .min(1, "Elegí al menos una etapa"),
});

/**
 * Agrega un toque a la cadencia. El `touch_number` lo decide el server: toma el
 * primer número libre desde el 1, así la numeración queda compacta y no choca
 * contra unique(agency_id, touch_number) cuando antes se borró un toque del medio.
 */
export async function createFollowupRule(
  input: z.infer<typeof newFollowupSchema>,
): Promise<ActionResult<Tables<"followup_rules">>> {
  const parsed = newFollowupSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Datos inválidos.";
    return fail(first);
  }
  const { supabase, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const { data: taken } = await supabase
    .from("followup_rules")
    .select("touch_number")
    .eq("agency_id", agency.id);

  const used = new Set((taken ?? []).map((r) => r.touch_number));
  if (used.size >= MAX_TOUCHES)
    return fail(`Ya tenés ${MAX_TOUCHES} toques. Ajustá los que hay en lugar de sumar otro.`);

  let touchNumber = 1;
  while (used.has(touchNumber)) touchNumber++;

  const { data, error } = await supabase
    .from("followup_rules")
    .insert({
      agency_id: agency.id,
      touch_number: touchNumber,
      hours_after_silence: parsed.data.hours_after_silence,
      applies_to_stages: parsed.data.applies_to_stages,
    })
    .select("*")
    .single();
  if (error || !data) return fail("No se pudo agregar el toque. Probá de nuevo.");

  revalidatePath("/config/seguimiento");
  return succeed(data);
}

/**
 * Quita un toque de la cadencia. Los seguimientos que ya estaban en la cola no
 * se tocan (followups.rule_id queda en null): lo que se corta es la programación
 * de acá en adelante.
 */
export async function deleteFollowupRule(input: { id: string }): Promise<ActionResult<null>> {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const { error } = await supabase
    .from("followup_rules")
    .delete()
    .eq("id", parsed.data.id)
    .eq("agency_id", agency.id);
  if (error) return fail("No se pudo quitar el toque.");

  revalidatePath("/config/seguimiento");
  return succeed(null);
}

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
