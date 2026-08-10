/**
 * Atribución de las respuestas a una difusión.
 *
 * Es la pieza que convierte un envío masivo en algo medible: sin esto, el que
 * toca "Quiero info" entra al CRM como una consulta más y la difusión se mide
 * en "mensajes enviados", que no es lo que le importa a nadie.
 *
 * ─────────────────────────────────────────────
 * CÓMO SE SABE QUE UNA RESPUESTA VIENE DE UNA DIFUSIÓN
 *
 * Tres caminos, en este orden, del más duro al más blando:
 *
 *   1. `context.id`. Cuando alguien toca un botón de plantilla, Meta manda el
 *      wamid del mensaje al que le contestó — que es exactamente el que
 *      guardamos en `broadcast_recipients.wa_message_id`. Es prueba dura: no la
 *      escribe el cliente, la escribe Meta.
 *   2. El `payload` del botón, con nuestro formato `vjos:<recipientId>:<index>`.
 *      Sirve de red cuando el context no viene, y de paso es lo que dice QUÉ
 *      botón se tocó.
 *   3. La última difusión que recibió esa persona hace ≤ 72 hs. Es para el que
 *      contesta escribiendo en vez de tocar ("hola, me interesa lo de Brasil"),
 *      que es la mitad de la gente.
 *
 * Si ninguno matchea no pasa nada: el mensaje entra como cualquier otro. Perder
 * una atribución es un número peor en un tablero; frenar el mensaje sería perder
 * un cliente.
 *
 * ─────────────────────────────────────────────
 * EL BOTÓN LO CUENTA LA FOTO, NO LA PLANTILLA
 *
 * El índice sale del payload, pero el texto y la intención salen de
 * `broadcasts.buttons_snapshot`, nunca de `wa_templates.buttons`: la plantilla
 * se edita, se pausa o Meta la baja, y una respuesta de marzo tiene que seguir
 * diciendo qué botón vio esa persona ese día.
 *
 * SOLO SERVIDOR y con service role: lo llama el webhook, que no tiene sesión.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { BroadcastIntent, TemplateButton } from "@/lib/types";

type Admin = SupabaseClient<Database>;

/** Cuánto tiempo después de una difusión un mensaje suelto todavía se le atribuye. */
const VENTANA_HORAS = 72;

/**
 * El payload que viaja en cada botón de respuesta rápida.
 *
 * Lleva el destinatario y no la difusión porque el destinatario ya dice las dos
 * cosas, y encima identifica a la persona: dos difusiones distintas al mismo
 * contacto nunca se confunden. El prefijo `vjos:` es para distinguirlo de
 * cualquier payload que la agencia haya cargado a mano en el panel de Meta.
 */
const PAYLOAD_RE = /^vjos:([0-9a-f-]{36}):(\d{1,2})$/i;

export function broadcastButtonPayload(recipientId: string, index: number): string {
  return `vjos:${recipientId}:${index}`;
}

function parsePayload(payload: string | null): { recipientId: string; index: number } | null {
  if (!payload) return null;
  const match = PAYLOAD_RE.exec(payload.trim());
  if (!match) return null;
  return { recipientId: match[1].toLowerCase(), index: Number(match[2]) };
}

export type BroadcastReply = {
  recipientId: string;
  broadcastId: string;
  /**
   * Cómo se llama la difusión. Va a `leads.origin_campaign` cuando la respuesta
   * abre un lead nuevo: es lo que después contesta "¿de dónde salió esta venta?".
   */
  broadcastName: string;
  intent: BroadcastIntent | null;
  buttonLabel: string | null;
};

/** La fila del destinatario con la foto de su difusión, que es lo único que hace falta. */
type RecipientRow = {
  id: string;
  broadcast_id: string;
  contact_id: string;
  broadcast: { name: string; buttons_snapshot: unknown } | null;
};

const RECIPIENT_SELECT =
  "id, broadcast_id, contact_id, broadcast:broadcasts(name, buttons_snapshot)";

/**
 * ¿Esta respuesta entrante viene de una difusión?
 *
 * Devuelve null cuando no se puede probar. Nunca escribe nada: se la llama antes
 * de decidir qué hacer con el lead, y para eso tiene que ser una consulta pura.
 */
export async function attributeReply(
  supabase: Admin,
  input: {
    agencyId: string;
    contactId: string;
    contextMessageId: string | null;
    buttonPayload: string | null;
    text: string;
  },
): Promise<BroadcastReply | null> {
  const parsed = parsePayload(input.buttonPayload);

  /* El agency_id va en las tres consultas: con service role no hay RLS que
     ponga el límite, y un wamid o un payload de otra agencia no puede engancharse
     al contacto de esta. */
  const destinatarios = () =>
    supabase.from("broadcast_recipients").select(RECIPIENT_SELECT).eq("agency_id", input.agencyId);

  let row: RecipientRow | null = null;

  // 1. la prueba dura
  if (input.contextMessageId) {
    const { data } = await destinatarios()
      .eq("wa_message_id", input.contextMessageId)
      .maybeSingle();
    row = data;
  }

  // 2. el payload del botón
  if (!row && parsed) {
    const { data } = await destinatarios().eq("id", parsed.recipientId).maybeSingle();
    row = data;
  }

  // 3. el que contestó escribiendo, dentro de la ventana
  if (!row) {
    const limite = new Date(Date.now() - VENTANA_HORAS * 3_600_000).toISOString();
    const { data } = await destinatarios()
      .eq("contact_id", input.contactId)
      .gte("sent_at", limite)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    row = data;
  }

  if (!row) return null;

  /* El payload lo puede escribir cualquiera (viaja en un mensaje entrante), así
     que la fila que salió de ahí tiene que ser de ESTA persona. Sin este freno,
     un payload copiado pegaría la respuesta de Bruno a la difusión de Ana. */
  if (row.contact_id !== input.contactId) return null;

  const buttons = Array.isArray(row.broadcast?.buttons_snapshot)
    ? (row.broadcast.buttons_snapshot as TemplateButton[])
    : [];
  const button = parsed ? (buttons[parsed.index] ?? null) : null;

  return {
    recipientId: row.id,
    broadcastId: row.broadcast_id,
    broadcastName: row.broadcast?.name ?? "Difusión",
    /* Sin botón (o con uno sin intención declarada, como los de link) la única
       señal es lo que escribió: y de todo lo que puede escribir, lo único que
       hace falta detectar solo es la baja. */
    intent: button?.intent ?? (looksLikeOptOut(input.text) ? "baja" : null),
    buttonLabel: button?.text ?? null,
  };
}

/**
 * Cierra el círculo: deja al destinatario como respondido con su intención,
 * engancha el lead que generó y aplica la baja si eso fue lo que pidió.
 *
 * Idempotente en lo que importa: si la persona toca el botón y además escribe,
 * la segunda pasada no pisa la hora de la respuesta, ni el botón, ni el primer
 * texto, ni repite la nota en el hilo.
 */
export async function recordBroadcastReply(
  supabase: Admin,
  input: {
    reply: BroadcastReply;
    contactId: string;
    conversationId: string;
    leadId: string | null;
    text: string;
  },
): Promise<void> {
  const { data: row, error: readError } = await supabase
    .from("broadcast_recipients")
    .select("id, agency_id, replied_at, intent, button_label, reply_text, lead_id")
    .eq("id", input.reply.recipientId)
    .maybeSingle();
  if (readError || !row) return;

  const ahora = new Date().toISOString();
  const primeraVez = !row.replied_at;
  const texto = input.text.trim();

  const { error: updateError } = await supabase
    .from("broadcast_recipients")
    .update({
      status: "respondido",
      replied_at: row.replied_at ?? ahora,
      // Lo que ya se sabía no se borra con un mensaje posterior sin botón.
      intent: input.reply.intent ?? row.intent,
      button_label: input.reply.buttonLabel ?? row.button_label,
      reply_text: row.reply_text ?? (texto || null),
      lead_id: input.leadId ?? row.lead_id,
      conversation_id: input.conversationId,
    })
    .eq("id", row.id);
  if (updateError) {
    console.warn(`[wa] respuesta de difusión sin registrar: ${updateError.message}`);
  }

  if (!primeraVez) return;

  if (input.reply.intent === "baja") {
    await applyOptOut(supabase, {
      agencyId: row.agency_id,
      contactId: input.contactId,
      conversationId: input.conversationId,
      broadcastName: input.reply.broadcastName,
    });
  }

  /* El historial del contacto tiene que decir de dónde salió esta charla: el
     vendedor abre la ficha seis meses después y ve "respondió la difusión de
     Brasil", no un mensaje suelto sin contexto. */
  const detalle = input.reply.buttonLabel ? `: ${input.reply.buttonLabel}` : "";
  await supabase.from("activities").insert({
    agency_id: row.agency_id,
    contact_id: input.contactId,
    lead_id: input.leadId,
    type: "whatsapp",
    body: `Respondió la difusión "${input.reply.broadcastName}"${detalle}`,
  });
}

/**
 * La baja, que es lo más importante que puede pasar en una difusión.
 *
 * Se marca en el contacto (la audiencia ya lo excluye para siempre) y se deja
 * dicho en el hilo. La nota no es decorativa: sin ella, el vendedor ve un chat
 * normal y no entiende por qué a esta persona no le llega nada. Y se aclara que
 * la baja es de las DIFUSIONES: la conversación uno a uno sigue abierta.
 */
async function applyOptOut(
  supabase: Admin,
  input: { agencyId: string; contactId: string; conversationId: string; broadcastName: string },
): Promise<void> {
  const { error } = await supabase
    .from("contacts")
    .update({
      wa_opt_out_at: new Date().toISOString(),
      wa_opt_out_reason: `Pidió la baja en la difusión "${input.broadcastName}"`,
    })
    .eq("id", input.contactId)
    .eq("agency_id", input.agencyId)
    // Si ya estaba dado de baja, la fecha original es la que vale.
    .is("wa_opt_out_at", null);
  if (error) {
    console.warn(`[wa] baja de difusiones sin aplicar: ${error.message}`);
    return;
  }

  await supabase.from("messages").insert({
    agency_id: input.agencyId,
    conversation_id: input.conversationId,
    direction: "out",
    kind: "nota_interna",
    body: "Pidió no recibir más difusiones. No le van a llegar envíos masivos; podés seguir escribiéndole por acá.",
    is_automated: true,
    status: "enviado",
    metadata: { opt_out: true },
  });
}

/* ───────────────────────── la baja escrita a mano ───────────────────────── */

/** Mensajes que son una baja y nada más. */
const BAJA_EXACTA = new Set([
  "baja",
  "stop",
  "unsubscribe",
  "eliminame",
  "borrame",
  "sacame",
  "dar de baja",
  "darme de baja",
  "no me interesa",
  "no molesten",
  "no molestar",
]);

/** Frases que, en un mensaje corto, son una baja. */
const BAJA_FRASES = [
  "dar de baja",
  "darme de baja",
  "no me interesa",
  "no molesten",
  "no molestar",
  "no me manden",
  "no me mandes mas",
  "no me escriban",
  "no quiero recibir",
  "sacame de la lista",
  "borrame de la lista",
  "dejen de escribirme",
];

/** Sin acentos, sin puntuación y en minúscula: la gente escribe como puede. */
function normalizar(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ¿Está pidiendo la baja?
 *
 * Deliberadamente corta de manga: dar de baja a alguien que quería comprar es
 * mucho peor que mandarle una difusión de más. Por eso una frase de baja solo
 * cuenta si el mensaje es corto y no está preguntando nada — "no me interesa
 * Brasil, ¿tenés algo del Caribe?" es una consulta caliente, no una baja.
 */
export function looksLikeOptOut(text: string): boolean {
  const limpio = normalizar(text);
  if (!limpio) return false;
  if (BAJA_EXACTA.has(limpio)) return true;
  if (limpio.length > 60) return false;
  if (text.includes("?") || text.includes("¿")) return false;
  return BAJA_FRASES.some((frase) => limpio.includes(frase));
}
