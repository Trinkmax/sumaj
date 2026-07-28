/**
 * Qué pasa cuando entra un mensaje de WhatsApp. Lo comparten los dos webhooks
 * (Cloud API del número madre y worker de Baileys de las sucursales).
 *
 * La dinámica:
 *   · Entra por el NÚMERO MADRE → contesta solo ("ya te contacta un operador"),
 *     crea el lead, lo deriva a la sucursal que corresponda y avisa a sus
 *     operadores (aviso in-app + WhatsApp al operador desde el número de la
 *     sucursal).
 *   · Entra por una SUCURSAL → es la charla real con el vendedor: se registra
 *     en el hilo de ese número. Sin ventana de 24 hs, sin plantillas pagas.
 *
 * SOLO SERVIDOR y con service role: los webhooks no tienen sesión de usuario.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { sendCloudText } from "@/lib/wa/cloud";
import { hasWorker, sendViaBaileys } from "@/lib/wa/worker";
import { fmtPhone } from "@/lib/format";
import type { Database } from "@/lib/database.types";
import type { Enums } from "@/lib/types";

/** Sirve tanto el cliente con service role (webhooks) como el de la sesión (actions). */
type Admin = SupabaseClient<Database>;

export type InboundMessage = {
  channelId: string;
  /** número del cliente, solo dígitos (E.164 sin +) */
  from: string;
  text: string;
  kind: Enums<"message_kind">;
  waMessageId: string | null;
  pushName: string | null;
  /** ms epoch */
  timestamp: number;
  /** campaña/anuncio de origen, si el canal lo informa */
  campaign?: string | null;
};

export type InboundResult = { ok: boolean; error?: string };

const ACTIVE_STAGES: Enums<"lead_stage">[] = [
  "nuevo",
  "contactado",
  "presupuestado",
  "negociacion",
];

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
}

/** Primera línea del mensaje, recortada — para previews y avisos. */
function snippet(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/* ───────────────────────── ruteo a sucursal ───────────────────────── */

async function routeToBranch(
  supabase: Admin,
  agencyId: string,
  text: string,
  campaign: string | null,
): Promise<string | null> {
  const { data: rules } = await supabase
    .from("routing_rules")
    .select("branch_id, match_type, pattern")
    .eq("agency_id", agencyId)
    .eq("is_active", true)
    .order("position", { ascending: true });

  const haystack = text.toLowerCase();
  const campaignText = (campaign ?? "").toLowerCase();

  for (const rule of rules ?? []) {
    const pattern = rule.pattern.toLowerCase().trim();
    if (!pattern) continue;
    if (rule.match_type === "palabra" && haystack.includes(pattern)) return rule.branch_id;
    if (rule.match_type === "campana" && campaignText.includes(pattern)) return rule.branch_id;
  }

  const { data: fallback } = await supabase
    .from("branches")
    .select("id")
    .eq("agency_id", agencyId)
    .eq("is_default", true)
    .eq("is_active", true)
    .maybeSingle();
  return fallback?.id ?? null;
}

/* ───────────────────────── alerta a los operadores ───────────────────────── */

/**
 * Avisa a los operadores de la sucursal que hay una consulta nueva:
 * notificación in-app siempre, y además un WhatsApp al operador desde el
 * número de la sucursal (si está vinculado y el operador tiene teléfono).
 */
export async function alertBranchOperators(
  supabase: Admin,
  input: {
    agencyId: string;
    branchId: string | null;
    contactName: string;
    contactPhone: string | null;
    text: string;
    conversationId: string;
    leadId: string | null;
  },
): Promise<void> {
  const membersQuery = supabase
    .from("members")
    .select("id, display_name, phone, role, branch_id")
    .eq("agency_id", input.agencyId)
    .eq("is_active", true);

  const { data: allMembers } = await membersQuery;
  const members = (allMembers ?? []).filter(
    (m) => m.branch_id === input.branchId || m.role === "admin",
  );
  if (members.length === 0) return;

  const link = input.leadId
    ? `/crm/${input.leadId}`
    : `/crm?vista=chats&c=${input.conversationId}`;

  await supabase.from("notifications").insert(
    members.map((m) => ({
      agency_id: input.agencyId,
      member_id: m.id,
      type: "lead_nuevo",
      title: "Consulta nueva",
      body: `${input.contactName}: ${snippet(input.text, 70)}`,
      link,
    })),
  );

  // aviso por WhatsApp desde el número de la sucursal (el mismo con el que
  // después va a contactar al cliente) — así el operador lo ve en el celular
  if (!input.branchId || !hasWorker()) return;

  const { data: branchChannel } = await supabase
    .from("wa_channels")
    .select("id, status")
    .eq("branch_id", input.branchId)
    .eq("kind", "baileys")
    .maybeSingle();
  if (!branchChannel || branchChannel.status !== "conectado") return;

  const base = appUrl();
  const body = [
    "Consulta nueva para atender",
    `${input.contactName}${input.contactPhone ? ` · ${fmtPhone(input.contactPhone)}` : ""}`,
    `"${snippet(input.text, 140)}"`,
    base ? `${base}${link}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  await Promise.all(
    members
      .filter((m) => !!m.phone)
      .map((m) => sendViaBaileys(branchChannel.id, m.phone!, body).catch(() => null)),
  );
}

/* ───────────────────────── entrada de mensajes ───────────────────────── */

export async function handleInboundMessage(msg: InboundMessage): Promise<InboundResult> {
  if (!hasAdminClient()) {
    return { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY para procesar mensajes." };
  }
  const supabase = createAdminClient();
  const phone = msg.from.replace(/\D/g, "");
  if (!phone) return { ok: false, error: "Mensaje sin número de origen." };

  const { data: channel } = await supabase
    .from("wa_channels")
    .select(
      "id, agency_id, branch_id, kind, is_mother, phone_number_id, auto_reply_enabled, auto_reply_text",
    )
    .eq("id", msg.channelId)
    .maybeSingle();
  if (!channel) return { ok: false, error: "Canal desconocido." };

  const agencyId = channel.agency_id;

  /* 1. contacto */
  let contactId: string;
  let contactName: string;
  const { data: existingContact } = await supabase
    .from("contacts")
    .select("id, full_name")
    .eq("agency_id", agencyId)
    .eq("phone", phone)
    .maybeSingle();

  if (existingContact) {
    contactId = existingContact.id;
    contactName = existingContact.full_name;
  } else {
    contactName = msg.pushName?.trim() || fmtPhone(phone);
    const { data: created, error } = await supabase
      .from("contacts")
      .insert({
        agency_id: agencyId,
        full_name: contactName,
        phone,
        source: "whatsapp",
      })
      .select("id")
      .single();
    if (error || !created) return { ok: false, error: "No se pudo crear el contacto." };
    contactId = created.id;
  }

  /* 2. conversación del canal por el que entró */
  let conversationId: string;
  let isNewConversation = false;
  const { data: existingConv } = await supabase
    .from("conversations")
    .select("id, branch_id")
    .eq("agency_id", agencyId)
    .eq("contact_id", contactId)
    .eq("channel", "whatsapp")
    .eq("channel_id", channel.id)
    .maybeSingle();

  if (existingConv) {
    conversationId = existingConv.id;
  } else {
    const { data: created, error } = await supabase
      .from("conversations")
      .insert({
        agency_id: agencyId,
        contact_id: contactId,
        channel: "whatsapp",
        channel_id: channel.id,
        branch_id: channel.branch_id,
        wa_id: phone,
      })
      .select("id")
      .single();
    if (error || !created) return { ok: false, error: "No se pudo abrir la conversación." };
    conversationId = created.id;
    isNewConversation = true;
  }

  /* 3. mensaje (idempotente por wa_message_id: los webhooks reintentan) */
  if (msg.waMessageId) {
    const { data: dupe } = await supabase
      .from("messages")
      .select("id")
      .eq("wa_message_id", msg.waMessageId)
      .maybeSingle();
    if (dupe) return { ok: true };
  }

  const { error: messageError } = await supabase.from("messages").insert({
    agency_id: agencyId,
    conversation_id: conversationId,
    direction: "in",
    kind: msg.kind,
    body: msg.text || null,
    wa_message_id: msg.waMessageId,
    status: "entregado",
    created_at: new Date(msg.timestamp || Date.now()).toISOString(),
  });
  if (messageError) return { ok: false, error: "No se pudo guardar el mensaje." };

  /* 4. lead: si no hay uno abierto, esta consulta lo crea */
  const { data: openLead } = await supabase
    .from("leads")
    .select("id, branch_id")
    .eq("agency_id", agencyId)
    .eq("contact_id", contactId)
    .in("stage", ACTIVE_STAGES)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let leadId = openLead?.id ?? null;
  let branchId = openLead?.branch_id ?? channel.branch_id ?? null;
  let leadIsNew = false;

  if (!openLead) {
    if (!branchId) {
      branchId = await routeToBranch(supabase, agencyId, msg.text, msg.campaign ?? null);
    }
    const { data: createdLead } = await supabase
      .from("leads")
      .insert({
        agency_id: agencyId,
        contact_id: contactId,
        branch_id: branchId,
        stage: "nuevo",
        origin_channel: "whatsapp",
        origin_campaign: msg.campaign ?? null,
        initial_message: msg.text || null,
        position: Date.now(),
      })
      .select("id")
      .single();
    leadId = createdLead?.id ?? null;
    leadIsNew = true;
  }

  // la conversación del madre también queda etiquetada con la sucursal derivada
  if (branchId && !existingConv?.branch_id) {
    await supabase.from("conversations").update({ branch_id: branchId }).eq("id", conversationId);
  }

  /* 5. respuesta automática del número madre */
  if (
    channel.is_mother &&
    channel.auto_reply_enabled &&
    channel.auto_reply_text &&
    (isNewConversation || leadIsNew)
  ) {
    const text = channel.auto_reply_text;
    const result = channel.phone_number_id
      ? await sendCloudText(channel.phone_number_id, phone, text)
      : ({ ok: false, error: "sin phone_number_id" } as const);

    await supabase.from("messages").insert({
      agency_id: agencyId,
      conversation_id: conversationId,
      direction: "out",
      kind: "texto",
      body: text,
      is_automated: true,
      status: result.ok ? "enviado" : "fallido",
      wa_message_id: result.ok ? result.waMessageId : null,
      error_detail: result.ok ? null : result.error,
      metadata: { auto_reply: true },
    });
  }

  /* 6. alerta a los operadores de la sucursal */
  if (leadIsNew) {
    await alertBranchOperators(supabase, {
      agencyId,
      branchId,
      contactName,
      contactPhone: phone,
      text: msg.text,
      conversationId,
      leadId,
    });
  }

  return { ok: true };
}
