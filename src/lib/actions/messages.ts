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
import { sendCloudTemplate, sendCloudText, type CloudCreds } from "@/lib/wa/cloud";
import { getCloudCreds } from "@/lib/wa/cloud-credentials";
import { hasWorker, sendViaBaileys } from "@/lib/wa/worker";
import { alertBranchOperators } from "@/lib/wa/inbound";
import { sendIgText } from "@/lib/ig/graph";
import { getIgCreds, type ResolvedIgCreds } from "@/lib/ig/credentials";
import { toE164 } from "@/lib/ig/phone";
import { fillTemplate } from "@/lib/domain";
import { fmtPhone } from "@/lib/format";
import type { MessageStatus, TablesInsert } from "@/lib/types";

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * La ventana de Instagram con el tag HUMAN_AGENT: 7 días desde el último
 * mensaje de la persona. Solo para las agencias que tienen el feature aprobado
 * por Meta (ver `ig_accounts.human_agent_enabled`).
 */
const IG_HUMAN_AGENT_MS = 7 * 24 * 60 * 60 * 1000;

export type SentMessage = { id: string; status: MessageStatus; createdAt: string };

/** Todo lo que hace falta para saber por qué canal sale el mensaje. */
const CONVERSATION_WITH_CHANNEL =
  "id, channel, last_inbound_at, wa_id, branch_id, contact:contacts(id, full_name, phone), channel_ref:wa_channels(id, kind, status, label)";

/* Motivos por los que un mensaje no puede salir. Son textos distintos a
   propósito: el vendedor tiene que saber si le falta el teléfono del cliente,
   si el número de la sucursal está sin vincular o si todavía no hay número
   madre — cada caso lo arregla otra persona en otra pantalla. */
const NO_PHONE =
  "Este contacto no tiene teléfono cargado. Agregalo en su ficha y volvé a escribirle.";
const NO_CHANNEL =
  "Esta conversación no tiene número de WhatsApp asignado. Vinculá el de la sucursal en Configuración · Sucursales.";
const BRANCH_UNLINKED =
  "El WhatsApp de esa sucursal no está vinculado. Escaneá el QR en Configuración · Sucursales.";
const WORKER_DOWN =
  "El servicio que maneja los números de las sucursales no está disponible. Avisale a quien administra el sistema.";
const MOTHER_MISSING =
  "El número madre todavía no está conectado con Meta. Conectalo en Configuración · WhatsApp o derivá el chat a una sucursal.";
const IG_MISSING =
  "La cuenta de Instagram todavía no está conectada. Conectala en Configuración · Instagram.";
const IG_NO_ID =
  "Este chat no tiene el identificador de Instagram de la persona. Se completa solo cuando vuelva a escribir.";

/** Por dónde sale el mensaje una vez resuelto el canal. */
type SendRoute =
  | { via: "baileys"; channelId: string; to: string }
  | { via: "cloud"; creds: CloudCreds; to: string }
  | { via: "instagram"; creds: ResolvedIgCreds; to: string };

/**
 * Resuelve la salida del mensaje o el motivo por el que NO sale.
 *
 * Antes, sin worker ni Cloud API, el mensaje se guardaba con status 'enviado'
 * y `metadata.simulated`: el vendedor veía el tilde y el cliente nunca recibía
 * nada. Ahora falta de infraestructura = error explícito, sin escribir en el
 * hilo (el mensaje nunca salió: ensuciarlo no aporta).
 *
 * Las credenciales de Meta ya no son globales: viajan DENTRO de la ruta, atadas
 * a la agencia que manda. Resolverlas una sola vez "para todos" sería mandar con
 * el token de otra.
 */
async function resolveRoute(
  agencyId: string,
  channel: {
    id: string;
    kind: string;
    status: string;
  } | null,
  /** teléfono del contacto (WhatsApp) — en Instagram no sirve */
  to: string | null,
  /** IGSID del interlocutor: `conversations.wa_id` del hilo de Instagram */
  igsid: string | null,
): Promise<{ ok: true; route: SendRoute } | { ok: false; error: string }> {
  if (!channel) return { ok: false, error: NO_CHANNEL };

  // Instagram primero: es el único canal donde el destinatario NO es un
  // teléfono. Mandarle al `contacts.phone` (que después del puente a WhatsApp
  // existe) sería mandarle un DM a un número, y Meta lo rechaza sin explicar.
  if (channel.kind === "instagram") {
    if (!igsid) return { ok: false, error: IG_NO_ID };
    const creds = await getIgCreds(agencyId);
    if (!creds) return { ok: false, error: IG_MISSING };
    return { ok: true, route: { via: "instagram", creds, to: igsid } };
  }

  if (!to) return { ok: false, error: NO_PHONE };

  if (channel.kind === "baileys") {
    // El orden importa: primero el estado del número (lo resuelve la agencia
    // escaneando el QR), después la infraestructura (la resuelve el sistema).
    if (channel.status !== "conectado") return { ok: false, error: BRANCH_UNLINKED };
    if (!hasWorker()) return { ok: false, error: WORKER_DOWN };
    return { ok: true, route: { via: "baileys", channelId: channel.id, to } };
  }

  const creds = await getCloudCreds(agencyId);
  if (!creds || !creds.phoneNumberId) return { ok: false, error: MOTHER_MISSING };
  return { ok: true, route: { via: "cloud", creds, to } };
}

/**
 * ¿Se puede escribir ahora por un canal con ventana?
 *
 * Los dos canales de Meta tienen la misma regla de fondo —la conversación la
 * abre el cliente y hay 24 hs para contestar— pero se salen distinto: en
 * WhatsApp con una plantilla paga, en Instagram con el tag HUMAN_AGENT (7 días,
 * y solo si Meta se lo aprobó a la agencia).
 */
function windowState(
  lastInboundAt: string | null,
  humanAgent: boolean,
): { open: boolean; needsHumanAgent: boolean } {
  if (!lastInboundAt) return { open: false, needsHumanAgent: false };
  const elapsed = Date.now() - new Date(lastInboundAt).getTime();
  if (elapsed < WINDOW_MS) return { open: true, needsHumanAgent: false };
  if (humanAgent && elapsed < IG_HUMAN_AGENT_MS) return { open: true, needsHumanAgent: true };
  return { open: false, needsHumanAgent: false };
}

const IG_WINDOW_CLOSED =
  "Se cerró la ventana de 24 hs de Instagram. Pasá la charla a WhatsApp o esperá a que la persona vuelva a escribir.";

/**
 * Guarda el mensaje que ACABA de salir, tolerando que el webhook nos haya
 * ganado de mano.
 *
 * En Instagram, todo lo que manda la cuenta vuelve como un eco por webhook —
 * incluso lo que mandamos nosotros. Ese eco trae el mismo id de mensaje y
 * `messages.wa_message_id` es único, así que si el eco entra en el instante
 * entre el envío y este insert, el insert choca. Sin esto, el vendedor vería un
 * "no se pudo enviar" en rojo por un mensaje que salió perfecto.
 *
 * Ante el choque se lee la fila que ganó y se sigue como si nada: el mensaje
 * está, que es lo único que importa.
 */
async function saveOutbound(
  supabase: Awaited<ReturnType<typeof requireAction>>["supabase"],
  values: TablesInsert<"messages">,
): Promise<SentMessage | null> {
  const { data, error } = await supabase
    .from("messages")
    .insert(values)
    .select("id, status, created_at")
    .single();

  if (data) return { id: data.id, status: data.status, createdAt: data.created_at };

  // 23505 = unique_violation de wa_message_id: el eco llegó primero.
  if (error?.code === "23505" && values.wa_message_id) {
    const { data: winner } = await supabase
      .from("messages")
      .select("id, status, created_at")
      .eq("wa_message_id", values.wa_message_id)
      .maybeSingle();
    if (winner) {
      return { id: winner.id, status: winner.status, createdAt: winner.created_at };
    }
  }
  return null;
}

/* ───────────────────────────────────────────
   sendMessage — texto libre.
   · Sucursal (Baileys): sale por el número de la sucursal, SIN ventana de
     24 hs ni plantillas pagas. Es la razón de ser de la arquitectura.
   · Número madre (Cloud API): solo dentro de la ventana de 24 hs.
   · Instagram: dentro de las 24 hs; hasta 7 días si la agencia tiene aprobado
     el tag de agente humano.
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

  const routed = await resolveRoute(
    agency.id,
    conversation.channel_ref,
    conversation.contact?.phone ?? conversation.wa_id,
    conversation.wa_id,
  );
  if (!routed.ok) return fail(routed.error);
  const route = routed.route;

  // La ventana se exige SOLO cuando el mensaje sale de verdad por un canal de
  // Meta. Por el número de una sucursal (Baileys) se escribe siempre, y si el
  // canal de Meta no está conectado el envío ya falló arriba: exigirla antes
  // dejaba el primer mensaje del CRM imposible.
  let humanAgent = false;
  if (route.via === "cloud") {
    const { open } = windowState(conversation.last_inbound_at, false);
    if (!open)
      return fail(
        "Fuera de la ventana de 24 hs del número madre. Derivá el chat a una sucursal para seguir sin costo.",
      );
  } else if (route.via === "instagram") {
    const state = windowState(
      conversation.last_inbound_at,
      route.creds.humanAgentEnabled,
    );
    if (!state.open) return fail(IG_WINDOW_CLOSED);
    humanAgent = state.needsHumanAgent;
  }

  /* envío real: el mensaje se guarda recién con la respuesta de Meta */
  let status: MessageStatus = "enviado";
  let waMessageId: string | null = null;
  let errorDetail: string | null = null;

  if (route.via === "baileys") {
    const res = await sendViaBaileys(route.channelId, route.to, parsed.data.body);
    if (res.ok) {
      waMessageId = res.data.waMessageId;
    } else {
      status = "fallido";
      errorDetail = res.error;
    }
  } else if (route.via === "instagram") {
    const res = await sendIgText(route.creds, route.to, parsed.data.body, { humanAgent });
    if (res.ok) {
      waMessageId = res.messageId;
    } else {
      status = "fallido";
      errorDetail = res.error;
    }
  } else {
    const res = await sendCloudText(route.creds, route.to, parsed.data.body);
    if (res.ok) {
      waMessageId = res.waMessageId;
    } else {
      status = "fallido";
      errorDetail = res.error;
    }
  }

  // Acá sí hubo intento real: el rechazo de Meta queda en el hilo con
  // error_detail para poder reclamarlo. El trigger de DB actualiza
  // last_message_at / preview de la conversación.
  const message = await saveOutbound(supabase, {
    agency_id: agency.id,
    conversation_id: conversation.id,
    direction: "out",
    kind: "texto",
    body: parsed.data.body,
    sent_by: member.id,
    status,
    wa_message_id: waMessageId,
    error_detail: errorDetail,
    metadata: {},
  });
  if (!message) return fail("No se pudo enviar. Revisá tu conexión y probá de nuevo.");

  if (status === "fallido") {
    return fail(
      errorDetail ??
        (route.via === "instagram"
          ? "Instagram rechazó el mensaje. Probá de nuevo."
          : "WhatsApp rechazó el mensaje. Probá de nuevo."),
    );
  }

  // Sin revalidatePath: el hilo ya se actualiza optimista + realtime.
  return succeed(message);
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
   El puente a WhatsApp desde el chat de Instagram.

   Es el movimiento que le da sentido a tener Instagram adentro del CRM: la
   consulta entra por el DM, pero la venta se hace por WhatsApp — ahí está el
   teléfono, el número de la sucursal y el seguimiento sin ventana de 24 hs.

   Del lado del cliente el salto ya está resuelto (el link wa.me de la respuesta
   automática, ver lib/ig/bridge.ts). Esto es el otro lado: el vendedor tiene el
   teléfono y arranca él la charla, sin salir del chat.
   ─────────────────────────────────────────── */

export type BridgeDraft = {
  contactName: string;
  /** el que ya tenemos, si lo tenemos (E.164 sin '+') */
  phone: string | null;
  /** el primer mensaje sugerido, ya interpolado */
  text: string;
  /** por qué número saldría */
  branchName: string | null;
  /** por qué NO se puede mandar todavía */
  blocked: string | null;
};

const draftSchema = z.object({ conversationId: z.string().uuid() });

/** Lo que necesita el diálogo de "Pasar a WhatsApp" para abrir con todo cargado. */
export async function getWhatsappBridgeDraft(input: {
  conversationId: string;
}): Promise<ActionResult<BridgeDraft>> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, agency } = await requireAction();

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, branch_id, contact:contacts(id, full_name, phone)")
    .eq("id", parsed.data.conversationId)
    .maybeSingle();
  if (!conversation?.contact) return fail("No encontramos la conversación.");

  const target = await resolveBranchChannel(supabase, agency.id, conversation.branch_id);
  const creds = await getIgCreds(agency.id);

  const text = fillTemplate(
    creds?.bridge.autoWaText ??
      "¡Hola {{nombre}}! Te escribo por tu consulta de Instagram. Contame destino y fechas y te armo una propuesta.",
    {
      nombre: conversation.contact.full_name.trim().split(/\s+/)[0],
      agencia: agency.name,
    },
  );

  return succeed({
    contactName: conversation.contact.full_name,
    phone: conversation.contact.phone,
    text,
    branchName: target.branchName,
    blocked: target.channelId ? null : target.error,
  });
}

/** El número de la sucursal por el que sale el primer WhatsApp. */
async function resolveBranchChannel(
  supabase: Awaited<ReturnType<typeof requireAction>>["supabase"],
  agencyId: string,
  branchId: string | null,
): Promise<{ channelId: string | null; branchName: string | null; error: string }> {
  const { data: branches } = await supabase
    .from("branches")
    .select("id, name, is_default, channels:wa_channels(id, kind, status)")
    .eq("agency_id", agencyId)
    .eq("is_active", true);

  const list = branches ?? [];
  // La sucursal de la consulta manda; si no tiene número vinculado, la de
  // defecto. No se cae al número madre a propósito: el madre no puede iniciar
  // una charla (necesita que el cliente escriba primero) y el mensaje quedaría
  // rebotado sin que el vendedor entienda por qué.
  const preferred = list.find((b) => b.id === branchId) ?? null;
  const fallback = list.find((b) => b.is_default) ?? null;

  for (const branch of [preferred, fallback].filter(Boolean)) {
    const channel = (branch!.channels ?? []).find(
      (c) => c.kind === "baileys" && c.status === "conectado",
    );
    if (channel) {
      if (!hasWorker()) {
        return { channelId: null, branchName: branch!.name, error: WORKER_DOWN };
      }
      return { channelId: channel.id, branchName: branch!.name, error: "" };
    }
  }

  return {
    channelId: null,
    branchName: preferred?.name ?? fallback?.name ?? null,
    error:
      "Ninguna sucursal tiene su WhatsApp vinculado, así que no hay número desde el cual escribirle. Vinculalo en Configuración · Sucursales.",
  };
}

const bridgeSchema = z.object({
  conversationId: z.string().uuid(),
  phone: z.string().trim().min(6, "Ese teléfono quedó corto.").max(30),
  /** vacío = solo abrir el chat, sin mandar nada */
  text: z.string().trim().max(4096).optional(),
});

export async function bridgeToWhatsapp(input: {
  conversationId: string;
  phone: string;
  text?: string;
}): Promise<ActionResult<{ conversationId: string; sent: boolean }>> {
  const parsed = bridgeSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Revisá el teléfono.");
  }
  const { supabase, member, agency } = await requireAction();

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, contact_id, branch_id, channel, contact:contacts(id, full_name, phone)")
    .eq("id", parsed.data.conversationId)
    .maybeSingle();
  if (!conversation?.contact) return fail("No encontramos la conversación.");

  const creds = await getIgCreds(agency.id);
  const phone = toE164(parsed.data.phone, creds?.bridge.countryCode ?? "54");
  if (!phone) {
    return fail("Ese teléfono no parece válido. Escribilo con característica, sin el 0 ni el 15.");
  }

  const target = await resolveBranchChannel(supabase, agency.id, conversation.branch_id);
  if (!target.channelId) return fail(target.error);

  // El teléfono queda en la ficha: es el dato que faltaba y el que hace que este
  // contacto valga.
  if (conversation.contact.phone !== phone) {
    await supabase.from("contacts").update({ phone }).eq("id", conversation.contact.id);
  }

  /* el hilo de WhatsApp: existente o nuevo */
  let targetId: string;
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("agency_id", agency.id)
    .eq("contact_id", conversation.contact_id)
    .eq("channel", "whatsapp")
    .eq("channel_id", target.channelId)
    .maybeSingle();

  if (existing) {
    targetId = existing.id;
    await supabase
      .from("conversations")
      .update({ status: "abierta", wa_id: phone })
      .eq("id", targetId);
  } else {
    const { data: created, error } = await supabase
      .from("conversations")
      .insert({
        agency_id: agency.id,
        contact_id: conversation.contact_id,
        channel: "whatsapp",
        channel_id: target.channelId,
        branch_id: conversation.branch_id,
        wa_id: phone,
        assigned_to: member.id,
        // de dónde salió esta charla
        origin_conversation_id: conversation.id,
      })
      .select("id")
      .single();
    if (error || !created) return fail("No se pudo abrir el chat de WhatsApp.");
    targetId = created.id;
  }

  /* el primer mensaje, si el vendedor quiso mandarlo */
  let sent = false;
  const body = parsed.data.text?.trim();
  if (body) {
    const res = await sendViaBaileys(target.channelId, phone, body);
    sent = res.ok;
    await supabase.from("messages").insert({
      agency_id: agency.id,
      conversation_id: targetId,
      direction: "out",
      kind: "texto",
      body,
      sent_by: member.id,
      status: res.ok ? "enviado" : "fallido",
      wa_message_id: res.ok ? res.data.waMessageId : null,
      error_detail: res.ok ? null : res.error,
      metadata: { from_instagram: true },
    });
    if (!res.ok) return fail(res.error);
  }

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    contactId: conversation.contact_id,
    type: "whatsapp",
    body: `Pasó de Instagram a WhatsApp (${fmtPhone(phone)})`,
  });

  revalidatePath("/crm");
  return succeed({ conversationId: targetId, sent });
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

  const routed = await resolveRoute(
    agency.id,
    conversation.channel_ref,
    conversation.contact?.phone ?? conversation.wa_id,
    conversation.wa_id,
  );
  if (!routed.ok) return fail(routed.error);
  const route = routed.route;

  let status: MessageStatus = "enviado";
  let waMessageId: string | null = null;
  let errorDetail: string | null = null;

  if (route.via === "baileys") {
    // por el número de la sucursal no hace falta plantilla: va como texto
    const res = await sendViaBaileys(route.channelId, route.to, parsed.data.body);
    if (res.ok) waMessageId = res.data.waMessageId;
    else {
      status = "fallido";
      errorDetail = res.error;
    }
  } else if (route.via === "instagram") {
    // Las plantillas son de WhatsApp: en Instagram no existen ni hacen falta
    // (nada se paga). El texto ya interpolado sale como un mensaje común, y la
    // ventana la valida Meta del otro lado.
    const state = windowState(conversation.last_inbound_at, route.creds.humanAgentEnabled);
    if (!state.open) return fail(IG_WINDOW_CLOSED);
    const res = await sendIgText(route.creds, route.to, parsed.data.body, {
      humanAgent: state.needsHumanAgent,
    });
    if (res.ok) waMessageId = res.messageId;
    else {
      status = "fallido";
      errorDetail = res.error;
    }
  } else {
    const res = await sendCloudTemplate(route.creds, route.to, template.meta_name);
    if (res.ok) waMessageId = res.waMessageId;
    else {
      status = "fallido";
      errorDetail = res.error;
    }
  }

  const message = await saveOutbound(supabase, {
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
    metadata: { template_id: template.id },
  });
  if (!message) return fail("No se pudo enviar la plantilla. Probá de nuevo.");

  if (status === "fallido") {
    return fail(errorDetail ?? "WhatsApp rechazó la plantilla. Probá de nuevo.");
  }

  // Sin revalidatePath: el hilo ya se actualiza optimista + realtime.
  return succeed(message);
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
