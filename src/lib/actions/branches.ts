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
import { TAG_COLORS } from "@/lib/domain";
import { channelStatus, hasWorker, logoutChannel, startChannel } from "@/lib/wa/worker";
import { hasCloudApi, registerCloudNumber } from "@/lib/wa/cloud";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import type { Enums, TablesUpdate } from "@/lib/types";

const ADMIN_ONLY = "Esto lo maneja un admin de la agencia.";

function revalidateBranches() {
  revalidatePath("/config/sucursales");
  revalidatePath("/config");
  revalidatePath("/crm");
}

/* ───────────────────────────────────────────
   Sucursales
   ─────────────────────────────────────────── */

const branchSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Poné un nombre").max(60),
  address: z.string().trim().max(160).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  color: z.string().refine((c) => c in TAG_COLORS, "Color inválido").default("sky"),
  is_default: z.boolean().default(false),
  is_active: z.boolean().default(true),
});

export async function upsertBranch(
  input: z.infer<typeof branchSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = branchSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Revisá los datos de la sucursal.");
  }
  const { supabase, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const { id, ...fields } = parsed.data;
  const row = {
    name: fields.name,
    address: fields.address || null,
    phone: fields.phone?.replace(/\D/g, "") || null,
    color: fields.color,
    is_active: fields.is_active,
    updated_at: new Date().toISOString(),
  };

  // una sola sucursal por defecto: la que se marca destrona a la anterior
  if (fields.is_default) {
    await supabase
      .from("branches")
      .update({ is_default: false })
      .eq("agency_id", agency.id)
      .neq("id", id ?? "00000000-0000-0000-0000-000000000000");
  }

  if (id) {
    const { error } = await supabase
      .from("branches")
      .update({ ...row, is_default: fields.is_default })
      .eq("id", id);
    if (error) return fail("No se pudo guardar la sucursal. ¿Ya existe una con ese nombre?");
    revalidateBranches();
    return succeed({ id });
  }

  const { data: created, error } = await supabase
    .from("branches")
    .insert({ agency_id: agency.id, ...row, is_default: fields.is_default })
    .select("id")
    .single();
  if (error || !created)
    return fail("No se pudo crear la sucursal. ¿Ya existe una con ese nombre?");

  // toda sucursal nace con su canal de WhatsApp (todavía sin vincular)
  const { error: channelError } = await supabase.from("wa_channels").insert({
    agency_id: agency.id,
    branch_id: created.id,
    kind: "baileys",
    is_mother: false,
    label: `Sucursal ${fields.name}`,
    status: "desconectado",
  });
  if (channelError) {
    await supabase.from("branches").delete().eq("id", created.id);
    return fail("No se pudo preparar el WhatsApp de la sucursal. Probá de nuevo.");
  }

  revalidateBranches();
  return succeed({ id: created.id });
}

export async function deleteBranch(input: { id: string }): Promise<ActionResult<null>> {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const { count } = await supabase
    .from("branches")
    .select("id", { count: "exact", head: true })
    .eq("agency_id", agency.id);
  if ((count ?? 0) <= 1) return fail("Tiene que quedar al menos una sucursal.");

  const { error } = await supabase.from("branches").delete().eq("id", parsed.data.id);
  if (error)
    return fail("No se pudo eliminar: tiene ventas o leads asociados. Desactivala en su lugar.");

  revalidateBranches();
  return succeed(null);
}

/** Mover un vendedor de sucursal (solo admin). */
const memberBranchSchema = z.object({
  memberId: z.uuid(),
  branchId: z.uuid().nullable(),
});

export async function setMemberBranch(
  input: z.infer<typeof memberBranchSchema>,
): Promise<ActionResult<null>> {
  const parsed = memberBranchSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  if (parsed.data.branchId) {
    const { data: branch } = await supabase
      .from("branches")
      .select("id")
      .eq("id", parsed.data.branchId)
      .eq("agency_id", agency.id)
      .maybeSingle();
    if (!branch) return fail("Esa sucursal no existe.");
  }

  const { error } = await supabase
    .from("members")
    .update({ branch_id: parsed.data.branchId })
    .eq("id", parsed.data.memberId)
    .eq("agency_id", agency.id);
  if (error) return fail("No se pudo cambiar la sucursal del vendedor.");

  revalidateBranches();
  revalidatePath("/config/equipo");
  return succeed(null);
}

/* ───────────────────────────────────────────
   Canales de WhatsApp (números)
   ─────────────────────────────────────────── */

export type ChannelState = {
  id: string;
  status: Enums<"wa_channel_status">;
  qr: string | null;
  qrExpiresAt: string | null;
  phone: string | null;
  lastError: string | null;
  lastConnectedAt: string | null;
};

const channelIdSchema = z.object({ channelId: z.uuid() });

/**
 * Columnas que puede leer un miembro cualquiera. `qr`, `qr_expires_at` y
 * `last_error` quedaron fuera del grant de `authenticated` (migración 0016):
 * el QR es la llave del WhatsApp de la sucursal.
 */
const CHANNEL_SAFE_COLUMNS =
  "id, agency_id, branch_id, kind, is_mother, label, phone, status, phone_number_id, last_connected_at, auto_reply_enabled, auto_reply_text";

async function loadChannel(channelId: string) {
  const { supabase, agency, isAdmin } = await requireAction();
  const { data: channel } = await supabase
    .from("wa_channels")
    .select(CHANNEL_SAFE_COLUMNS)
    .eq("id", channelId)
    .eq("agency_id", agency.id)
    .maybeSingle();
  return { supabase, agency, isAdmin, channel };
}

/** Estado del canal para el polling de la UI mientras se escanea el QR. */
export async function getChannelState(input: {
  channelId: string;
}): Promise<ActionResult<ChannelState>> {
  const parsed = channelIdSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { channel, isAdmin } = await loadChannel(parsed.data.channelId);
  if (!channel) return fail("No encontramos el número.");

  const base: ChannelState = {
    id: channel.id,
    status: channel.status,
    qr: null,
    qrExpiresAt: null,
    phone: channel.phone,
    lastError: null,
    lastConnectedAt: channel.last_connected_at,
  };

  // el QR y el detalle del error solo para el admin, y leídos con service role
  if (!isAdmin || !hasAdminClient()) return succeed(base);

  const { data: secret } = await createAdminClient()
    .from("wa_channels")
    .select("qr, qr_expires_at, last_error")
    .eq("id", channel.id)
    .maybeSingle();

  return succeed({
    ...base,
    qr: secret?.qr ?? null,
    qrExpiresAt: secret?.qr_expires_at ?? null,
    lastError: secret?.last_error ?? null,
  });
}

/** Vincular: el worker abre la sesión y publica el QR en la fila del canal. */
export async function linkChannel(input: {
  channelId: string;
}): Promise<ActionResult<ChannelState>> {
  const parsed = channelIdSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, channel, isAdmin } = await loadChannel(parsed.data.channelId);
  if (!isAdmin) return fail(ADMIN_ONLY);
  if (!channel) return fail("No encontramos el número.");
  if (channel.kind !== "baileys")
    return fail("El número madre se conecta con la Cloud API, no con QR.");
  if (!hasWorker())
    return fail(
      "Falta configurar el worker de WhatsApp (WA_WORKER_URL y WA_WORKER_TOKEN).",
    );

  await supabase
    .from("wa_channels")
    .update({ status: "vinculando", last_error: null, qr: null })
    .eq("id", channel.id);

  const res = await startChannel(channel.id);
  if (!res.ok) {
    await supabase
      .from("wa_channels")
      .update({ status: "error", last_error: res.error })
      .eq("id", channel.id);
    return fail(res.error);
  }

  return getChannelState({ channelId: channel.id });
}

/** Desvincular el número de la sucursal. */
export async function unlinkChannel(input: {
  channelId: string;
}): Promise<ActionResult<null>> {
  const parsed = channelIdSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, channel, isAdmin, agency } = await loadChannel(parsed.data.channelId);
  if (!isAdmin) return fail(ADMIN_ONLY);
  if (!channel) return fail("No encontramos el número.");

  if (hasWorker()) {
    const res = await logoutChannel(channel.id);
    if (!res.ok) return fail(res.error);
  }

  await supabase
    .from("wa_channels")
    .update({
      status: "desconectado",
      qr: null,
      qr_expires_at: null,
      phone: null,
      last_error: null,
    })
    .eq("id", channel.id);

  await logActivity({
    agencyId: agency.id,
    type: "sistema",
    body: `Se desvinculó el WhatsApp de ${channel.label}`,
  });

  revalidateBranches();
  return succeed(null);
}

/** Sincroniza el estado real del worker (por si se reinició el proceso). */
export async function syncChannel(input: {
  channelId: string;
}): Promise<ActionResult<ChannelState>> {
  const parsed = channelIdSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, channel } = await loadChannel(parsed.data.channelId);
  if (!channel) return fail("No encontramos el número.");
  if (channel.kind !== "baileys" || !hasWorker()) {
    return getChannelState({ channelId: channel.id });
  }

  const res = await channelStatus(channel.id);
  if (res.ok && !res.data.connected && channel.status === "conectado") {
    await supabase
      .from("wa_channels")
      .update({ status: "desconectado" })
      .eq("id", channel.id);
  }
  return getChannelState({ channelId: channel.id });
}

const channelSettingsSchema = z.object({
  channelId: z.uuid(),
  label: z.string().trim().min(2).max(60).optional(),
  // solo dígitos: el ID se interpola en la URL del Graph y sale con el token de
  // la plataforma (ver registerCloudNumber / post en lib/wa/cloud.ts)
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^\d{5,20}$/, "El phone number ID de Meta son solo números.")
    .nullable()
    .optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  autoReplyEnabled: z.boolean().optional(),
  autoReplyText: z.string().trim().max(1000).nullable().optional(),
});

export async function updateChannelSettings(
  input: z.infer<typeof channelSettingsSchema>,
): Promise<ActionResult<null>> {
  const parsed = channelSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Revisá los datos del número.");
  }
  const { supabase, channel, isAdmin } = await loadChannel(parsed.data.channelId);
  if (!isAdmin) return fail(ADMIN_ONLY);
  if (!channel) return fail("No encontramos el número.");

  const patch: TablesUpdate<"wa_channels"> = { updated_at: new Date().toISOString() };
  if (parsed.data.label !== undefined) patch.label = parsed.data.label;
  if (parsed.data.phoneNumberId !== undefined) {
    patch.phone_number_id = parsed.data.phoneNumberId || null;
    // Un phone number ID nuevo es un número sin registrar: si heredara el
    // "conectado" del anterior, la pantalla diría que las consultas entran solas
    // mientras Meta no entrega nada.
    if (channel.is_mother && patch.phone_number_id !== channel.phone_number_id) {
      patch.status = "desconectado";
      patch.last_connected_at = null;
    }
  }
  if (parsed.data.phone !== undefined)
    patch.phone = parsed.data.phone?.replace(/\D/g, "") || null;
  if (parsed.data.autoReplyEnabled !== undefined)
    patch.auto_reply_enabled = parsed.data.autoReplyEnabled;
  if (parsed.data.autoReplyText !== undefined)
    patch.auto_reply_text = parsed.data.autoReplyText || null;

  const { error } = await supabase.from("wa_channels").update(patch).eq("id", channel.id);
  if (error) return fail("No se pudieron guardar los cambios del número.");

  revalidatePath("/config/whatsapp");
  revalidateBranches();
  return succeed(null);
}

const registerMotherSchema = z.object({
  channelId: z.uuid(),
  pin: z.string().trim().regex(/^\d{6}$/, "El PIN son 6 números, sin letras ni espacios."),
});

/**
 * Registra el número madre en la Cloud API de Meta.
 *
 * Meta agrega y verifica el número, pero el registro final va por API: en su
 * panel el botón "Registrarte" queda gris y el número se queda "Pendiente" para
 * siempre. Hasta que esto no corre, Meta NO entrega los mensajes al webhook por
 * más que el número esté verificado y la suscripción armada.
 *
 * El token sale del entorno del server (`WA_CLOUD_TOKEN`) y el PIN lo escribe el
 * admin en el momento: ninguno de los dos toca la base ni el navegador.
 */
export async function registerMotherNumber(
  input: z.infer<typeof registerMotherSchema>,
): Promise<ActionResult<null>> {
  const parsed = registerMotherSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Revisá el PIN.");
  }
  const { supabase, channel, isAdmin, agency } = await loadChannel(parsed.data.channelId);
  if (!isAdmin) return fail(ADMIN_ONLY);
  if (!channel) return fail("No encontramos el número.");
  if (!channel.is_mother) {
    return fail("El número de la sucursal se vincula con QR, no con la Cloud API.");
  }
  if (!channel.phone_number_id) {
    return fail("Cargá primero el phone number ID de Meta y guardá.");
  }
  if (!hasCloudApi()) {
    return fail("Falta el token de la Cloud API en el servidor (WA_CLOUD_TOKEN).");
  }

  const res = await registerCloudNumber(channel.phone_number_id, parsed.data.pin);
  if (!res.ok) {
    // El motivo se lo devolvemos al admin por el toast; acá queda solo el rastro
    // para el service role. `status` NO se toca a propósito: /config/whatsapp no
    // puede leer last_error (migración 0016), así que un "Con error" pegajoso
    // mandaría a revisar el phone number ID y el token —que no son los que
    // fallaron— y escondería el botón para reintentar.
    await supabase
      .from("wa_channels")
      .update({ last_error: res.error, updated_at: new Date().toISOString() })
      .eq("id", channel.id);
    return fail(res.error);
  }

  await supabase
    .from("wa_channels")
    .update({
      status: "conectado",
      last_error: null,
      last_connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", channel.id);

  await logActivity({
    agencyId: agency.id,
    type: "sistema",
    body: "Se registró el número madre en la Cloud API de Meta",
  });

  revalidatePath("/config/whatsapp");
  revalidateBranches();
  return succeed(null);
}

/**
 * Respuesta automática con la que nace el número madre: la misma que dejó el
 * backfill de la 0014, así todas las agencias arrancan con el mismo texto.
 */
const MOTHER_AUTO_REPLY =
  "¡Hola! Gracias por escribirnos. En un ratito te contacta uno de nuestros asesores para armarte el viaje. Contanos destino y fechas mientras tanto y vamos adelantando.";

/**
 * Crea el número madre de la agencia (Cloud API) si todavía no lo tiene. Es la
 * puerta por donde entran las consultas nuevas: sin esa fila, /config/whatsapp
 * no tiene nada que configurar y el webhook no sabe a qué canal atribuir el
 * mensaje. Idempotente a propósito — hay un índice único parcial de un solo
 * madre por agencia, así que si dos clicks corren a la vez devolvemos el que ganó.
 */
export async function createMotherChannel(): Promise<ActionResult<{ channelId: string }>> {
  const { supabase, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  async function findMother() {
    const { data } = await supabase
      .from("wa_channels")
      .select("id")
      .eq("agency_id", agency.id)
      .eq("is_mother", true)
      .maybeSingle();
    return data?.id ?? null;
  }

  const already = await findMother();
  if (already) return succeed({ channelId: already });

  const { data: created, error } = await supabase
    .from("wa_channels")
    .insert({
      agency_id: agency.id,
      branch_id: null,
      kind: "cloud_api",
      is_mother: true,
      label: "Número madre",
      status: "desconectado",
      auto_reply_enabled: true,
      auto_reply_text: MOTHER_AUTO_REPLY,
    })
    .select("id")
    .single();

  if (error || !created) {
    // 23505 = unique_violation del índice de un solo madre: releemos al ganador
    if (error?.code === "23505") {
      const winner = await findMother();
      if (winner) {
        revalidatePath("/config/whatsapp");
        revalidateBranches();
        return succeed({ channelId: winner });
      }
    }
    return fail("No se pudo crear el número madre. Probá de nuevo.");
  }

  await logActivity({
    agencyId: agency.id,
    type: "sistema",
    body: "Se creó el número madre de la agencia",
  });

  revalidatePath("/config/whatsapp");
  revalidateBranches();
  return succeed({ channelId: created.id });
}

/* ───────────────────────────────────────────
   Reglas de derivación del número madre
   ─────────────────────────────────────────── */

const ruleSchema = z.object({
  id: z.uuid().optional(),
  branchId: z.uuid(),
  matchType: z.enum(["palabra", "campana"]),
  pattern: z.string().trim().min(2, "Poné al menos 2 letras").max(60),
  isActive: z.boolean().default(true),
  position: z.number().int().min(0).max(99).default(0),
});

export async function upsertRoutingRule(
  input: z.infer<typeof ruleSchema>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Revisá la regla.");
  }
  const { supabase, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const row = {
    branch_id: parsed.data.branchId,
    match_type: parsed.data.matchType,
    pattern: parsed.data.pattern,
    is_active: parsed.data.isActive,
    position: parsed.data.position,
  };

  if (parsed.data.id) {
    const { error } = await supabase
      .from("routing_rules")
      .update(row)
      .eq("id", parsed.data.id)
      .eq("agency_id", agency.id);
    if (error) return fail("No se pudo guardar la regla.");
    revalidateBranches();
    return succeed({ id: parsed.data.id });
  }

  const { data, error } = await supabase
    .from("routing_rules")
    .insert({ agency_id: agency.id, ...row })
    .select("id")
    .single();
  if (error || !data) return fail("No se pudo crear la regla.");

  revalidateBranches();
  return succeed({ id: data.id });
}

export async function deleteRoutingRule(input: { id: string }): Promise<ActionResult<null>> {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const { error } = await supabase
    .from("routing_rules")
    .delete()
    .eq("id", parsed.data.id)
    .eq("agency_id", agency.id);
  if (error) return fail("No se pudo eliminar la regla.");

  revalidateBranches();
  return succeed(null);
}
