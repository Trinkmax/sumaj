/**
 * Atribución de las respuestas a algo que mandamos nosotros: una difusión o una
 * plantilla que un vendedor mandó a mano desde el chat.
 *
 * Es la pieza que convierte un envío masivo en algo medible: sin esto, el que
 * toca "Quiero info" entra al CRM como una consulta más y la difusión se mide
 * en "mensajes enviados", que no es lo que le importa a nadie.
 *
 * Los dos casos comparten archivo porque comparten el problema —qué botón tocó
 * la persona y qué significa— y porque separarlos haría que el de la plantilla
 * del chat le robe la atribución al de la difusión sin que nadie lo note. El
 * bloque de la plantilla del chat está más abajo, con su porqué.
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
    /**
     * Permitir el camino 3 (la ventana de 72 hs). Se apaga cuando YA sabemos a
     * qué contestó la persona —una plantilla mandada a mano desde el chat—,
     * porque ahí el camino blando es directamente falso: le pegaría la respuesta
     * a una difusión que esa persona recibió otro día. Default true: el que
     * contesta escribiendo sigue entrando al embudo como siempre.
     */
    allowWindowFallback?: boolean;
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

  /* 3. el que contestó escribiendo, dentro de la ventana.
     A propósito NO se filtra por canal: el cliente contesta la difusión por
     donde se le canta, y muchas veces sigue la charla con el vendedor por el
     número de la sucursal. Filtrar acá dejaría esas respuestas —las que más
     valen— fuera del embudo. Lo que sí se cuidó es la BAJA escrita a mano
     (`looksLikeOptOut`, abajo): es lo único de este camino que toma una
     decisión irreversible, y por eso es deliberadamente difícil de disparar. */
  if (!row && input.allowWindowFallback !== false) {
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

/* ═══════════════════════════════════════════════════════════
   LA PLANTILLA MANDADA A MANO DESDE EL CHAT

   No es una difusión, pero llega igual: el vendedor reabre una conversación
   cerrada con una plantilla aprobada y el cliente toca uno de sus botones.

   Por qué necesita su propio camino: desde el chat NO se manda el componente de
   botones con `vjos:<recipientId>:<index>` —ese payload identifica un
   destinatario de difusión, que acá no existe— así que Meta devuelve el TEXTO
   del botón como payload. Sin esto pasaban dos cosas, las dos malas:

     · Se perdía el `intent` declarado del botón. Un "No me interesa" tocado
       sobre una plantilla del chat no daba de baja a nadie: caía en
       `looksLikeOptOut`, que es deliberadamente corto de manga.
     · La respuesta se le atribuía a la ÚLTIMA difusión que esa persona hubiera
       recibido en 72 hs (camino 3 de `attributeReply`), ensuciando el embudo de
       una campaña con una charla que no tenía nada que ver.

   Acá el botón se resuelve por TEXTO contra `wa_templates.buttons`, que es lo
   único que devuelve Meta. A diferencia de la difusión —donde manda la foto
   congelada— acá la plantilla viva es la fuente correcta: es la misma que se
   mandó hace un rato, no una de hace seis meses.
   ═══════════════════════════════════════════════════════════ */

export type TemplateReply = {
  /** Nombre humano de la plantilla, para el historial del contacto. */
  templateName: string;
  intent: BroadcastIntent | null;
  buttonLabel: string | null;
};

/** Mismo criterio que `normalizar`, para que "¡Sí, contame!" matchee "Si contame". */
function mismoTexto(a: string, b: string): boolean {
  return normalizar(a) === normalizar(b);
}

/**
 * ¿Esta respuesta contesta a una plantilla que un vendedor mandó desde el chat?
 *
 * Solo de lectura y solo con la prueba dura: sin `context.id` devuelve null. No
 * hay camino blando a propósito — adivinar acá es exactamente el problema que
 * esta función viene a arreglar.
 */
export async function attributeTemplateReply(
  supabase: Admin,
  input: {
    agencyId: string;
    contextMessageId: string | null;
    /** El payload del botón, que sin componente de botones ES su texto. */
    buttonPayload: string | null;
    text: string;
  },
): Promise<TemplateReply | null> {
  if (!input.contextMessageId) return null;

  const { data: original } = await supabase
    .from("messages")
    .select("kind, direction, metadata")
    .eq("agency_id", input.agencyId)
    .eq("wa_message_id", input.contextMessageId)
    .maybeSingle();
  if (!original || original.direction !== "out" || original.kind !== "plantilla") return null;

  const meta = (original.metadata ?? null) as {
    template_id?: string;
    broadcast_id?: string;
  } | null;

  /* Una difusión también deja una fila `kind = 'plantilla'`, y esa la atribuye
     `attributeReply` con su recipient. Si no se cortara acá, esta función le
     robaría la atribución a la difusión y el embudo quedaría vacío. */
  if (meta?.broadcast_id) return null;
  if (!meta?.template_id) return null;

  const { data: tpl } = await supabase
    .from("wa_templates")
    .select("name, buttons")
    .eq("id", meta.template_id)
    .eq("agency_id", input.agencyId)
    .maybeSingle();
  if (!tpl) return null;

  const buttons = Array.isArray(tpl.buttons) ? (tpl.buttons as TemplateButton[]) : [];
  const tocado = (input.buttonPayload ?? "").trim() || input.text.trim();
  const button = tocado
    ? (buttons.find((b) => b?.text && mismoTexto(b.text, tocado)) ?? null)
    : null;

  return {
    templateName: tpl.name,
    /* Sin botón identificado queda el mismo criterio que en la difusión: de todo
       lo que puede escribir una persona, lo único que hace falta detectar solo
       es la baja. */
    intent: button?.intent ?? (looksLikeOptOut(input.text) ? "baja" : null),
    buttonLabel: button?.text ?? null,
  };
}

/**
 * Cierra el círculo del lado de la plantilla del chat: aplica la baja si eso fue
 * lo que tocó y deja el rastro en la ficha del contacto.
 *
 * No hay `broadcast_recipients` que actualizar —no hubo difusión—, así que es
 * bastante más corto que su hermano de abajo.
 */
export async function recordTemplateReply(
  supabase: Admin,
  input: {
    reply: TemplateReply;
    agencyId: string;
    contactId: string;
    conversationId: string;
    leadId: string | null;
  },
): Promise<void> {
  if (input.reply.intent === "baja") {
    await applyOptOut(supabase, {
      agencyId: input.agencyId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      motivo: `Tocó "${input.reply.buttonLabel ?? "No me interesa"}" en la plantilla "${input.reply.templateName}"`,
    });
  }

  /* Solo si se pudo identificar el botón: sin eso, "respondió la plantilla" es
     ruido — el mensaje ya está en el hilo y se lee solo. */
  if (!input.reply.buttonLabel) return;

  await supabase.from("activities").insert({
    agency_id: input.agencyId,
    contact_id: input.contactId,
    lead_id: input.leadId,
    type: "whatsapp",
    body: `Tocó "${input.reply.buttonLabel}" en la plantilla "${input.reply.templateName}"`,
  });
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
    .select("id, agency_id, replied_at, intent, button_label, reply_text, lead_id, conversation_id")
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
      /* El hilo que se guarda es el de la difusión —el del número madre, que es
         donde salió—. La respuesta puede entrar por el número de la sucursal, y
         pisarlo dejaría el link "ir al chat" de la pantalla de resultados
         apuntando a otro lado. Solo se completa si estaba vacío. */
      conversation_id: row.conversation_id ?? input.conversationId,
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
      motivo: `Pidió la baja en la difusión "${input.reply.broadcastName}"`,
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
  input: {
    agencyId: string;
    contactId: string;
    conversationId: string;
    /** De dónde salió la baja, ya redactado: la difusión o la plantilla del chat. */
    motivo: string;
  },
): Promise<void> {
  const { error } = await supabase
    .from("contacts")
    .update({
      wa_opt_out_at: new Date().toISOString(),
      wa_opt_out_reason: input.motivo,
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

/**
 * Frases que, ARRANCANDO el mensaje y sin nada más atrás, son una baja.
 *
 * Tienen que estar al principio: la versión con `includes` daba de baja para
 * siempre a quien escribía "ese paquete no me interesa, mostrame otro" —el
 * mensaje más caliente que puede mandar un cliente— y encima le sacaba el aviso
 * al vendedor.
 */
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

/** Lo que puede venir detrás de la frase sin dejar de ser una baja: "gracias". */
const COLA_MAXIMA = 18;

/**
 * Si después de la frase aparece cualquiera de estas, el mensaje sigue: no está
 * pidiendo la baja, está pidiendo otra cosa.
 */
const SIGUE_LA_CHARLA =
  /\b(pero|otro|otra|otros|otras|mostra|mostrame|manda|mandame|mandenme|tenes|tienen|hay|queda|quedan|cuanto|precio|info|informacion|opcion|opciones|quiero|busco|necesito)\b/;

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
 * mucho peor que mandarle una difusión de más, y la baja es para siempre. Por
 * eso la frase tiene que ABRIR el mensaje, casi no puede haber nada detrás, y
 * nada de lo que haya puede sonar a "seguime mostrando".
 *
 * Además de esos tres frenos siguen los de antes: mensaje corto y sin preguntas
 * ("no me interesa Brasil, ¿tenés algo del Caribe?" es una consulta caliente).
 *
 * Lo que ESTO NO ES: un detector de intención. La baja de verdad es el botón de
 * la plantilla, que viene con su `intent` declarado. Esto solo agarra al que la
 * escribe, y prefiere dejar pasar diez antes que equivocarse con uno.
 */
export function looksLikeOptOut(text: string): boolean {
  const limpio = normalizar(text);
  if (!limpio) return false;
  if (BAJA_EXACTA.has(limpio)) return true;
  if (limpio.length > 60) return false;
  if (text.includes("?") || text.includes("¿")) return false;

  // La más larga gana: "darme de baja" antes que "dar de baja".
  const frase = BAJA_FRASES.filter((f) => limpio.startsWith(f)).sort(
    (a, b) => b.length - a.length,
  )[0];
  if (!frase) return false;

  const cola = limpio.slice(frase.length).trim();
  if (cola.length > COLA_MAXIMA) return false;
  return !SIGUE_LA_CHARLA.test(cola);
}
