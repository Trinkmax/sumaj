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
 *
 * Las credenciales de Meta llegan ya resueltas desde el webhook (`creds`): acá
 * no se toca `cloud-credentials` porque quien recibe el POST es el único que
 * sabe de qué agencia es el mensaje (por el slug de la URL o el phone number ID).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { cloudFailure, sendCloudText, type CloudCreds, type CloudResult } from "@/lib/wa/cloud";
import { hasWorker, sendBaileysText } from "@/lib/wa/worker";
import { autoAssignmentActivityText, notifyLeadAssigned } from "@/lib/actions/core";
import {
  attachBridgeConversation,
  findBridgeCode,
  redeemBridgeLink,
  releaseBridgeLink,
} from "@/lib/ig/bridge";
import {
  attributeReply,
  attributeTemplateReply,
  recordBroadcastReply,
  recordTemplateReply,
  type BroadcastReply,
  type TemplateReply,
} from "@/lib/wa/broadcast-reply";
import { storeRemoteMedia, type MessageMedia } from "@/lib/media/store";
import { fmtPhone, normalizePhone } from "@/lib/format";
import type { Database } from "@/lib/database.types";
import type {
  BroadcastIntent,
  Enums,
  MessageReaction,
  TablesInsert,
} from "@/lib/types";

/** Sirve tanto el cliente con service role (webhooks) como el de la sesión (actions). */
type Admin = SupabaseClient<Database>;

/**
 * De dónde bajar el archivo que vino con el mensaje.
 *
 * Llega como un descriptor y no como el binario ya bajado porque el archivo se
 * guarda en una carpeta por conversación, y la conversación recién se resuelve
 * acá adentro. La URL de Meta vive cinco minutos: alcanza de sobra, pero por eso
 * la descarga pasa en el mismo request y no en un trabajo diferido.
 */
export type InboundMediaSource = {
  url: string;
  /** Meta exige el token para bajar; el worker de Baileys no. */
  token?: string | null;
  mime?: string | null;
  name?: string | null;
  extra?: Omit<MessageMedia, "path" | "mime" | "name" | "size">;
};

export type InboundMessage = {
  channelId: string;
  /**
   * Número del cliente, solo dígitos (E.164 sin +). Puede venir null cuando
   * WhatsApp entregó el mensaje por LID y todavía no compartió el número
   * (solo por Baileys): entonces tiene que venir `lid`.
   */
  from: string | null;
  /**
   * Linked ID de WhatsApp (dígitos), si el chat vino por LID. Es la identidad
   * con la que se sigue a la persona hasta que aparezca su teléfono: el hilo
   * nace con `wa_id = "lid:<lid>"` y se completa cuando llega el número.
   */
  lid?: string | null;
  /**
   * `out` = lo escribió el operador desde el celular físico de la sucursal.
   * Entra al hilo para que el CRM cuente la charla completa, pero no es una
   * consulta: no abre lead, no avisa a nadie, no dispara automáticos.
   */
  direction?: Enums<"message_direction">;
  text: string;
  kind: Enums<"message_kind">;
  waMessageId: string | null;
  pushName: string | null;
  /** ms epoch */
  timestamp: number;
  /** campaña/anuncio de origen, si el canal lo informa */
  campaign?: string | null;
  /** adjunto a bajar, si el mensaje trae uno y todavía no está en el bucket */
  media?: InboundMediaSource | null;
  /**
   * Adjunto que YA está en el bucket `attachments`: el worker de Baileys lo
   * descifra y lo sube él (con su service role) antes de avisar, así que acá
   * solo hay que guardar el descriptor. Si viene, `media` se ignora.
   */
  storedMedia?: MessageMedia | null;
  /** lo que no entra en columnas (ubicación, contactos, cita, reenviado…) */
  metadata?: Record<string, unknown>;
  /**
   * wamid del mensaje al que le está contestando. Es la prueba dura de que esta
   * respuesta viene de una difusión: lo escribe Meta, no el cliente.
   */
  contextMessageId?: string | null;
  /** payload del botón de plantilla que tocó, si tocó uno */
  buttonPayload?: string | null;
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

/**
 * A qué sucursal cae una consulta nueva: la primera regla que matchea, y si
 * ninguna matchea, la sucursal por defecto.
 *
 * Exportada porque Instagram usa EXACTAMENTE las mismas reglas (`lib/ig/inbound`).
 * Que un lead caiga en una sucursal distinta según por dónde entró sería un bug
 * imposible de explicarle a la agencia: las reglas son del negocio, no del canal.
 */
export async function routeToBranch(
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
 *
 * A quién: los admins, los vendedores de esa sucursal y el vendedor asignado
 * al lead (si lo hay). A un freelance que NO tiene el lead no se le avisa:
 * desde la 0030 no lo ve, así que el aviso sería un link a "no encontrado".
 *
 * `broadcast` es opcional y cambia el tono del aviso a propósito: alguien que
 * tocó "Quiero info" en una difusión NO es una consulta más, es un lead
 * calificado que levantó la mano y está esperando. Si el aviso no lo dice, se
 * pierde en la pila de los otros veinte.
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
    /**
     * A quién está asignado el lead, si a alguien. Desde la 0030 el freelance
     * ve SOLO sus leads: avisarle de uno que no es suyo sería mandarlo a un
     * link que le da "no encontrado". Se avisa al staff de la sucursal (que ve
     * el pool y reparte) y al asignado, que es el que lo va a atender.
     */
    assignedTo?: string | null;
    /**
     * La persona tocó un botón de algo que le mandamos. Puede ser una difusión
     * o una plantilla que el vendedor mandó a mano desde el chat: el aviso es el
     * mismo —levantó la mano— pero el texto tiene que decir la verdad, porque
     * "de una difusión" en una charla uno a uno confunde al operador.
     */
    respuesta?: {
      kind: "difusion" | "plantilla";
      name: string;
      intent: BroadcastIntent | null;
      buttonLabel: string | null;
    } | null;
  },
): Promise<void> {
  const membersQuery = supabase
    .from("members")
    .select("id, display_name, phone, role, branch_id")
    .eq("agency_id", input.agencyId)
    .eq("is_active", true);

  const { data: allMembers } = await membersQuery;
  const members = (allMembers ?? []).filter(
    (m) =>
      m.role === "admin" ||
      (m.role === "vendedor" && m.branch_id === input.branchId) ||
      (!!input.assignedTo && m.id === input.assignedTo),
  );
  if (members.length === 0) return;

  const link = input.leadId
    ? `/crm/${input.leadId}`
    : `/crm?vista=chats&c=${input.conversationId}`;

  const interesado = input.respuesta?.intent === "interesado";
  const boton = input.respuesta?.buttonLabel;
  const deDifusion = input.respuesta?.kind === "difusion";
  const titulo = interesado
    ? deDifusion
      ? "Lead calificado de una difusión"
      : "Contestó tu plantilla"
    : "Consulta nueva";
  const cuerpo = interesado
    ? `${input.contactName} tocó "${boton ?? "Me interesa"}" en ${input.respuesta?.name}. Está esperando que lo contactes.`
    : `${input.contactName}: ${snippet(input.text, 70)}`;

  await supabase.from("notifications").insert(
    members.map((m) => ({
      agency_id: input.agencyId,
      member_id: m.id,
      type: "lead_nuevo",
      title: titulo,
      body: cuerpo,
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
    interesado
      ? deDifusion
        ? `Lead calificado: respondió la difusión "${input.respuesta?.name}"`
        : `Contestó la plantilla "${input.respuesta?.name}"`
      : "Consulta nueva para atender",
    `${input.contactName}${input.contactPhone ? ` · ${fmtPhone(input.contactPhone)}` : ""}`,
    interesado && boton ? `Tocó "${boton}"` : `"${snippet(input.text, 140)}"`,
    base ? `${base}${link}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  await Promise.all(
    members
      .filter((m) => !!m.phone)
      .map((m) => sendBaileysText(branchChannel.id, m.phone!, body).catch(() => null)),
  );
}

/* ───────────────────────── reparto automático ───────────────────────── */

/**
 * Quién atiende un lead que cae en una sucursal SIN staff.
 *
 * Con el modelo de la 0030 un lead sin vendedor no lo ve ningún freelance, y
 * en una sucursal donde solo hay freelances eso significa que no lo ve nadie
 * hasta que un admin lo reparta a mano. La base elige al freelance activo de
 * la sucursal con menos leads abiertos; si la sucursal tiene admin o
 * vendedor devuelve null y el staff reparte como siempre.
 *
 * Exportada porque Instagram reparte con la misma regla (`lib/ig/inbound`):
 * es una decisión del negocio, no del canal. Nunca tira: si la RPC falla, el
 * lead queda sin asignar, que es lo que pasaba antes.
 */
export async function pickBranchOperator(
  supabase: Admin,
  agencyId: string,
  branchId: string | null,
): Promise<string | null> {
  if (!branchId) return null;
  const { data, error } = await supabase.rpc("pick_branch_operator", {
    p_agency: agencyId,
    p_branch: branchId,
  });
  if (error) {
    console.warn(`[wa] reparto automático sin respuesta: ${error.message}`);
    return null;
  }
  return data ?? null;
}

/**
 * Deja constancia de que el lead se repartió solo: el aviso al que lo recibe
 * y una línea en el historial que explica por qué apareció con vendedor sin
 * que nadie lo asignara. El texto es el mismo que escribe `reassignLeadCore`
 * cuando reparte sin actor (`autoAssignmentActivityText`): el historial no
 * tiene que contar el reparto de dos maneras según por qué puerta entró.
 */
export async function recordAutoAssignment(
  supabase: Admin,
  input: {
    agencyId: string;
    leadId: string;
    memberId: string;
    contactName: string;
  },
): Promise<void> {
  const { data: assignee } = await supabase
    .from("members")
    .select("display_name")
    .eq("id", input.memberId)
    .eq("agency_id", input.agencyId)
    .maybeSingle();
  await supabase.from("activities").insert({
    agency_id: input.agencyId,
    lead_id: input.leadId,
    type: "sistema",
    body: autoAssignmentActivityText(assignee?.display_name ?? "un vendedor de la sucursal"),
  });
  await notifyLeadAssigned(supabase, {
    agencyId: input.agencyId,
    memberId: input.memberId,
    leadId: input.leadId,
    contactName: input.contactName,
  });
}

/* ───────────────────────── identidad del contacto ───────────────────────── */

type ContactRow = { id: string; full_name: string; phone: string | null; wa_lid: string | null };
const CONTACT_COLS = "id, full_name, phone, wa_lid";

/**
 * ¿Este teléfono es de alguien del equipo?
 *
 * `members.phone` se carga a mano (con espacios, guiones, el 15…), así que se
 * compara normalizado a dígitos y también pasado por `normalizePhone`, que es
 * lo que la app usa para el resto de los teléfonos argentinos. El `from` del
 * worker ya viene E.164 sin '+'.
 */
async function isMemberPhone(supabase: Admin, agencyId: string, phone: string): Promise<boolean> {
  const { data } = await supabase
    .from("members")
    .select("phone")
    .eq("agency_id", agencyId)
    .eq("is_active", true)
    .not("phone", "is", null);
  return (data ?? []).some((m) => {
    const raw = m.phone ?? "";
    // "351 15 123 4567" (sin el 0 de área) no lo entiende normalizePhone, que
    // solo saca el 15 cuando hay un 0 adelante: se prueba también con el 0.
    const candidatos = new Set([raw.replace(/\D/g, ""), normalizePhone(raw), normalizePhone("0" + raw.trim())]);
    return candidatos.has(phone);
  });
}

/**
 * Completa en la ficha lo que WhatsApp acaba de contar de la persona: el
 * teléfono si no lo tenía, el LID si no lo tenía.
 *
 * Cada claim es atómico (`is null` en el propio UPDATE) por si dos mensajes
 * llegan juntos, y el del LID tolera el 23505 del índice único: si otra ficha
 * ya lo tiene, esa es la que lo reconoce y no vale pisarla desde acá. Nunca se
 * pisa un dato que ya estaba: un teléfono cargado a mano o un LID anterior
 * valen más que lo que dice un stanza.
 */
async function completeContactIdentity(
  supabase: Admin,
  contact: ContactRow,
  found: { phone: string | null; lid: string | null },
): Promise<void> {
  if (found.phone && !contact.phone) {
    await supabase
      .from("contacts")
      .update({ phone: found.phone })
      .eq("id", contact.id)
      .is("phone", null);
  }
  if (found.lid && !contact.wa_lid) {
    const { error } = await supabase
      .from("contacts")
      .update({ wa_lid: found.lid })
      .eq("id", contact.id)
      .is("wa_lid", null);
    if (error && error.code !== "23505") {
      console.warn(`[wa] LID sin guardar en la ficha ${contact.id}: ${error.message}`);
    }
  }
}

/* ───────────────────────── entrada de mensajes ───────────────────────── */

/**
 * @param creds Credenciales de la Cloud API de la agencia dueña del canal, ya
 *   resueltas por el webhook. Solo hacen falta para la respuesta automática del
 *   número madre; si vienen en null el mensaje entrante se procesa igual y la
 *   respuesta queda registrada como fallida con el motivo.
 */
export async function handleInboundMessage(
  msg: InboundMessage,
  creds: CloudCreds | null,
): Promise<InboundResult> {
  if (!hasAdminClient()) {
    return { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY para procesar mensajes." };
  }
  const supabase = createAdminClient();
  const phone = msg.from?.replace(/\D/g, "") || null;
  const lid = msg.lid?.replace(/\D/g, "") || null;
  if (!phone && !lid) return { ok: false, error: "Mensaje sin número de origen." };
  const direction: Enums<"message_direction"> = msg.direction ?? "in";
  /* El hilo de alguien que todavía no mostró el número se identifica por su
     LID, con prefijo para que nunca se confunda con un teléfono. */
  const lidWaId = lid ? `lid:${lid}` : null;

  const { data: channel } = await supabase
    .from("wa_channels")
    .select("id, agency_id, branch_id, kind, is_mother, auto_reply_enabled, auto_reply_text")
    .eq("id", msg.channelId)
    .maybeSingle();
  if (!channel) return { ok: false, error: "Canal desconocido." };

  const agencyId = channel.agency_id;

  /* 1. ¿este WhatsApp viene del chat de Instagram?
     El link wa.me que se le mandó por DM trae una referencia en el texto
     prellenado. Si está, esta persona ya existe en el CRM: es la MISMA que venía
     hablando por Instagram, y sin esto quedaría como un contacto nuevo con un
     lead nuevo. Ver lib/ig/bridge.ts.
     Solo para lo que escribe el CLIENTE y con teléfono a la vista: el puente
     pega un teléfono a una ficha, y sin teléfono no hay nada que pegar. */
  const bridgeCode = direction === "in" && phone ? findBridgeCode(msg.text) : null;
  const bridged = bridgeCode ? await redeemBridgeLink(supabase, agencyId, bridgeCode, null) : null;

  /* 2. contacto: por teléfono si lo hay, por LID si no (o además) */
  let contactId: string;
  let contactName: string;

  /* Por teléfono. Con dos fichas del mismo número (pasa: una carga a mano y un
     puente, dos vendedores) gana la MÁS ANTIGUA —la misma regla que la RPC
     `find_contact_by_phone`—. Antes era `.maybeSingle()`, que con dos filas
     devuelve error + null, y cada entrante de esa persona creaba otra ficha. */
  let phoneContact: ContactRow | null = null;
  if (phone) {
    const { data } = await supabase
      .from("contacts")
      .select(CONTACT_COLS)
      .eq("agency_id", agencyId)
      .eq("phone", phone)
      .order("created_at", { ascending: true })
      .limit(1);
    phoneContact = data?.[0] ?? null;
  }

  /* Por LID: `contacts.wa_lid` (migración 0032). El LID es el mismo en todos
     nuestros números, así que reconoce a la persona aunque escriba a otra
     sucursal y aunque WhatsApp no comparta el teléfono; es único por agencia.
     Los hilos abiertos antes de la columna guardan el LID solo en
     `conversations.wa_id`: se mira ahí como último recurso y la ficha se
     completa más abajo para que la próxima vez entre por la columna. */
  let lidContact: ContactRow | null = null;
  if (lid) {
    const { data: byLid } = await supabase
      .from("contacts")
      .select(CONTACT_COLS)
      .eq("agency_id", agencyId)
      .eq("wa_lid", lid)
      .maybeSingle();
    lidContact = byLid ?? null;
    if (!lidContact && lidWaId) {
      const { data: lidConv } = await supabase
        .from("conversations")
        .select(`contact:contacts(${CONTACT_COLS})`)
        .eq("agency_id", agencyId)
        .eq("wa_id", lidWaId)
        .limit(1)
        .maybeSingle();
      lidContact = lidConv?.contact ?? null;
    }
  }

  /* Un mensaje `out` a alguien que NO tenemos es, casi siempre, el eco del
     aviso a los operadores: `alertBranchOperators` les escribe al celular desde
     el número de la sucursal sin guardar fila, y el worker emite todo lo fromMe.
     Sin este corte el eco abría una ficha con el teléfono del operador y un hilo
     con él como "cliente". No se escribe nada: no es una charla con nadie. */
  if (direction === "out" && phone && !phoneContact && !lidContact) {
    if (await isMemberPhone(supabase, agencyId, phone)) return { ok: true };
  }

  let bridgedContact: ContactRow | null = null;
  if (bridged) {
    const { data } = await supabase
      .from("contacts")
      .select(CONTACT_COLS)
      .eq("id", bridged.contactId)
      .eq("agency_id", agencyId)
      .maybeSingle();
    bridgedContact = data;
  }

  /* La referencia manda… salvo que el teléfono (o el LID) del que llega el
     WhatsApp YA identifique a otra persona del CRM. Eso pasa cuando alguien
     reenvía el mensaje prellenado: el texto con la referencia adentro se puede
     compartir, y sin este freno el WhatsApp de Bruno terminaría pegado al
     contacto, al lead y al historial de Ana. Entre un dato que la agencia ya
     tiene y una referencia que vino en un texto reenviable, gana el dato.
     El código se libera para que la persona que sí lo recibió pueda usarlo. */
  const bridgeAplica =
    !!bridgedContact &&
    (!phoneContact || phoneContact.id === bridgedContact.id) &&
    (!lidContact || lidContact.id === bridgedContact.id);
  if (bridgeCode && bridged && !bridgeAplica) {
    await releaseBridgeLink(supabase, bridgeCode);
  }

  if (bridgedContact && bridgeAplica) {
    contactId = bridgedContact.id;
    contactName = bridgedContact.full_name;
    // El teléfono (y el LID, si vino) se le pegan a la ficha de Instagram, que
    // hasta ahora no tenía ninguno.
    await completeContactIdentity(supabase, bridgedContact, { phone, lid });
  } else if (lidContact) {
    /* El LID manda: es la identidad con la que esta persona ya tiene hilo (y
       leads) en nuestros números, y seguir por otra ficha partiría la charla. */
    contactId = lidContact.id;
    contactName = lidContact.full_name;
    const duplicado = !!phone && !!phoneContact && phoneContact.id !== lidContact.id;
    if (duplicado) {
      /* El número que acaba de aparecer ya identifica a OTRA ficha. Fusionar
         contactos (con sus leads y sus hilos) no es algo que se decida desde
         un webhook, y copiarle el teléfono a esta dejaría dos fichas con el
         mismo número. Se deja constancia y se sigue con la ficha del LID, que
         es la que tiene la charla. Deuda: una pantalla para fusionar duplicados. */
      console.warn(
        `[wa] el LID ${lid} apareció con el teléfono ${phone}, que ya es de otra ficha (${phoneContact!.id}); se sigue con la del LID (${lidContact.id}) sin fusionar.`,
      );
    }
    /* Apareció el número de alguien que hasta ahora era solo un LID: se
       completa la ficha (el envío prefiere `contacts.phone`) y el LID queda
       guardado para reconocerla desde cualquier número. Los hilos NO se
       renombran: `wa_id = "lid:…"` sigue siendo verdad y es lo que permite
       encontrarlos. */
    await completeContactIdentity(supabase, lidContact, { phone: duplicado ? null : phone, lid });
  } else if (phoneContact) {
    contactId = phoneContact.id;
    contactName = phoneContact.full_name;
    // Llegó con LID y la ficha no lo tenía: se guarda para reconocerla aunque
    // la próxima vez WhatsApp no comparta el número.
    await completeContactIdentity(supabase, phoneContact, { phone: null, lid });
  } else {
    /* El nombre: lo que WhatsApp dice de la persona, o el teléfono, o el final
       del LID. Nunca vacío. Para un mensaje que escribió el operador desde el
       celular el pushName no es del cliente, así que no se usa. */
    const pushName = direction === "in" ? msg.pushName?.trim() : "";
    contactName =
      pushName || (phone ? fmtPhone(phone) : `WhatsApp ${(lid ?? "").slice(-4)}`);
    const { data: created, error } = await supabase
      .from("contacts")
      .insert({
        agency_id: agencyId,
        full_name: contactName,
        phone,
        wa_lid: lid,
        source: "whatsapp",
      })
      .select("id")
      .single();
    if (created) {
      contactId = created.id;
    } else if (error?.code === "23505" && lid) {
      /* Carrera: dos mensajes del mismo LID nuevo llegaron juntos y el índice
         único dejó pasar uno solo. Se sigue con el que ganó. */
      const { data: winner } = await supabase
        .from("contacts")
        .select(CONTACT_COLS)
        .eq("agency_id", agencyId)
        .eq("wa_lid", lid)
        .maybeSingle();
      if (!winner) return { ok: false, error: "No se pudo crear el contacto." };
      contactId = winner.id;
      contactName = winner.full_name;
    } else {
      return { ok: false, error: "No se pudo crear el contacto." };
    }
  }

  /* 3. conversación del canal por el que entró */
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
        // teléfono si lo hay; si no, el LID con prefijo hasta que aparezca
        wa_id: phone ?? lidWaId,
      })
      .select("id")
      .single();
    if (error || !created) return { ok: false, error: "No se pudo abrir la conversación." };
    conversationId = created.id;
    isNewConversation = true;
  }

  /* El puente queda cerrado: la referencia sabe en qué hilo terminó, y el
     vendedor ve de dónde salió esta charla sin tener que deducirlo. La nota va
     ANTES del mensaje del cliente para que el preview de la bandeja siga siendo
     lo que escribió el cliente y no una nota nuestra. */
  if (bridgeCode && bridged && bridgeAplica) {
    await attachBridgeConversation(supabase, bridgeCode, conversationId);
    await supabase.from("messages").insert({
      agency_id: agencyId,
      conversation_id: conversationId,
      direction: "out",
      kind: "nota_interna",
      body: "Este chat viene del Instagram de la agencia. Es la misma persona.",
      is_automated: true,
      status: "enviado",
      metadata: { from_instagram: true },
    });
    await supabase.from("activities").insert({
      agency_id: agencyId,
      contact_id: contactId,
      lead_id: bridged.leadId,
      type: "whatsapp",
      body: "Pasó de Instagram a WhatsApp",
    });
  }

  /* 4. mensaje (idempotente por wa_message_id: los webhooks reintentan) */
  if (msg.waMessageId) {
    const { data: dupe } = await supabase
      .from("messages")
      .select("id")
      .eq("wa_message_id", msg.waMessageId)
      .maybeSingle();
    if (dupe) return { ok: true };
  }

  /* El archivo se baja ACÁ y no en el webhook porque recién ahora sabemos en qué
     conversación va. Si falla, el mensaje entra igual: perder el adjunto es malo,
     perder también la consulta del cliente sería peor.
     Si el worker ya lo dejó en el bucket (`storedMedia`), va tal cual. */
  let media: MessageMedia | null = msg.storedMedia ?? null;
  if (!media && msg.media) {
    const stored = await storeRemoteMedia({
      agencyId,
      conversationId,
      url: msg.media.url,
      token: msg.media.token,
      mime: msg.media.mime,
      name: msg.media.name,
      extra: msg.media.extra,
    });
    if (stored.ok) media = stored.media;
    else console.warn(`[wa] adjunto sin guardar: ${stored.error}`);
  }

  const { error: messageError } = await supabase.from("messages").insert({
    agency_id: agencyId,
    conversation_id: conversationId,
    direction,
    kind: msg.kind,
    body: msg.text || null,
    media: media as never,
    wa_message_id: msg.waMessageId,
    /* Lo que escribió el operador desde el celular ya salió: entra como
       enviado y los recibos del worker lo llevan a entregado/leído. Sin
       `sent_by` (nadie de la app lo mandó) y sin `is_automated`. */
    status: direction === "out" ? "enviado" : "entregado",
    created_at: new Date(msg.timestamp || Date.now()).toISOString(),
    metadata: (msg.metadata ?? {}) as TablesInsert<"messages">["metadata"],
  });
  /* 23505 = la fila apareció entre el chequeo de arriba y este insert: es el
     eco de un envío nuestro y la action ganó la carrera. Ya está guardado con
     autor y todo; un 500 acá haría que el worker dé la app por caída. */
  if (messageError?.code === "23505" && msg.waMessageId) return { ok: true };
  if (messageError) return { ok: false, error: "No se pudo guardar el mensaje." };

  /* Un mensaje del operador es la agencia hablando: no es una consulta, no
     abre lead, no contesta solo y no avisa a nadie. Solo tenía que quedar en el
     hilo (el trigger de la base ya actualizó last_message_at y el preview). */
  if (direction === "out") return { ok: true };

  /* 5. ¿esto contesta a una difusión?
     Se resuelve ANTES del lead porque cambia qué hacer con él: una baja no abre
     una oportunidad nueva, y un "quiero info" nace calificado y con la campaña
     puesta. La atribución es toda de lectura, así que puede pasar antes sin
     comprometerse a nada. Si falla, el mensaje entra igual: perder la atribución
     es un número peor en un tablero, perder la consulta sería perder al cliente. */
  let difusion: BroadcastReply | null = null;
  /* ¿Y si contesta a una plantilla que un vendedor mandó desde el chat? Se
     pregunta PRIMERO porque su respuesta cambia la de la difusión: cuando la
     persona está contestando una plantilla puntual, atribuirla además a la
     última difusión que recibió en 72 hs es directamente falso. */
  let plantilla: TemplateReply | null = null;
  try {
    plantilla = await attributeTemplateReply(supabase, {
      agencyId,
      contextMessageId: msg.contextMessageId ?? null,
      buttonPayload: msg.buttonPayload ?? null,
      text: msg.text,
    });
  } catch (e) {
    console.warn(`[wa] respuesta sin atribuir a su plantilla: ${String(e)}`);
  }
  try {
    difusion = await attributeReply(supabase, {
      agencyId,
      contactId,
      contextMessageId: msg.contextMessageId ?? null,
      buttonPayload: msg.buttonPayload ?? null,
      text: msg.text,
      allowWindowFallback: !plantilla,
    });
  } catch (e) {
    console.warn(`[wa] respuesta sin atribuir a su difusión: ${String(e)}`);
  }
  /* La baja vale igual la haya pedido por una difusión o tocando el botón de una
     plantilla del chat: en los dos casos la persona dijo que no la molesten. */
  const esBaja = difusion?.intent === "baja" || plantilla?.intent === "baja";

  /* 6. lead: si no hay uno abierto, esta consulta lo crea */
  const { data: openLead } = await supabase
    .from("leads")
    .select("id, branch_id, assigned_to")
    .eq("agency_id", agencyId)
    .eq("contact_id", contactId)
    .in("stage", ACTIVE_STAGES)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let leadId = openLead?.id ?? null;
  let branchId = openLead?.branch_id ?? channel.branch_id ?? null;
  let assignedTo = openLead?.assigned_to ?? null;
  let leadIsNew = false;

  /* Una baja NO abre un lead. Alguien que acaba de pedir que no lo molesten más
     no es una oportunidad de venta: sería regalarle trabajo al vendedor y una
     tarjeta en el tablero que solo se puede perder. */
  if (!openLead && !esBaja) {
    if (!branchId) {
      branchId = await routeToBranch(supabase, agencyId, msg.text, msg.campaign ?? null);
    }
    /* Sucursal sin staff → el lead nace con vendedor (el freelance con menos
       leads abiertos) en el MISMO insert: la conversación hereda al dueño por
       trigger y el freelance lo ve desde el primer momento. Con staff la RPC
       devuelve null y el pool se reparte a mano, como siempre. */
    const operator = await pickBranchOperator(supabase, agencyId, branchId);
    const { data: createdLead } = await supabase
      .from("leads")
      .insert({
        agency_id: agencyId,
        contact_id: contactId,
        branch_id: branchId,
        stage: "nuevo",
        origin_channel: "whatsapp",
        // De dónde salió esta oportunidad: la difusión gana sobre el anuncio
        // porque es la que efectivamente lo hizo escribir hoy.
        origin_campaign: difusion?.broadcastName ?? msg.campaign ?? null,
        initial_message: msg.text || null,
        position: Date.now(),
        assigned_to: operator,
      })
      .select("id")
      .single();
    leadId = createdLead?.id ?? null;
    leadIsNew = true;
    if (createdLead && operator) {
      assignedTo = operator;
      await recordAutoAssignment(supabase, {
        agencyId,
        leadId: createdLead.id,
        memberId: operator,
        contactName,
      });
    }
  }

  // la conversación del madre también queda etiquetada con la sucursal derivada
  if (branchId && !existingConv?.branch_id) {
    await supabase.from("conversations").update({ branch_id: branchId }).eq("id", conversationId);
  }

  /* 7. la difusión se cierra: el destinatario queda respondido con su intención,
     enganchado al lead, y la baja se aplica. Va acá y no antes porque recién
     ahora existe el lead que hay que pegarle. */
  if (plantilla) {
    try {
      await recordTemplateReply(supabase, {
        reply: plantilla,
        agencyId,
        contactId,
        conversationId,
        leadId,
      });
    } catch (e) {
      console.warn(`[wa] respuesta de plantilla sin registrar: ${String(e)}`);
    }
  }

  if (difusion) {
    try {
      await recordBroadcastReply(supabase, {
        reply: difusion,
        contactId,
        conversationId,
        leadId,
        text: msg.text,
      });
    } catch (e) {
      console.warn(`[wa] respuesta de difusión sin registrar: ${String(e)}`);
    }
  }

  /* 8. respuesta automática del número madre.
     A quien pidió la baja no se le contesta "en seguida te contactamos": es
     justo lo contrario de lo que pidió, y es la clase de mensaje que termina en
     un reporte de spam. */
  if (
    phone &&
    channel.is_mother &&
    channel.auto_reply_enabled &&
    channel.auto_reply_text &&
    !esBaja &&
    (isNewConversation || leadIsNew)
  ) {
    const text = channel.auto_reply_text;
    // Sin credenciales no hay respuesta automática, pero el mensaje del cliente
    // ya quedó guardado y el resto del lote tiene que seguir: se registra el
    // intento como fallido con el motivo, nunca se tira una excepción (una acá
    // aborta el barrido del webhook y se pierden los mensajes que vienen atrás).
    const result: CloudResult = creds
      ? await sendCloudText(creds, phone, text)
      : cloudFailure("La agencia todavía no conectó su cuenta de Meta.");

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

  /* 9. alerta a los operadores de la sucursal.
     Un interesado de una difusión avisa aunque el lead ya existiera: acaba de
     levantar la mano y ese es el momento de llamarlo. Una baja no avisa nunca —
     no hay nada que atender y el operador solo vería ruido. */
  if (
    !esBaja &&
    (leadIsNew || difusion?.intent === "interesado" || plantilla?.intent === "interesado")
  ) {
    await alertBranchOperators(supabase, {
      agencyId,
      branchId,
      contactName,
      contactPhone: phone,
      text: msg.text,
      conversationId,
      leadId,
      assignedTo,
      /* La difusión gana si las dos aplican: es la que tiene tablero atrás y la
         que alguien está midiendo. */
      respuesta: difusion
        ? {
            kind: "difusion",
            name: difusion.broadcastName,
            intent: difusion.intent,
            buttonLabel: difusion.buttonLabel,
          }
        : plantilla
          ? {
              kind: "plantilla",
              name: plantilla.templateName,
              intent: plantilla.intent,
              buttonLabel: plantilla.buttonLabel,
            }
          : null,
    });
  }

  return { ok: true };
}

/* ───────────────────────── reacciones ───────────────────────── */

/**
 * Pega (o saca) una reacción sobre el mensaje al que apunta.
 *
 * Las reacciones NO son mensajes: si se guardaran como uno, el hilo se llenaría
 * de burbujas con un pulgar y el preview de la bandeja diría "👍" en vez de lo
 * último que dijo el cliente. Van adentro del mensaje reaccionado, como en
 * WhatsApp.
 *
 * `emoji` en null significa que la sacaron. Meta no manda ningún flag de borrado:
 * manda el MISMO evento sin el campo `emoji`, así que la ausencia ES la señal
 * (ojo, no un string vacío).
 *
 * Hay a lo sumo una reacción por lado en un chat de a dos, así que la dirección
 * alcanza como identidad y no hace falta saber quién reaccionó.
 */
export async function applyReaction(
  supabase: Admin,
  agencyId: string,
  input: {
    /** wa_message_id del mensaje reaccionado */
    messageId: string;
    emoji: string | null;
    direction: Enums<"message_direction">;
  },
): Promise<void> {
  const { data: target } = await supabase
    .from("messages")
    .select("id, reactions")
    .eq("wa_message_id", input.messageId)
    // Con service role no hay RLS que ponga el límite: el agency_id lo pone acá.
    .eq("agency_id", agencyId)
    .maybeSingle();

  // Reaccionar a un mensaje que no tenemos (anterior a la conexión, o de un lote
  // que se perdió) no es un error: no hay nada que actualizar y listo.
  if (!target) return;

  const previas = Array.isArray(target.reactions)
    ? (target.reactions as unknown as MessageReaction[])
    : [];
  const otras = previas.filter((r) => r.direction !== input.direction);
  const proximas = input.emoji
    ? [...otras, { emoji: input.emoji, direction: input.direction, at: new Date().toISOString() }]
    : otras;

  await supabase
    .from("messages")
    .update({ reactions: proximas as never })
    .eq("id", target.id);
}
