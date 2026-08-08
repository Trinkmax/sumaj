/**
 * Qué pasa cuando entra un DM de Instagram.
 *
 * SOLO SERVIDOR y con service role: el webhook no tiene sesión de usuario.
 *
 * ─────────────────────────────────────────────
 * POR QUÉ NO ES `handleInboundMessage`
 *
 * El de WhatsApp (`lib/wa/inbound.ts`) atiende los dos webhooks de WhatsApp
 * porque comparten TODO: la persona es un teléfono, el hilo es un teléfono y el
 * envío es el mismo. Instagram no comparte nada de eso — la persona es un IGSID
 * que solo existe dentro de esta cuenta, no hay teléfono en ninguna parte, la
 * respuesta sale por otra API y hay un paso más (el puente a WhatsApp) que en
 * WhatsApp no existe. Meterlo adentro con banderas habría dejado una función
 * donde la mitad de las líneas empiezan con un `if`.
 *
 * Lo que SÍ se comparte se importa: `routeToBranch` (a qué sucursal cae la
 * consulta) y `alertBranchOperators` (cómo se avisa). Las reglas de derivación
 * son las mismas para los dos canales, y tienen que seguir siéndolo.
 *
 * ─────────────────────────────────────────────
 * EL RECORRIDO
 *
 *   1. La persona: se busca por IGSID; si es nueva, se le pide el perfil a Meta
 *      (nombre y @usuario) para que en el CRM no quede un número.
 *   2. El hilo y el lead: igual que en WhatsApp — un lead abierto se reusa, y si
 *      no hay, esta consulta lo crea y se deriva a una sucursal.
 *   3. La respuesta automática, que además ofrece el salto a WhatsApp: el link
 *      `wa.me` con la referencia del puente y el botón para compartir el número.
 *   4. Si en el mensaje hay un teléfono (escrito o compartido con el botón), se
 *      guarda en la ficha y —si la agencia lo habilitó— el operador le escribe
 *      primero por WhatsApp desde el número de la sucursal.
 *
 * Como máximo sale UN mensaje de Instagram por evento entrante. Contestarle dos
 * veces seguidas a alguien que escribió una vez es lo que hace que un negocio
 * parezca un bot.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import {
  getIgUserProfile,
  markIgSeenAndTyping,
  sendIgText,
  type IgQuickReply,
} from "@/lib/ig/graph";
import type { ResolvedIgCreds } from "@/lib/ig/credentials";
import { bridgeUrl, createBridgeLink } from "@/lib/ig/bridge";
import { extractPhone, toE164 } from "@/lib/ig/phone";
import { alertBranchOperators, routeToBranch } from "@/lib/wa/inbound";
import { hasWorker, sendViaBaileys } from "@/lib/wa/worker";
import { fillTemplate } from "@/lib/domain";
import { fmtPhone } from "@/lib/format";
import type { Database } from "@/lib/database.types";
import type { Enums } from "@/lib/types";

type Admin = SupabaseClient<Database>;

const ACTIVE_STAGES: Enums<"lead_stage">[] = [
  "nuevo",
  "contactado",
  "presupuestado",
  "negociacion",
];

export type IgInboundMessage = {
  /** id del canal de Instagram de la agencia */
  channelId: string;
  /** IGSID: quién es la persona DENTRO de esta cuenta */
  igsid: string;
  /** `out` = eco: lo mandó la agencia desde la app de Instagram */
  direction: Enums<"message_direction">;
  text: string;
  kind: Enums<"message_kind">;
  /** mid de Meta: la clave de deduplicación */
  messageId: string | null;
  mediaUrl: string | null;
  /** ms epoch */
  timestamp: number;
  /** anuncio del que vino la persona, si vino de uno */
  campaign: string | null;
  /** teléfono que compartió tocando el botón (ya en formato de Meta) */
  sharedPhone: string | null;
  /** botón o ice breaker que tocó */
  postbackTitle: string | null;
  /** respondió a una historia nuestra */
  storyReply: boolean;
};

export type IgInboundResult = { ok: boolean; error?: string };

function snippet(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

/** El @usuario, normalizado como se guarda: minúsculas y sin arroba. */
function normalizeHandle(username: string | null): string | null {
  const clean = username?.trim().replace(/^@/, "").toLowerCase();
  return clean || null;
}

/**
 * Escapa los comodines de LIKE.
 *
 * NO es cosmético: los @usuario de Instagram admiten `_`, y en LIKE/ILIKE el
 * guion bajo significa "cualquier carácter". Sin esto, alguien que registra
 * `carla_gomez` matchea la ficha de `carla.gomez` y se queda con su contacto,
 * su historial y su teléfono. El patrón lo elige quien nos escribe.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/* ═══════════════════════════════════════════════════════════
   LA PERSONA
   ═══════════════════════════════════════════════════════════ */

type ContactResult = { id: string; name: string; phone: string | null; isNew: boolean };

/**
 * El contacto detrás del IGSID.
 *
 * Tres intentos, en este orden:
 *   1. Por IGSID — el único identificador estable. Es el caso normal.
 *   2. Por @usuario, si Meta nos lo dio y el contacto ya estaba cargado a mano
 *      con su Instagram. Es lo que evita el duplicado más molesto: la agencia
 *      cargó a "Juana Pérez @juanaviaja" hace un mes y hoy Juana escribe.
 *   3. Alta nueva.
 *
 * El perfil se le pide a Meta solo cuando hace falta (contacto nuevo o contacto
 * sin @usuario): es una llamada por persona, no por mensaje.
 */
async function resolveContact(
  supabase: Admin,
  creds: ResolvedIgCreds,
  igsid: string,
): Promise<ContactResult | null> {
  const agencyId = creds.agencyId;

  const { data: byId } = await supabase
    .from("contacts")
    .select("id, full_name, phone, instagram")
    .eq("agency_id", agencyId)
    .eq("ig_id", igsid)
    .maybeSingle();

  if (byId) {
    return { id: byId.id, name: byId.full_name, phone: byId.phone, isNew: false };
  }

  // Todavía no lo conocemos por Instagram: vale la llamada del perfil.
  const profile = await getIgUserProfile(creds, igsid);
  const handle = profile.ok ? normalizeHandle(profile.data.username) : null;
  const displayName = profile.ok ? profile.data.name?.trim() : null;

  if (handle) {
    // Con y sin arroba: el campo lo cargó a mano alguien del equipo y hay quien
    // escribe "@juana" y quien escribe "juana". Van dos consultas y no un `or()`
    // porque el patrón lleva escapes y la sintaxis de `or` de PostgREST no es
    // lugar para meter backslashes.
    const pattern = escapeLike(handle);
    let byHandle: { id: string; full_name: string; phone: string | null } | null = null;
    for (const candidate of [pattern, `@${pattern}`]) {
      const { data } = await supabase
        .from("contacts")
        .select("id, full_name, phone")
        .eq("agency_id", agencyId)
        .ilike("instagram", candidate)
        // Nunca se le roba la identidad a un contacto que ya tiene la suya.
        .is("ig_id", null)
        .limit(1)
        .maybeSingle();
      if (data) {
        byHandle = data;
        break;
      }
    }

    if (byHandle) {
      // Se le pega el IGSID para que a partir de ahora entre por el camino 1.
      await supabase
        .from("contacts")
        .update({ ig_id: igsid, instagram: handle })
        .eq("id", byHandle.id);
      return { id: byHandle.id, name: byHandle.full_name, phone: byHandle.phone, isNew: false };
    }
  }

  // El nombre real, el @usuario, o el IGSID como último recurso. Nunca vacío:
  // una fila sin nombre en el CRM no se puede ni buscar.
  const name = displayName || (handle ? `@${handle}` : `Instagram ${igsid.slice(-6)}`);

  const { data: created, error } = await supabase
    .from("contacts")
    .insert({
      agency_id: agencyId,
      full_name: name,
      instagram: handle,
      ig_id: igsid,
      source: "instagram",
    })
    .select("id")
    .single();

  if (error || !created) {
    // Carrera con otro mensaje del mismo lote: el índice único de (agencia,
    // ig_id) es el que garantiza que no queden dos. Releemos al ganador.
    const { data: winner } = await supabase
      .from("contacts")
      .select("id, full_name, phone")
      .eq("agency_id", agencyId)
      .eq("ig_id", igsid)
      .maybeSingle();
    if (!winner) return null;
    return { id: winner.id, name: winner.full_name, phone: winner.phone, isNew: false };
  }

  return { id: created.id, name, phone: null, isNew: true };
}

/* ═══════════════════════════════════════════════════════════
   EL PUENTE A WHATSAPP
   ═══════════════════════════════════════════════════════════ */

/**
 * A qué WhatsApp mandamos al cliente.
 *
 * El orden no es caprichoso: si el admin cargó un número a mano, manda él. Si no,
 * el de la SUCURSAL que atiende la consulta, que es lo mejor que puede pasar —
 * el cliente cae directo en el WhatsApp del vendedor que lo va a atender, sin
 * ventana de 24 hs y sin pasar por el número madre. Recién si no hay nada de eso,
 * el número madre.
 */
async function resolveBridgePhone(
  supabase: Admin,
  agencyId: string,
  branchId: string | null,
  explicit: string | null,
): Promise<string | null> {
  if (explicit) return explicit.replace(/\D/g, "") || null;

  if (branchId) {
    const { data: branchChannel } = await supabase
      .from("wa_channels")
      .select("phone, status")
      .eq("branch_id", branchId)
      .eq("kind", "baileys")
      .maybeSingle();
    if (branchChannel?.phone && branchChannel.status === "conectado") {
      return branchChannel.phone.replace(/\D/g, "");
    }
  }

  const { data: mother } = await supabase
    .from("wa_channels")
    .select("phone")
    .eq("agency_id", agencyId)
    .eq("is_mother", true)
    .maybeSingle();
  return mother?.phone?.replace(/\D/g, "") || null;
}

type WhatsappHandoff = { sent: boolean; phone: string; reason?: string };

/**
 * El operador le escribe PRIMERO por WhatsApp, desde el número de la sucursal.
 *
 * Es lo que convierte "me dejó el teléfono en un DM" en "ya tiene un WhatsApp
 * nuestro esperándolo". Sale por el número de la sucursal a propósito: es un
 * WhatsApp común, sin ventana de 24 hs ni plantillas pagas.
 *
 * Si no se puede mandar (la sucursal no tiene el número vinculado, el worker
 * está caído) igual se guarda el teléfono en la ficha y se avisa a los
 * operadores: el dato es lo valioso, el envío automático es el lujo.
 */
async function handoffToWhatsapp(
  supabase: Admin,
  creds: ResolvedIgCreds,
  input: {
    contactId: string;
    contactName: string;
    phone: string;
    branchId: string | null;
    leadId: string | null;
    igConversationId: string;
    agencyName: string;
  },
): Promise<WhatsappHandoff> {
  if (!input.branchId) return { sent: false, phone: input.phone, reason: "sin sucursal" };

  const { data: channel } = await supabase
    .from("wa_channels")
    .select("id, status")
    .eq("branch_id", input.branchId)
    .eq("kind", "baileys")
    .maybeSingle();

  if (!channel || channel.status !== "conectado" || !hasWorker()) {
    return { sent: false, phone: input.phone, reason: "sucursal sin WhatsApp vinculado" };
  }

  /* el hilo de WhatsApp: existente o nuevo, siempre del MISMO contacto */
  let conversationId: string;
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("agency_id", creds.agencyId)
    .eq("contact_id", input.contactId)
    .eq("channel", "whatsapp")
    .eq("channel_id", channel.id)
    .maybeSingle();

  if (existing) {
    conversationId = existing.id;
  } else {
    const { data: created } = await supabase
      .from("conversations")
      .insert({
        agency_id: creds.agencyId,
        contact_id: input.contactId,
        channel: "whatsapp",
        channel_id: channel.id,
        branch_id: input.branchId,
        wa_id: input.phone,
        // de dónde salió esta charla: el hilo de Instagram
        origin_conversation_id: input.igConversationId,
      })
      .select("id")
      .single();
    if (!created) return { sent: false, phone: input.phone, reason: "no se pudo abrir el chat" };
    conversationId = created.id;
  }

  const body = fillTemplate(creds.bridge.autoWaText, {
    nombre: firstName(input.contactName),
    agencia: input.agencyName,
  });

  const res = await sendViaBaileys(channel.id, input.phone, body);

  await supabase.from("messages").insert({
    agency_id: creds.agencyId,
    conversation_id: conversationId,
    direction: "out",
    kind: "texto",
    body,
    is_automated: true,
    status: res.ok ? "enviado" : "fallido",
    wa_message_id: res.ok ? res.data.waMessageId : null,
    error_detail: res.ok ? null : res.error,
    metadata: { from_instagram: true },
  });

  return { sent: res.ok, phone: input.phone, reason: res.ok ? undefined : res.error };
}

/* ═══════════════════════════════════════════════════════════
   LA ENTRADA
   ═══════════════════════════════════════════════════════════ */

export async function handleIgInbound(
  msg: IgInboundMessage,
  creds: ResolvedIgCreds,
): Promise<IgInboundResult> {
  if (!hasAdminClient()) {
    return { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY para procesar mensajes." };
  }
  const supabase = createAdminClient();
  const igsid = msg.igsid.trim();
  if (!igsid) return { ok: false, error: "Mensaje sin remitente." };

  // Un mensaje de la cuenta a sí misma (Meta lo usa para probar el webhook) no
  // es un cliente: crearle un contacto sería crear la agencia como su propio lead.
  if (creds.igUserId && igsid === creds.igUserId) return { ok: true };

  const { data: channel } = await supabase
    .from("wa_channels")
    .select("id, agency_id, kind, auto_reply_enabled, auto_reply_text")
    .eq("id", msg.channelId)
    .maybeSingle();
  if (!channel) return { ok: false, error: "Canal desconocido." };
  const agencyId = channel.agency_id;

  /* 1. la persona */
  const contact = await resolveContact(supabase, creds, igsid);
  if (!contact) return { ok: false, error: "No se pudo crear el contacto." };

  /* 2. el hilo */
  let conversationId: string;
  let isNewConversation = false;
  const { data: existingConv } = await supabase
    .from("conversations")
    .select("id, branch_id")
    .eq("agency_id", agencyId)
    .eq("contact_id", contact.id)
    .eq("channel", "instagram")
    .eq("channel_id", channel.id)
    .maybeSingle();

  if (existingConv) {
    conversationId = existingConv.id;
  } else {
    const { data: created, error } = await supabase
      .from("conversations")
      .insert({
        agency_id: agencyId,
        contact_id: contact.id,
        channel: "instagram",
        channel_id: channel.id,
        // `wa_id` es "el id del interlocutor en este canal": en WhatsApp es el
        // teléfono, acá es el IGSID. Es lo que usa el envío para saber a quién
        // escribirle.
        wa_id: igsid,
      })
      .select("id")
      .single();
    if (error || !created) return { ok: false, error: "No se pudo abrir la conversación." };
    conversationId = created.id;
    isNewConversation = true;
  }

  /* 3. el mensaje (idempotente por mid: Meta reintenta durante 36 horas) */
  if (msg.messageId) {
    const { data: dupe } = await supabase
      .from("messages")
      .select("id")
      .eq("wa_message_id", msg.messageId)
      .maybeSingle();
    if (dupe) return { ok: true };
  }

  const body = msg.storyReply
    ? msg.text
      ? `Respondió a tu historia: ${msg.text}`
      : "Respondió a tu historia"
    : msg.text;

  const { error: messageError } = await supabase.from("messages").insert({
    agency_id: agencyId,
    conversation_id: conversationId,
    direction: msg.direction,
    kind: msg.kind,
    body: body || null,
    media_url: msg.mediaUrl,
    wa_message_id: msg.messageId,
    // El eco es algo que la agencia ya mandó desde la app de Instagram: llega
    // entregado, no pendiente.
    status: "entregado",
    is_automated: false,
    created_at: new Date(msg.timestamp || Date.now()).toISOString(),
    metadata: msg.postbackTitle ? { instagram_boton: msg.postbackTitle } : {},
  });
  if (messageError) return { ok: false, error: "No se pudo guardar el mensaje." };

  // Un eco es la agencia hablando: no crea leads, no dispara automáticos y no
  // avisa a nadie. Solo tenía que quedar en el hilo.
  if (msg.direction === "out") return { ok: true };

  /* 4. el lead */
  const { data: openLead } = await supabase
    .from("leads")
    .select("id, branch_id")
    .eq("agency_id", agencyId)
    .eq("contact_id", contact.id)
    .in("stage", ACTIVE_STAGES)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let leadId = openLead?.id ?? null;
  let branchId = openLead?.branch_id ?? null;
  let leadIsNew = false;

  if (!openLead) {
    branchId = await routeToBranch(supabase, agencyId, msg.text, msg.campaign);
    const { data: createdLead } = await supabase
      .from("leads")
      .insert({
        agency_id: agencyId,
        contact_id: contact.id,
        branch_id: branchId,
        stage: "nuevo",
        origin_channel: "instagram",
        origin_campaign: msg.campaign,
        initial_message: msg.text || null,
        position: Date.now(),
      })
      .select("id")
      .single();
    leadId = createdLead?.id ?? null;
    leadIsNew = true;
  }

  if (branchId && !existingConv?.branch_id) {
    await supabase.from("conversations").update({ branch_id: branchId }).eq("id", conversationId);
  }

  /* 5. ¿dejó un teléfono? */
  // El botón es consentimiento explícito y viene ya en formato de Meta; el texto
  // libre es una lectura nuestra y por eso pasa por el extractor conservador.
  const detected =
    (msg.sharedPhone ? toE164(msg.sharedPhone, creds.bridge.countryCode) : null) ??
    extractPhone(msg.text, creds.bridge.countryCode);

  /**
   * Solo cuenta como novedad un teléfono que TODAVÍA NO TENÍAMOS. Es la guarda
   * que evita el peor comportamiento posible de esto: alguien que insiste por el
   * DM con su número —"les paso de nuevo: 381…"— y recibe un WhatsApp
   * automático por cada mensaje. Si ya lo teníamos, la charla sigue como
   * cualquier otra.
   */
  const phone = detected && detected !== contact.phone ? detected : null;
  let handoff: WhatsappHandoff | null = null;

  if (phone) {
    // Si ese número ya identifica a OTRA ficha de la agencia, no se escribe.
    // `handleInboundMessage` busca el contacto de un WhatsApp entrante con
    // `.eq("phone", …).maybeSingle()`: dos fichas con el mismo teléfono hacen
    // que esa consulta no devuelva ninguna y que cada WhatsApp de esa persona
    // cree un contacto nuevo. Un dato de más rompe más de lo que arregla.
    const { data: enUso } = await supabase
      .from("contacts")
      .select("id")
      .eq("agency_id", agencyId)
      .eq("phone", phone)
      .neq("id", contact.id)
      .limit(1)
      .maybeSingle();

    /* El UPDATE es el que decide si se escribe o no: `.is("phone", null)` lo
       convierte en un claim atómico —el mismo idiom que el canje del puente— y
       devuelve fila UNA sola vez. Sin eso, dos mensajes que llegan juntos con el
       mismo número (o alguien que insiste "les paso de nuevo: 381…") disparan
       dos WhatsApp automáticos, y un negocio que te escribe dos veces por lo
       mismo es exactamente lo que esta feature no tiene que hacer. */
    const { data: claimed } = enUso
      ? { data: null }
      : await supabase
          .from("contacts")
          .update({ phone })
          .eq("id", contact.id)
          .is("phone", null)
          .select("id")
          .maybeSingle();

    if (creds.bridge.autoWa && claimed) {
      const { data: agency } = await supabase
        .from("agencies")
        .select("name")
        .eq("id", agencyId)
        .maybeSingle();

      handoff = await handoffToWhatsapp(supabase, creds, {
        contactId: contact.id,
        contactName: contact.name,
        // El número al que se escribe es el que la persona ACABA de dar: es la
        // única señal fresca. El de la ficha puede tener meses.
        phone,
        branchId,
        leadId,
        igConversationId: conversationId,
        agencyName: agency?.name ?? "la agencia",
      });

      if (!handoff.sent) {
        // El operador igual queda avisado (paso 7) y el teléfono quedó en la
        // ficha: esto es para entender por qué no salió solo.
        console.warn(`[ig] handoff a WhatsApp sin salir: ${handoff.reason ?? "motivo desconocido"}`);
      }
    }
  }

  /* 6. la respuesta automática (una sola por evento) */
  await replyOnInstagram(supabase, creds, {
    channel,
    conversationId,
    igsid,
    contactId: contact.id,
    branchId,
    leadId,
    agencyId,
    phone,
    handoff,
    isFirstTouch: isNewConversation || leadIsNew,
  });

  /* 7. los operadores */
  if (leadIsNew || phone) {
    await alertBranchOperators(supabase, {
      agencyId,
      branchId,
      contactName: contact.name,
      contactPhone: phone ?? contact.phone,
      text: phone
        ? `Dejó su WhatsApp (${fmtPhone(phone)}) por Instagram: ${snippet(msg.text, 60)}`
        : `Consulta por Instagram: ${snippet(msg.text, 60)}`,
      conversationId,
      leadId,
    });
  }

  return { ok: true };
}

/* ═══════════════════════════════════════════════════════════
   LA RESPUESTA
   ═══════════════════════════════════════════════════════════ */

/**
 * El único mensaje que sale por Instagram ante una consulta entrante.
 *
 * Tres formas, en orden de prioridad:
 *   · Ya le escribimos por WhatsApp → se lo decimos, con el número, para que lo
 *     busque en el celular.
 *   · Nos dejó el teléfono pero el envío automático no salió (o está apagado) →
 *     le confirmamos que lo tenemos.
 *   · Primera consulta → el saludo de la agencia + el salto a WhatsApp.
 *
 * Fuera de esos casos NO se contesta nada: alguien que ya está hablando con un
 * vendedor no necesita que un robot le conteste cada mensaje.
 */
async function replyOnInstagram(
  supabase: Admin,
  creds: ResolvedIgCreds,
  input: {
    channel: { id: string; auto_reply_enabled: boolean; auto_reply_text: string | null };
    conversationId: string;
    /** a quién le contestamos */
    igsid: string;
    contactId: string;
    branchId: string | null;
    leadId: string | null;
    agencyId: string;
    phone: string | null;
    handoff: WhatsappHandoff | null;
    isFirstTouch: boolean;
  },
): Promise<void> {
  const { channel, phone, handoff, isFirstTouch } = input;

  // El interruptor de la pantalla apaga TODO lo automático de este canal, no
  // solo el saludo: una agencia que quiere atención 100% humana no espera que la
  // cuenta conteste sola porque el cliente escribió un número.
  if (!channel.auto_reply_enabled) return;

  let text: string | null = null;
  let quickReplies: IgQuickReply[] = [];

  if (handoff?.sent) {
    text = `¡Listo! Te escribimos por WhatsApp al ${fmtPhone(handoff.phone)}. Seguimos por ahí.`;
  } else if (phone) {
    text = "¡Gracias! Ya tenemos tu WhatsApp, en un ratito te escribe un asesor.";
  } else if (isFirstTouch && channel.auto_reply_text) {
    text = channel.auto_reply_text;

    if (creds.bridge.enabled) {
      const bridgePhone = await resolveBridgePhone(
        supabase,
        input.agencyId,
        input.branchId,
        creds.bridge.phone,
      );
      if (bridgePhone) {
        // La referencia es lo que hace que, cuando toque el link, del otro lado
        // sea la MISMA persona y no un contacto nuevo.
        const code = await createBridgeLink(supabase, {
          agencyId: input.agencyId,
          contactId: input.contactId,
          conversationId: input.conversationId,
          leadId: input.leadId,
        });
        text = `${text}\n\n${creds.bridge.label}: ${bridgeUrl(bridgePhone, creds.bridge.text, code)}`;
      }
      // El botón que comparte el número: Instagram se lo ofrece sacado de su
      // propio perfil, así que el cliente no tipea nada.
      quickReplies = [{ kind: "telefono" }];
    }
  }

  if (!text) return;

  // Cortesía antes del automático: el tilde de leído y los puntitos suspensivos.
  // Es best-effort: si Meta lo rechaza, el mensaje sale igual.
  await markIgSeenAndTyping(creds, input.igsid);

  const res = await sendIgText(creds, input.igsid, text, { quickReplies });

  await supabase.from("messages").insert({
    agency_id: input.agencyId,
    conversation_id: input.conversationId,
    direction: "out",
    kind: "texto",
    body: text,
    is_automated: true,
    status: res.ok ? "enviado" : "fallido",
    wa_message_id: res.ok ? res.messageId : null,
    error_detail: res.ok ? null : res.error,
    metadata: { auto_reply: true },
  });
}
