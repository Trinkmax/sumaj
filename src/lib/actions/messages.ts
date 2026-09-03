"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  requireAction,
  succeed,
  fail,
  logActivity,
  notifyLeadAssigned,
  reassignLeadCore,
  type ActionResult,
} from "@/lib/actions/core";
import {
  sendCloudMedia,
  sendCloudTemplateMessage,
  sendCloudText,
  uploadCloudMedia,
  type CloudCreds,
  type CloudMediaKind,
} from "@/lib/wa/cloud";
import { readMedia } from "@/lib/media/store";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { getCloudCreds } from "@/lib/wa/cloud-credentials";
import { hasWorker, sendBaileysText, sendViaBaileys } from "@/lib/wa/worker";
import {
  BAILEYS_MAX_BYTES,
  type BaileysQuoted,
  type BaileysSendContent,
} from "@/lib/wa/worker-contract";
import { saveOutboundMessage, type SentMessage } from "@/lib/wa/message-row";
import { alertBranchOperators } from "@/lib/wa/inbound";
import { sendIgText } from "@/lib/ig/graph";
import { getIgCreds, type ResolvedIgCreds } from "@/lib/ig/credentials";
import { toE164 } from "@/lib/ig/phone";
import { fillTemplate, motivoPlantillaNoEnviable } from "@/lib/domain";
import { fmtPhone } from "@/lib/format";
import type { MessageKind, MessageMedia, MessageMetadata, MessageStatus } from "@/lib/types";

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * La ventana de Instagram con el tag HUMAN_AGENT: 7 días desde el último
 * mensaje de la persona. Solo para las agencias que tienen el feature aprobado
 * por Meta (ver `ig_accounts.human_agent_enabled`).
 */
const IG_HUMAN_AGENT_MS = 7 * 24 * 60 * 60 * 1000;


/** Todo lo que hace falta para saber por qué canal sale el mensaje. */
const CONVERSATION_WITH_CHANNEL =
  "id, channel, last_inbound_at, wa_id, branch_id, contact:contacts(id, full_name, phone, wa_lid), channel_ref:wa_channels(id, kind, status, label)";

/* Motivos por los que un mensaje no puede salir. Son textos distintos a
   propósito: el vendedor tiene que saber si le falta el teléfono del cliente,
   si el número de la sucursal está sin vincular o si todavía no hay número
   madre — cada caso lo arregla otra persona en otra pantalla. */
const NO_PHONE =
  "Este contacto no tiene teléfono cargado. Agregalo en su ficha y volvé a escribirle.";
/* El hilo vino por LID: sabemos quién es pero WhatsApp todavía no compartió el
   número, y por el número madre (Cloud API) no se puede escribir a un LID. */
const NO_PHONE_YET =
  "Todavía no tenemos el número de esta persona: WhatsApp lo comparte cuando vuelve a escribir. Cargalo en su ficha si lo tenés.";
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
  | {
      via: "baileys";
      channelId: string;
      /** teléfono (dígitos), o "" cuando el hilo vino por LID sin número */
      to: string;
      /** Linked ID, solo cuando no hay teléfono (ver `BaileysSendRequest.toLid`) */
      toLid: string | null;
    }
  | { via: "cloud"; creds: CloudCreds; to: string }
  | { via: "instagram"; creds: ResolvedIgCreds; to: string };

/** A quién se le escribe por WhatsApp: teléfono y/o LID, nunca uno disfrazado del otro. */
type WaTarget = { phone: string | null; lid: string | null };

const PHONE_DIGITS = /^\d{8,15}$/;

/**
 * El destinatario de WhatsApp de un hilo.
 *
 * `conversations.wa_id` es "el id del interlocutor en este canal" y desde que
 * los chats de sucursal pueden llegar por LID ya no es siempre un teléfono:
 * puede ser `lid:<dígitos>`, y el contacto puede no tener número todavía.
 * Antes se hacía `contact.phone ?? wa_id` y el "lid:2462…" viajaba al worker
 * como si fuera un teléfono. Acá el teléfono es teléfono solo si tiene pinta
 * de tal, y el LID sale de la ficha (`contacts.wa_lid`, 0032) o del hilo.
 */
function waTarget(conversation: {
  wa_id: string | null;
  contact: { phone: string | null; wa_lid: string | null } | null;
}): WaTarget {
  const asPhone = (v: string | null | undefined) => {
    const s = v?.trim() ?? "";
    // el "lid:" se descarta ANTES de sacar lo que no es dígito: si no, el LID
    // pelado pasa por un teléfono largo
    if (!s || s.startsWith("lid:")) return null;
    const digits = s.replace(/\D/g, "");
    return PHONE_DIGITS.test(digits) ? digits : null;
  };
  const waId = conversation.wa_id?.trim() ?? "";
  const phone = asPhone(conversation.contact?.phone) ?? asPhone(waId);
  const lid =
    conversation.contact?.wa_lid?.trim() ||
    (waId.startsWith("lid:") ? waId.slice(4).replace(/\D/g, "") : "") ||
    null;
  return { phone, lid };
}

/** Lo que va en `wa_id` al abrir un hilo de WhatsApp para esta persona. */
function waIdFor(target: WaTarget): string | null {
  return target.phone ?? (target.lid ? `lid:${target.lid}` : null);
}

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
  /** teléfono y/o LID del contacto (WhatsApp) — en Instagram no sirve */
  target: WaTarget,
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

  if (channel.kind === "baileys") {
    /* Por el número de la sucursal alcanza con el LID: el worker le escribe al
       JID `<lid>@lid` igual que WhatsApp nos escribió a nosotros. */
    if (!target.phone && !target.lid) return { ok: false, error: NO_PHONE };
    // El orden importa: primero el estado del número (lo resuelve la agencia
    // escaneando el QR), después la infraestructura (la resuelve el sistema).
    if (channel.status !== "conectado") return { ok: false, error: BRANCH_UNLINKED };
    if (!hasWorker()) return { ok: false, error: WORKER_DOWN };
    return {
      ok: true,
      route: {
        via: "baileys",
        channelId: channel.id,
        to: target.phone ?? "",
        toLid: target.phone ? null : target.lid,
      },
    };
  }

  /* La Cloud API solo conoce teléfonos. Un hilo por LID sin número no puede
     salir por el madre: se dice por qué, que no es lo mismo que "sin teléfono". */
  if (!target.phone) return { ok: false, error: target.lid ? NO_PHONE_YET : NO_PHONE };

  const creds = await getCloudCreds(agencyId);
  if (!creds || !creds.phoneNumberId) return { ok: false, error: MOTHER_MISSING };
  return { ok: true, route: { via: "cloud", creds, to: target.phone } };
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
  /** id (nuestro) del mensaje al que responde, si el composer lo mandó citando */
  quotedMessageId: z.string().uuid().optional().nullable(),
});

/**
 * El mensaje citado, en la forma que entiende el worker: Baileys solo necesita
 * la key (id externo + si lo mandamos nosotros) y un texto para pintar la cita
 * del lado del cliente. Se resuelve de la fila y no del cliente, que solo
 * manda el id: lo que se cita tiene que ser lo que hay en el hilo.
 *
 * Null si no se puede citar (no es de este hilo, o nunca tuvo id externo —un
 * mensaje que falló, una nota interna): se manda sin cita antes que fallar.
 */
async function resolveQuoted(
  supabase: Awaited<ReturnType<typeof requireAction>>["supabase"],
  conversationId: string,
  quotedMessageId: string | null | undefined,
): Promise<BaileysQuoted | null> {
  if (!quotedMessageId) return null;
  const { data } = await supabase
    .from("messages")
    .select("wa_message_id, direction, body")
    .eq("id", quotedMessageId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (!data?.wa_message_id) return null;
  return { id: data.wa_message_id, fromMe: data.direction === "out", text: data.body };
}

export async function sendMessage(input: {
  conversationId: string;
  body: string;
  quotedMessageId?: string | null;
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
    waTarget(conversation),
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
  const metadata: MessageMetadata = {};

  if (route.via === "baileys") {
    // La cita solo viaja por el número de la sucursal: es lo único que Baileys
    // sabe hacer con ella. Por los canales de Meta el mensaje sale suelto.
    const quoted = await resolveQuoted(supabase, conversation.id, parsed.data.quotedMessageId);
    const res = await sendBaileysText(route.channelId, route.to, parsed.data.body, {
      toLid: route.toLid,
      quoted: quoted ?? undefined,
      clientRef: conversation.id,
    });
    if (res.ok) {
      waMessageId = res.data.waMessageId;
      if (quoted) metadata.quoted = quoted;
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
  const message = await saveOutboundMessage(supabase, {
    agency_id: agency.id,
    conversation_id: conversation.id,
    direction: "out",
    kind: "texto",
    body: parsed.data.body,
    sent_by: member.id,
    status,
    wa_message_id: waMessageId,
    error_detail: errorDetail,
    metadata,
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
    .select("id, contact_id, wa_id, contact:contacts(id, full_name, phone, wa_lid)")
    .eq("id", parsed.data.conversationId)
    .maybeSingle();
  if (!conversation) return fail("No encontramos la conversación.");
  /* El mismo guard que el envío: el hilo nuevo hereda el teléfono si lo hay y,
     si no, el LID con prefijo. Copiar `wa_id` crudo dejaba "lid:…" como si
     fuera un número. */
  const target = waTarget(conversation);

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
        wa_id: waIdFor(target),
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
    .select("id, assigned_to")
    .eq("agency_id", agency.id)
    .eq("contact_id", conversation.contact_id)
    .in("stage", ["nuevo", "contactado", "presupuestado", "negociacion"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let assignedTo = lead?.assigned_to ?? null;
  if (lead) {
    await supabase.from("leads").update({ branch_id: branch.id }).eq("id", lead.id);

    /* Si la sucursal no tiene staff (solo freelances), el lead que cae ahí sin
       vendedor no lo vería nadie hasta que un admin lo reparta a mano. La base
       elige al freelance con menos leads abiertos; con staff devuelve null y el
       staff reparte como siempre. Lo mismo que hace el webhook al crear el lead.
       `actorId` null a propósito: el admin derivó, pero al vendedor lo eligió
       la base —el historial tiene que decir "reparto automático", no que el
       admin lo asignó a dedo. */
    if (!assignedTo) {
      const { data: operator } = await supabase.rpc("pick_branch_operator", {
        p_agency: agency.id,
        p_branch: branch.id,
      });
      if (operator) {
        const res = await reassignLeadCore(
          supabase,
          { agencyId: agency.id, actorId: null },
          lead.id,
          operator,
        );
        if (res.ok) assignedTo = operator;
      }
    }
  }

  await alertBranchOperators(supabase, {
    agencyId: agency.id,
    branchId: branch.id,
    contactName: conversation.contact?.full_name ?? "Consulta",
    // null si todavía no hay número: el aviso no muestra un "lid:…" como teléfono
    contactPhone: target.phone,
    text: "Consulta derivada desde el número madre.",
    conversationId: targetId,
    leadId: lead?.id ?? null,
    assignedTo,
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
   sendMediaMessage — mandar un archivo.

   El binario NO viaja por la server action: lo sube el navegador directo al
   bucket privado (la RLS de storage ya lo encierra en la carpeta de la agencia,
   igual que los vouchers de los files), y acá llega solo el path. Es lo que
   permite mandar un PDF de 20 MB sin chocar contra el límite de body de una
   server action, y de paso el archivo queda guardado aunque Meta lo rechace.
   ─────────────────────────────────────────── */

/** De nuestro `message_kind` al `type` que entiende la Cloud API. */
const CLOUD_KIND: Record<string, CloudMediaKind> = {
  imagen: "image",
  video: "video",
  audio: "audio",
  documento: "document",
};

/** El tipo de mensaje que le corresponde a un archivo, según su MIME. */
function kindForMime(mime: string): MessageKind {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  if (base.startsWith("image/")) return "imagen";
  if (base.startsWith("video/")) return "video";
  if (base.startsWith("audio/")) return "audio";
  return "documento";
}

const mediaSchema = z.object({
  conversationId: z.string().uuid(),
  /** path dentro del bucket `attachments`, ya subido por el navegador */
  path: z.string().trim().min(3).max(400),
  mime: z.string().trim().min(3).max(120),
  name: z.string().trim().max(200).nullable().optional(),
  size: z.number().int().nonnegative().optional(),
  /** nota de voz grabada (Ogg/Opus) en vez de un archivo de audio adjunto */
  voice: z.boolean().optional(),
  /** figurita (webp): sale sin burbuja; solo por el número de la sucursal */
  sticker: z.boolean().optional(),
  /** segundos, si los sabemos */
  duration: z.number().nonnegative().optional(),
  caption: z.string().trim().max(1024).optional(),
});

/**
 * Cuánto tiempo vive la URL firmada con la que el worker baja el archivo del
 * bucket. Cinco minutos: el worker la usa apenas la recibe, y una URL que
 * sobrevive más de lo necesario es una URL que alguien puede reusar.
 */
const SIGNED_URL_TTL_S = 300;

/**
 * El contenido para el worker, según lo que se está mandando. El binario NO
 * viaja: va el link firmado del bucket y el worker lo streamea a WhatsApp.
 *
 * `media.name` decide el nombre con el que el cliente ve un documento; si no
 * lo hay, se inventa uno con la extensión del MIME para que el celular sepa
 * con qué abrirlo.
 */
function baileysContentFor(
  url: string,
  media: MessageMedia,
  caption: string | null,
  kind: MessageKind,
): BaileysSendContent {
  const size = media.size ?? null;
  if (media.sticker) return { type: "sticker", url, animated: media.animated === true };
  if (kind === "imagen") return { type: "image", url, mime: media.mime, caption, size };
  if (kind === "video") return { type: "video", url, mime: media.mime, caption, size };
  if (kind === "audio") {
    return {
      type: "audio",
      url,
      mime: media.mime,
      voice: media.voice === true,
      seconds: media.duration ?? null,
      size,
    };
  }
  const ext = media.mime.split("/")[1]?.split(";")[0] ?? "bin";
  return {
    type: "document",
    url,
    mime: media.mime,
    fileName: media.name?.trim() || `archivo.${ext}`,
    caption,
    size,
  };
}

export async function sendMediaMessage(
  input: z.infer<typeof mediaSchema>,
): Promise<ActionResult<SentMessage>> {
  const parsed = mediaSchema.safeParse(input);
  if (!parsed.success) return fail("No pudimos preparar el archivo. Probá de nuevo.");
  const { supabase, member, agency } = await requireAction();

  /* El path viene del cliente y lo usa un cliente con service role, que no tiene
     RLS que lo frene: si no se valida acá, alguien podría mandar el archivo de
     otra agencia. La RLS del bucket solo cubre la subida. */
  if (!parsed.data.path.startsWith(`${agency.id}/`)) {
    return fail("Ese archivo no es de esta agencia.");
  }

  const { data: conversation } = await supabase
    .from("conversations")
    .select(CONVERSATION_WITH_CHANNEL)
    .eq("id", parsed.data.conversationId)
    .maybeSingle();
  if (!conversation) return fail("No encontramos la conversación.");

  const routed = await resolveRoute(
    agency.id,
    conversation.channel_ref,
    waTarget(conversation),
    conversation.wa_id,
  );
  if (!routed.ok) return fail(routed.error);
  const route = routed.route;

  const kind = kindForMime(parsed.data.mime);
  const media: MessageMedia = {
    path: parsed.data.path,
    mime: parsed.data.mime,
    name: parsed.data.name ?? null,
    size: parsed.data.size ?? null,
    duration: parsed.data.duration ?? null,
    voice: parsed.data.voice === true,
    ...(parsed.data.sticker ? { sticker: true } : {}),
  };

  let status: MessageStatus = "enviado";
  let waMessageId: string | null = null;
  let errorDetail: string | null = null;

  if (route.via === "baileys") {
    /* Por el número de la sucursal el archivo NO pasa por acá: se firma el path
       del bucket por unos minutos y el worker lo baja de ahí y lo sube a
       WhatsApp. Hace falta el cliente con service role porque el bucket es
       privado y la URL tiene que valer para un proceso que no tiene sesión. */
    if (!hasAdminClient()) {
      return fail(
        "El sistema no puede firmar el archivo para el número de la sucursal (falta la service role). Avisale a quien administra el sistema.",
      );
    }

    const { data: signed, error: signError } = await createAdminClient()
      .storage.from("attachments")
      .createSignedUrl(parsed.data.path, SIGNED_URL_TTL_S);
    if (signError || !signed?.signedUrl) {
      return fail("No pudimos leer el archivo que se subió. Probá de nuevo.");
    }

    const content = baileysContentFor(signed.signedUrl, media, parsed.data.caption ?? null, kind);
    // El tamaño lo sabemos antes de molestar al worker: si no entra, no entra.
    const tope = BAILEYS_MAX_BYTES[content.type as keyof typeof BAILEYS_MAX_BYTES];
    if (tope && media.size && media.size > tope) {
      return fail("El archivo es demasiado pesado para WhatsApp.");
    }

    const res = await sendViaBaileys(route.channelId, {
      to: route.to,
      ...(route.toLid ? { toLid: route.toLid } : {}),
      clientRef: conversation.id,
      content,
    });
    /* Sin fila si el worker dijo que no: la fila existe recién cuando ACEPTÓ.
       Un archivo rechazado por pesado o por tipo no es un mensaje que salió
       mal, es uno que no salió, y el vendedor lo ve en el toast. */
    if (!res.ok) return fail(res.error);

    waMessageId = res.data.waMessageId;
    // `pending`: el worker lo termina en background y avisa con `send_result`,
    // que lo lleva a enviado o fallido. Hasta entonces la burbuja muestra el
    // relojito.
    if (res.data.pending) status = "pendiente";
  } else if (route.via === "cloud") {
    const { open } = windowState(conversation.last_inbound_at, false);
    if (!open) {
      return fail(
        "Fuera de la ventana de 24 hs del número madre. Derivá el chat a una sucursal para seguir sin costo.",
      );
    }

    const bytes = await readMedia(parsed.data.path);
    if (!bytes) return fail("No pudimos leer el archivo que se subió. Probá de nuevo.");

    // Meta pide el archivo en dos pasos: primero se sube y recién con el id que
    // devuelve se manda el mensaje.
    const upload = await uploadCloudMedia(route.creds, {
      body: bytes,
      mime: parsed.data.mime,
      filename: parsed.data.name ?? `archivo.${parsed.data.mime.split("/")[1] ?? "bin"}`,
    });
    if (!upload.ok) return fail(upload.error);

    const res = await sendCloudMedia(route.creds, route.to, {
      kind: CLOUD_KIND[kind] ?? "document",
      mediaId: upload.data.id,
      caption: parsed.data.caption ?? null,
      filename: parsed.data.name ?? null,
      voice: media.voice,
    });
    if (res.ok) waMessageId = res.waMessageId;
    else {
      status = "fallido";
      errorDetail = res.error;
    }
  } else {
    // Instagram todavía no manda archivos: el envío falla explícito en vez de
    // guardar una burbuja que el cliente nunca recibió.
    return fail("Por Instagram todavía se pueden mandar solo mensajes de texto.");
  }

  const message = await saveOutboundMessage(supabase, {
    agency_id: agency.id,
    conversation_id: conversation.id,
    direction: "out",
    kind,
    body: parsed.data.caption ?? null,
    media: media as never,
    sent_by: member.id,
    status,
    wa_message_id: waMessageId,
    error_detail: errorDetail,
    metadata: {},
  });
  if (!message) return fail("No se pudo enviar. Revisá tu conexión y probá de nuevo.");

  if (status === "fallido") {
    return fail(errorDetail ?? "WhatsApp rechazó el archivo. Probá de nuevo.");
  }
  return succeed(message);
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
        // sin assigned_to: lo hereda del lead por trigger (0030)
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
    const res = await sendBaileysText(target.channelId, phone, body, { clientRef: targetId });
    sent = res.ok;
    // Tolerando el eco del worker (ver `saveOutboundMessage`): el hilo ya
    // existe, así que el eco puede ganarle a este insert.
    await saveOutboundMessage(supabase, {
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
   fuera de la ventana de 24 hs).
   ─────────────────────────────────────────── */

const templateSchema = z.object({
  conversationId: z.string().uuid(),
  templateId: z.string().uuid(),
  /**
   * Los valores de las `{{variables}}`, por nombre. El texto final NO viene del
   * cliente: lo arma el servidor con `fillTemplate` sobre el cuerpo guardado.
   * Antes llegaba el body ya interpolado y se guardaba tal cual, así que lo que
   * quedaba en el hilo era lo que el navegador decía haber mandado y no lo que
   * Meta recibió — y Meta arma el mensaje con estos parámetros, no con el texto.
   */
  vars: z.record(z.string(), z.string().trim().max(1024)).default({}),
});

export async function sendTemplate(input: {
  conversationId: string;
  templateId: string;
  vars?: Record<string, string>;
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

  /* El `agency_id` explícito no es redundante con la RLS: `my_agency_ids()` es
     plural y la sesión resuelve UNA agencia. Sin el filtro, alguien activo en
     dos agencias podría mandarle a un cliente de la A una plantilla de la B —y
     con el `meta_name` de la B contra la WABA de la A, que ni existe. Mismo
     criterio que ya usa `submitTemplateToMeta`. */
  const { data: template } = await supabase
    .from("wa_templates")
    .select("id, name, meta_name, language, meta_status, body")
    .eq("id", parsed.data.templateId)
    .eq("agency_id", agency.id)
    .maybeSingle();
  if (!template) return fail("No encontramos la plantilla.");

  const routed = await resolveRoute(
    agency.id,
    conversation.channel_ref,
    waTarget(conversation),
    conversation.wa_id,
  );
  if (!routed.ok) return fail(routed.error);
  const route = routed.route;

  /* Las variables mandan: el cuerpo guardado es el contrato con Meta. Una sola
     sin valor hace que Meta rechace el mensaje ENTERO, así que se corta acá y
     con el nombre de la que falta — no vale mandar "{{destino}}" a un cliente. */
  const requeridas = [...template.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  const vars: Record<string, string> = {};
  const faltantes: string[] = [];
  for (const nombre of requeridas) {
    const valor = parsed.data.vars[nombre]?.trim();
    if (valor) vars[nombre] = valor;
    else if (!faltantes.includes(nombre)) faltantes.push(nombre);
  }
  if (faltantes.length > 0) {
    return fail(
      `Falta completar ${faltantes.map((v) => `{{${v}}}`).join(", ")} para poder mandar «${template.name}».`,
    );
  }

  const body = fillTemplate(template.body, vars);

  let status: MessageStatus = "enviado";
  let waMessageId: string | null = null;
  let errorDetail: string | null = null;
  /** Lo que dijo Meta palabra por palabra, para poder diagnosticar después. */
  let errorCrudo: { code: number | null; raw: string } | null = null;

  if (route.via === "baileys") {
    // por el número de la sucursal no hace falta plantilla: va como texto
    const res = await sendBaileysText(route.channelId, route.to, body, {
      toLid: route.toLid,
      clientRef: conversation.id,
    });
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
    const res = await sendIgText(route.creds, route.to, body, {
      humanAgent: state.needsHumanAgent,
    });
    if (res.ok) waMessageId = res.messageId;
    else {
      status = "fallido";
      errorDetail = res.error;
    }
  } else {
    /* Recién acá se exige el estado en Meta: por Baileys y por Instagram la
       plantilla es texto y no hay nada que aprobar. Mismo criterio que usa la
       pantalla para no ofrecerla — la regla vive en domain.ts para que no puedan
       discrepar. */
    const motivo = motivoPlantillaNoEnviable(template);
    if (motivo) {
      return fail(
        `«${template.name}» no se puede mandar por WhatsApp: ${motivo} Revisala en Configuración → Plantillas.`,
      );
    }

    /* `sendCloudTemplateMessage` y no `sendCloudTemplate`: hay que mandar el
       IDIOMA REAL de la fila (el otro asumía es_AR y hacía fallar cualquier
       plantilla en otro idioma) y los parámetros del cuerpo (sin ellos Meta
       rechaza con 132000 toda plantilla que tenga variables). Es la misma
       función que usan las difusiones, que es el camino que sí funcionaba. */
    const res = await sendCloudTemplateMessage(route.creds, route.to, {
      name: template.meta_name,
      language: template.language,
      bodyParams: vars,
      /* Sin componente de botones: el payload de atribución es cosa de las
         difusiones. Acá los botones salen con el suyo por defecto. */
      buttons: [],
    });
    if (res.ok) waMessageId = res.waMessageId;
    else {
      status = "fallido";
      errorDetail = res.error;
      errorCrudo = { code: res.code, raw: res.raw };
    }
  }

  const message = await saveOutboundMessage(supabase, {
    agency_id: agency.id,
    conversation_id: conversation.id,
    direction: "out",
    kind: "plantilla",
    body,
    template_name: template.meta_name,
    sent_by: member.id,
    status,
    wa_message_id: waMessageId,
    error_detail: errorDetail,
    metadata: {
      template_id: template.id,
      ...(errorCrudo ? { meta_error: errorCrudo } : {}),
    },
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

   Desde la 0030 el dueño de un chat es el dueño del LEAD del contacto: un
   trigger copia `leads.assigned_to` a todas las conversaciones del contacto y
   pisa cualquier valor que se escriba a mano. Así que "asignar el chat" es
   reasignar el lead abierto; solo los hilos sin lead (los que abre una
   difusión, que todavía no son una oportunidad) se asignan directo.
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
  const { supabase, agency, member, isAdmin } = await requireAction();
  // misma regla que reassignLead: repartir el trabajo lo hace un admin
  if (!isAdmin) return fail("La asignación de vendedores la maneja un admin.");

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, contact_id, assigned_to, contact:contacts(full_name)")
    .eq("id", parsed.data.conversationId)
    .eq("agency_id", agency.id)
    .maybeSingle();
  if (!conversation) return fail("No encontramos la conversación.");

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
    // memberId null = desasignar: el lead queda sin vendedor y el trigger
    // deja el chat en el pool (o con el dueño de un lead cerrado, si lo hay).
    const res = await reassignLeadCore(
      supabase,
      { agencyId: agency.id, actorId: member.id },
      lead.id,
      parsed.data.memberId,
    );
    if (!res.ok) return fail(res.error);
    revalidatePath("/crm");

    /* Desasignar con lead abierto: el lead sí quedó sin vendedor, pero el chat
       lo decide el trigger, y si el contacto tiene un lead CERRADO con
       vendedor, el chat se queda con ese dueño. Se lee lo que quedó y se avisa
       con el mismo texto que el camino sin lead, en vez de mostrar "quedó sin
       asignar" sobre un chat que sigue asignado. */
    if (parsed.data.memberId === null) {
      const { data: after } = await supabase
        .from("conversations")
        .select("assigned_to")
        .eq("id", conversation.id)
        .maybeSingle();
      const quedo = after?.assigned_to ?? null;
      if (quedo) {
        const { data: owner } = await supabase
          .from("members")
          .select("display_name")
          .eq("id", quedo)
          .maybeSingle();
        return fail(
          `El lead quedó sin vendedor, pero este chat sigue a ${owner?.display_name ?? "su vendedor"}: es el dueño del último lead cerrado de este contacto.`,
        );
      }
    }
    return succeed(null);
  }

  // No confiar en el memberId del cliente: tiene que ser de la misma agencia.
  let assigneeName: string | null = null;
  if (parsed.data.memberId) {
    const { data: target } = await supabase
      .from("members")
      .select("id, display_name")
      .eq("id", parsed.data.memberId)
      .eq("agency_id", agency.id)
      .maybeSingle();
    if (!target) return fail("Vendedor inválido.");
    assigneeName = target.display_name;
  }

  /* Sin lead abierto se escribe el chat directo… pero el trigger
     `conversation_inherit_owner` tiene la última palabra: si el contacto tiene
     un lead CERRADO con vendedor (el que le vendió sigue siendo su dueño), lo
     que se escriba acá se pisa con ese dueño. Se lee lo que quedó y, si no es
     lo que pidió el admin, se le dice por qué en vez de festejar una asignación
     que no pasó. */
  const { data: updated, error } = await supabase
    .from("conversations")
    .update({ assigned_to: parsed.data.memberId })
    .eq("id", conversation.id)
    .select("assigned_to")
    .maybeSingle();
  if (error) return fail("No se pudo asignar la conversación.");

  const quedo = updated?.assigned_to ?? null;
  if (quedo !== parsed.data.memberId) {
    if (quedo) {
      const { data: owner } = await supabase
        .from("members")
        .select("display_name")
        .eq("id", quedo)
        .maybeSingle();
      return fail(
        `Este chat sigue a ${owner?.display_name ?? "su vendedor"}: es el dueño del último lead de este contacto. Para cambiarlo, reasigná ese lead desde el CRM.`,
      );
    }
    return fail("No se pudo asignar la conversación.");
  }

  // El mismo aviso que recibe quien se lleva un lead: en la campana no importa
  // si lo que llegó fue un lead o un hilo de difusión, importa que hay alguien
  // esperando.
  if (parsed.data.memberId && parsed.data.memberId !== member.id && quedo !== conversation.assigned_to) {
    await notifyLeadAssigned(supabase, {
      agencyId: agency.id,
      memberId: parsed.data.memberId,
      leadId: null,
      conversationId: conversation.id,
      contactName: conversation.contact?.full_name ?? "Chat",
    });
  }

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    contactId: conversation.contact_id,
    type: "sistema",
    body: assigneeName ? `Chat asignado a ${assigneeName}` : "Chat sin asignar",
  });

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
