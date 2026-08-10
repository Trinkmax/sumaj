/**
 * Plantillas de la Cloud API — crearlas, listarlas y borrarlas en Meta.
 *
 * Hermano de `cloud.ts` y con sus mismas reglas: SOLO SERVIDOR, no importa
 * Supabase, no sabe de agencias ni de sesiones, recibe las credenciales ya
 * resueltas y devuelve `GraphResult<T>`. NUNCA tira una excepción: del otro lado
 * hay un admin esperando entender por qué Meta no le aprueba una plantilla, no
 * un stack trace.
 *
 * Por qué vive acá y no en cloud.ts: aquel módulo es el camino caliente del
 * mensaje (entra una consulta, sale una respuesta) y este es un trámite que se
 * hace de a una vez cada mucho. Mezclarlos haría que cada envío cargue el peso
 * del trámite.
 *
 * El helper `graph()` de cloud.ts es privado, así que el patrón de fetch está
 * replicado tal cual —mismo timeout, misma extracción del error de Meta— en vez
 * de ampliar la superficie pública de un módulo que usa todo el sistema.
 */

import type { CloudCreds, GraphResult } from "@/lib/wa/cloud";
import type { TemplateButton } from "@/lib/types";

/** Misma versión y mismo override que cloud.ts: los dos le hablan al mismo Graph. */
const GRAPH_VERSION = process.env.WA_GRAPH_VERSION?.trim() || "v25.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Topes de Meta. Los validamos de este lado para que el admin lea un motivo en
 * criollo y no un 400 con el número de error adentro.
 */
const MAX_NAME = 60;
const MAX_BODY = 1024;
const MAX_HEADER = 60;
const MAX_FOOTER = 60;
const MAX_BUTTON_TEXT = 25;
const MAX_BUTTONS = 10;
const MAX_URL_BUTTONS = 2;

/**
 * Tope de vueltas de la paginación: 100 plantillas por página × 25 = 2.500.
 * Una agencia real no llega ni a cien; el tope está para que un `paging` que se
 * repite a sí mismo no deje el sync girando para siempre.
 */
const MAX_PAGES = 25;

/** Campos que le pedimos a Meta de cada plantilla. */
const TEMPLATE_FIELDS =
  "id,name,language,status,category,components,quality_score,rejected_reason";

/* ═══════════════════════════════════════════════════════════
   PLOMERÍA DEL GRAPH (espejo de cloud.ts)
   ═══════════════════════════════════════════════════════════ */

type GraphError = {
  message?: string;
  code?: number;
  error_subcode?: number;
  error_user_msg?: string;
  error_data?: { details?: string };
};

/**
 * El texto accionable de Meta no siempre está en el mismo lugar: en los rechazos
 * de plantilla viaja en `error_user_msg` y `message` es el genérico con el
 * código. Por eso el orden.
 */
function graphError(payload: { error?: GraphError } | null, status: number): string {
  const e = payload?.error;
  return (
    e?.error_data?.details ??
    e?.error_user_msg ??
    e?.message ??
    `Meta respondió ${status}.`
  );
}

/** El ID se interpola en una URL que sale con el token: no puede traer basura. */
function isMetaId(value: string | null | undefined): value is string {
  return !!value && /^\d{5,25}$/.test(value);
}

async function graph<T>(
  path: string,
  init: {
    method?: "GET" | "POST" | "DELETE";
    token: string;
    query?: Record<string, string | undefined>;
    body?: unknown;
  },
): Promise<GraphResult<T>> {
  const url = new URL(`${GRAPH}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${init.token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      // Meta a veces se toma su tiempo; sin corte, un request colgado se lleva
      // puesto el render del Server Component o la corrida del cron.
      signal: AbortSignal.timeout(15_000),
    });

    const payload = (await res.json().catch(() => null)) as
      | (T & { error?: GraphError })
      | null;

    if (!res.ok || payload?.error) {
      return {
        ok: false,
        error: graphError(payload, res.status),
        code: payload?.error?.code ?? res.status,
      };
    }
    return { ok: true, data: (payload ?? {}) as T };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "TimeoutError";
    return {
      ok: false,
      error: aborted
        ? "Meta tardó demasiado en responder. Probá de nuevo en un minuto."
        : "No se pudo conectar con la Cloud API de Meta.",
      code: null,
    };
  }
}

/* ═══════════════════════════════════════════════════════════
   NOMBRES Y VARIABLES
   ═══════════════════════════════════════════════════════════ */

/**
 * Nombre técnico válido para Meta a partir de uno humano.
 * "Promo Brasil ¡2x1!" → "promo_brasil_2x1".
 *
 * Meta solo acepta minúsculas, números y guiones bajos, así que los acentos se
 * descomponen (NFD) y se les saca el diacrítico en vez de convertirlos en
 * guiones: "cumpleaños" tiene que quedar "cumpleanos" y no "cumplea_os".
 */
export function toMetaName(label: string): string {
  const clean = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_NAME)
    // el corte a 60 puede dejar un guion bajo colgando al final
    .replace(/_+$/g, "");

  // Un nombre vacío (un label que era solo emojis o signos) rompería la creación
  // con un error de Meta imposible de interpretar. Mejor uno genérico que la
  // persona ve y puede cambiar.
  return clean || "plantilla";
}

/**
 * Las `{{variables}}` del cuerpo, en orden de aparición y sin repetir.
 *
 * La expresión es la MISMA que usa `fillTemplate` de `lib/domain.ts`: si acá
 * reconociéramos una variable que allá no se reemplaza (o al revés), Meta
 * recibiría un ejemplo de algo que después sale sin completar.
 */
export function extractVariables(body: string): string[] {
  const found: string[] = [];
  for (const m of body.matchAll(/\{\{(\w+)\}\}/g)) {
    const name = m[1];
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

/* ═══════════════════════════════════════════════════════════
   LISTAR
   ═══════════════════════════════════════════════════════════ */

export type MetaTemplateStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "PAUSED"
  | "DISABLED"
  | "PENDING_DELETION";

export type MetaTemplate = {
  id: string;
  name: string;
  language: string;
  status: MetaTemplateStatus;
  category: string;
  body: string;
  header: string | null;
  footer: string | null;
  /**
   * OJO al sincronizar: `intent` siempre vuelve en null porque la intención es
   * nuestra —Meta no la conoce ni la guarda—. Quien haga el upsert tiene que
   * conservar la que ya tenía la fila, o la difusión deja de calificar leads.
   */
  buttons: TemplateButton[];
  variables: string[];
  qualityScore: string | null;
  rejectedReason: string | null;
};

const KNOWN_STATUSES: readonly string[] = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "PAUSED",
  "DISABLED",
  "PENDING_DELETION",
];

/**
 * Meta tiene más estados de los que guarda nuestra base (la 0027 los limita a
 * seis). Los que faltan se traducen al más cercano, y cualquiera desconocido cae
 * en PAUSED a propósito: ante la duda la plantilla NO se puede usar. Dar por
 * aprobada una que no lo está manda una difusión entera contra un 400.
 */
function toStatus(raw: string | null | undefined): MetaTemplateStatus {
  const s = (raw ?? "").toUpperCase();
  if (KNOWN_STATUSES.includes(s)) return s as MetaTemplateStatus;
  if (s === "IN_APPEAL") return "PENDING";
  if (s === "DELETED") return "PENDING_DELETION";
  return "PAUSED";
}

type RawButton = {
  type?: string;
  text?: string;
  url?: string;
  phone_number?: string;
};

type RawComponent = {
  type?: string;
  format?: string;
  text?: string;
  buttons?: RawButton[];
};

type RawTemplate = {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: RawComponent[];
  /** Meta lo manda como objeto `{score, date}`, pero en cuentas viejas viene string. */
  quality_score?: { score?: string } | string;
  rejected_reason?: string;
};

/** Los botones de Meta, de vuelta a nuestra forma. */
function parseButtons(raw: RawButton[]): TemplateButton[] {
  const out: TemplateButton[] = [];
  for (const b of raw) {
    const type = (b.type ?? "").toUpperCase();
    const text = (b.text ?? "").trim();
    if (!text) continue;

    if (type === "QUICK_REPLY") {
      out.push({ type: "quick_reply", text, intent: null });
    } else if (type === "URL" && b.url) {
      out.push({ type: "url", text, url: b.url });
    }
    // Los tipos que no modelamos (PHONE_NUMBER, COPY_CODE, FLOW…) se descartan.
    // Se pueden descartar sin romper nada porque Meta obliga a que los quick
    // reply vayan primero: el índice de los botones que sí nos importan —el que
    // identifica el toque— no se mueve.
  }
  return out;
}

function toMetaTemplate(raw: RawTemplate): MetaTemplate {
  let body = "";
  let header: string | null = null;
  let footer: string | null = null;
  let buttons: TemplateButton[] = [];

  for (const comp of raw.components ?? []) {
    const type = (comp.type ?? "").toUpperCase();
    if (type === "BODY") {
      body = comp.text ?? "";
    } else if (type === "HEADER") {
      // Solo el encabezado de texto: uno de imagen o video no se puede editar
      // desde acá y guardarlo como texto vacío mentiría en la pantalla.
      if ((comp.format ?? "TEXT").toUpperCase() === "TEXT") header = comp.text ?? null;
    } else if (type === "FOOTER") {
      footer = comp.text ?? null;
    } else if (type === "BUTTONS") {
      buttons = parseButtons(comp.buttons ?? []);
    }
  }

  const quality =
    typeof raw.quality_score === "string"
      ? raw.quality_score
      : (raw.quality_score?.score ?? null);

  const rejected = raw.rejected_reason ?? null;

  return {
    id: raw.id ?? "",
    name: raw.name ?? "",
    language: raw.language ?? "",
    status: toStatus(raw.status),
    category: (raw.category ?? "").toLowerCase(),
    body,
    header,
    footer,
    buttons,
    variables: extractVariables(body),
    // "NONE" es lo que manda Meta cuando no hay rechazo: guardarlo como motivo
    // haría que la pantalla muestre "rechazada: NONE".
    qualityScore: quality && quality.toUpperCase() !== "UNKNOWN" ? quality.toUpperCase() : null,
    rejectedReason: rejected && rejected.toUpperCase() !== "NONE" ? rejected : null,
  };
}

type ListResponse = {
  data?: RawTemplate[];
  paging?: { next?: string; cursors?: { after?: string } };
};

/**
 * El cursor de la próxima página.
 *
 * Meta manda `paging.next` como URL absoluta y completa, pero no la seguimos tal
 * cual: es una dirección que viene en una respuesta y nosotros le colgamos el
 * token de la agencia en el header. Le sacamos el cursor y rearmamos NOSOTROS el
 * pedido contra el host de siempre.
 */
function nextCursor(paging: ListResponse["paging"]): string | null {
  if (!paging?.next) return null;
  if (paging.cursors?.after) return paging.cursors.after;
  try {
    return new URL(paging.next).searchParams.get("after");
  } catch {
    return null;
  }
}

/**
 * Todas las plantillas de la WABA, con su estado real.
 *
 * OJO: Meta devuelve UNA fila por idioma. Dos idiomas de la misma plantilla
 * comparten `name` y se distinguen por `language`.
 */
export async function listMetaTemplates(
  creds: CloudCreds,
): Promise<GraphResult<MetaTemplate[]>> {
  if (!creds.token) return { ok: false, error: "Falta el token de la Cloud API.", code: null };
  if (!isMetaId(creds.wabaId)) {
    return { ok: false, error: "El WABA ID de Meta son solo números.", code: null };
  }

  const out: MetaTemplate[] = [];
  let after: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await graph<ListResponse>(`/${creds.wabaId}/message_templates`, {
      token: creds.token,
      query: { fields: TEMPLATE_FIELDS, limit: "100", after },
    });
    if (!res.ok) return res;

    for (const raw of res.data.data ?? []) {
      const parsed = toMetaTemplate(raw);
      // Sin nombre no la podemos casar con ninguna fila nuestra: es ruido.
      if (parsed.name) out.push(parsed);
    }

    const cursor = nextCursor(res.data.paging);
    // Un cursor que no avanza es un bug de la otra punta: cortamos con lo que hay.
    if (!cursor || cursor === after) break;
    after = cursor;
  }

  return { ok: true, data: out };
}

/* ═══════════════════════════════════════════════════════════
   CREAR

   Todo lo que se valida acá es un rechazo de Meta que ya vimos: el ejemplo de
   las variables, el orden de los botones y los topes. Un error nuestro dice qué
   arreglar; el de Meta dice "(#100) Invalid parameter".
   ═══════════════════════════════════════════════════════════ */

export type CreateTemplateInput = {
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY";
  body: string;
  variables: string[];
  sampleVars: Record<string, string>;
  header?: string | null;
  footer?: string | null;
  buttons: TemplateButton[];
};

/**
 * Caracteres como los cuenta la persona que escribe, no unidades UTF-16: un
 * emoji es uno solo. Los textos que van al cliente por WhatsApp sí llevan
 * emojis y con `.length` un botón de tres palabras parecía pasarse del tope.
 */
function charCount(text: string): number {
  return [...text].length;
}

/** El motivo por el que la plantilla no se puede mandar, o null si está bien. */
function validateTemplate(input: CreateTemplateInput): string | null {
  if (!/^[a-z0-9_]{1,60}$/.test(input.name)) {
    return "El nombre de la plantilla solo puede tener minúsculas, números y guiones bajos, y hasta 60 caracteres.";
  }
  if (!/^[a-z]{2,3}(_[A-Za-z]{2,4})?$/.test(input.language)) {
    return "El idioma de la plantilla no tiene un código válido. Usá uno como es_AR.";
  }
  if (input.category !== "MARKETING" && input.category !== "UTILITY") {
    return "La categoría tiene que ser marketing o utility.";
  }

  const body = input.body.trim();
  if (!body) return "El mensaje no puede estar vacío.";
  if (charCount(body) > MAX_BODY) {
    return "El mensaje es muy largo: Meta acepta hasta 1.024 caracteres.";
  }

  const header = input.header?.trim() ?? "";
  if (header) {
    // Un encabezado con variable necesita su propio ejemplo declarado y nuestro
    // editor no lo pide: si lo dejáramos pasar, Meta rechaza la plantilla entera.
    if (header.includes("{{")) return "El encabezado no admite variables: dejalo con texto fijo.";
    if (charCount(header) > MAX_HEADER) {
      return `El encabezado es muy largo: hasta ${MAX_HEADER} caracteres.`;
    }
  }

  const footer = input.footer?.trim() ?? "";
  if (footer) {
    if (footer.includes("{{")) return "El pie no admite variables: dejalo con texto fijo.";
    if (charCount(footer) > MAX_FOOTER) {
      return `El pie es muy largo: hasta ${MAX_FOOTER} caracteres.`;
    }
  }

  // El cuerpo manda: es lo que Meta parsea. Si la lista declarada no coincide,
  // alguien editó el texto y quedó una variable vieja dando vueltas.
  const inBody = extractVariables(body);
  for (const name of input.variables) {
    if (!inBody.includes(name)) {
      return `La variable {{${name}}} está declarada pero no aparece en el mensaje.`;
    }
  }
  for (const name of inBody) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      return `La variable {{${name}}} no sirve: van en minúscula, sin acentos ni espacios, tipo {{nombre}}.`;
    }
    if (!input.variables.includes(name)) {
      return `Falta declarar la variable {{${name}}} que usa el mensaje.`;
    }
    if (!(input.sampleVars[name] ?? "").trim()) {
      return `Falta el ejemplo de {{${name}}}. Meta rechaza la plantilla si no ve con qué se completa cada variable.`;
    }
  }

  const buttons = input.buttons ?? [];
  if (buttons.length > MAX_BUTTONS) {
    return `Meta acepta hasta ${MAX_BUTTONS} botones por plantilla.`;
  }

  const vistos = new Set<string>();
  let urls = 0;
  let yaHuboOtro = false;

  for (const b of buttons) {
    const text = b.text.trim();
    if (!text) return "Hay un botón sin texto. Poné qué dice o sacalo.";
    if (charCount(text) > MAX_BUTTON_TEXT) {
      return `El botón «${text}» se pasa: hasta ${MAX_BUTTON_TEXT} caracteres.`;
    }
    const clave = text.toLowerCase();
    if (vistos.has(clave)) {
      return `Hay dos botones que dicen «${text}». Meta los quiere distintos.`;
    }
    vistos.add(clave);

    if (b.type === "quick_reply") {
      // Meta exige que los de respuesta rápida vayan TODOS primero. Además el
      // orden es el índice con el que después leemos el toque: si lo
      // reacomodáramos en silencio, la intención guardada dejaría de
      // corresponderse con el botón que tocó el cliente.
      if (yaHuboOtro) {
        return "Poné primero los botones de respuesta rápida y después el que abre un link.";
      }
      continue;
    }

    yaHuboOtro = true;
    urls++;
    if (urls > MAX_URL_BUTTONS) {
      return `Meta acepta hasta ${MAX_URL_BUTTONS} botones con link.`;
    }
    const url = b.url?.trim() ?? "";
    if (url.includes("{{")) return `El link del botón «${text}» no admite variables.`;
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
      return `El botón «${text}» necesita un link completo, que empiece con https://.`;
    }
  }

  return null;
}

type CreateResponse = { id?: string; status?: string; category?: string };

/**
 * Crea la plantilla en Meta y la deja en revisión.
 *
 * Meta contesta en el acto con `PENDING` (o `APPROVED`, que pasa seguido en las
 * de utility): la revisión real puede tardar minutos u horas y la resolución
 * llega por webhook o por el sync.
 */
export async function createMetaTemplate(
  creds: CloudCreds,
  input: CreateTemplateInput,
): Promise<GraphResult<{ id: string; status: MetaTemplateStatus }>> {
  if (!creds.token) return { ok: false, error: "Falta el token de la Cloud API.", code: null };
  if (!isMetaId(creds.wabaId)) {
    return { ok: false, error: "El WABA ID de Meta son solo números.", code: null };
  }

  const problema = validateTemplate(input);
  if (problema) return { ok: false, error: problema, code: null };

  const body = input.body.trim();
  const header = input.header?.trim() ?? "";
  const footer = input.footer?.trim() ?? "";
  const variables = extractVariables(body);

  const components: Record<string, unknown>[] = [];

  if (header) components.push({ type: "HEADER", format: "TEXT", text: header });

  components.push({
    type: "BODY",
    text: body,
    // Sin el ejemplo declarado Meta rechaza la creación: no le alcanza con ver
    // los {{nombre}} en el texto, quiere saber con qué se completan.
    ...(variables.length
      ? {
          example: {
            body_text_named_params: variables.map((name) => ({
              param_name: name,
              example: input.sampleVars[name].trim(),
            })),
          },
        }
      : {}),
  });

  if (footer) components.push({ type: "FOOTER", text: footer });

  if (input.buttons.length) {
    components.push({
      type: "BUTTONS",
      buttons: input.buttons.map((b) =>
        b.type === "quick_reply"
          ? { type: "QUICK_REPLY", text: b.text.trim() }
          : { type: "URL", text: b.text.trim(), url: (b.url ?? "").trim() },
      ),
    });
  }

  const res = await graph<CreateResponse>(`/${creds.wabaId}/message_templates`, {
    method: "POST",
    token: creds.token,
    body: {
      name: input.name,
      language: input.language,
      category: input.category,
      components,
    },
  });
  if (!res.ok) return res;

  if (!res.data.id) {
    return {
      ok: false,
      error: "Meta aceptó el pedido pero no devolvió la plantilla. Sincronizá para ver cómo quedó.",
      code: null,
    };
  }

  return { ok: true, data: { id: res.data.id, status: toStatus(res.data.status) } };
}

/* ═══════════════════════════════════════════════════════════
   BORRAR
   ═══════════════════════════════════════════════════════════ */

/**
 * Borra la plantilla en Meta.
 *
 * Con `metaId` se borra SOLO ese idioma; sin él, todos los idiomas que compartan
 * el nombre. Mandamos los dos cuando tenemos el id porque es lo que el admin
 * espera: borra la que está viendo, no la familia entera.
 *
 * Meta no libera el nombre en el momento: queda en `PENDING_DELETION` un rato y
 * recién después se puede volver a usar.
 */
export async function deleteMetaTemplate(
  creds: CloudCreds,
  input: { name: string; metaId?: string | null },
): Promise<GraphResult<null>> {
  if (!creds.token) return { ok: false, error: "Falta el token de la Cloud API.", code: null };
  if (!isMetaId(creds.wabaId)) {
    return { ok: false, error: "El WABA ID de Meta son solo números.", code: null };
  }
  if (!/^[a-z0-9_]{1,60}$/.test(input.name)) {
    return { ok: false, error: "Esa plantilla no tiene un nombre válido en Meta.", code: null };
  }
  if (input.metaId && !isMetaId(input.metaId)) {
    return { ok: false, error: "El id de la plantilla en Meta no es válido.", code: null };
  }

  const res = await graph<{ success?: boolean }>(`/${creds.wabaId}/message_templates`, {
    method: "DELETE",
    token: creds.token,
    query: { name: input.name, hsm_id: input.metaId ?? undefined },
  });
  if (!res.ok) return res;
  return { ok: true, data: null };
}
