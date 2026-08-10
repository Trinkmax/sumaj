"use server";

/**
 * Plantillas de WhatsApp contra Meta.
 *
 * Hasta la 0027 la plantilla se creaba a mano en el panel de Meta y acá se
 * tildaba "aprobada". Ese tilde podía mentir: la agencia armaba una difusión con
 * una plantilla que Meta había rechazado y el envío fallaba sin que nadie
 * entendiera por qué. Ahora la plantilla nace en el sistema, viaja al Graph y el
 * estado LO DICE META (`meta_status`). `is_approved` la deriva un trigger de la
 * base desde ese estado, así que en este archivo nunca se escribe a mano.
 *
 * Acá está SOLO lo que habla con Meta. Editar el texto, el nombre técnico y los
 * botones sigue siendo `upsertTemplate` de `actions/settings.ts`.
 *
 * Las credenciales se resuelven SIEMPRE por agencia (`getCloudCreds(agency.id)`):
 * esto es multi-tenant y una resolución compartida mandaría las plantillas de una
 * agencia a la cuenta de Meta de otra.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction, succeed, fail, logActivity, type ActionResult } from "@/lib/actions/core";
import { templateEstaCongelada } from "@/lib/domain";
import { getCloudCreds } from "@/lib/wa/cloud-credentials";
import type { CloudCreds } from "@/lib/wa/cloud";
import {
  createMetaTemplate,
  deleteMetaTemplate,
  extractVariables,
  listMetaTemplates,
  type MetaTemplate,
} from "@/lib/wa/templates";
import type { Json } from "@/lib/database.types";
import type { Tables, TablesInsert, TemplateButton } from "@/lib/types";

const ADMIN_ONLY = "Esto lo maneja un admin de la agencia.";
const SIN_CUENTA =
  "Todavía no está conectada la cuenta de Meta. Entrá a Configuración, WhatsApp, cargá las credenciales y volvé a intentar.";
const SIN_WABA =
  "Falta la cuenta de WhatsApp Business (el WABA ID). Las plantillas viven ahí, no en el número: cargalo en Configuración, WhatsApp.";

/** Límites duros de Meta. Avisarlos antes ahorra un viaje y un error en inglés. */
const MAX_BODY = 1024;
const MAX_HEADER = 60;
const MAX_FOOTER = 60;
const MAX_BOTONES = 10;
const MAX_BOTONES_URL = 2;

const CATEGORIAS = new Set(["marketing", "utility", "authentication"]);
const ESTADOS_META = new Set([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "PAUSED",
  "DISABLED",
  "PENDING_DELETION",
]);

/**
 * Ejemplos de las variables para el revisor de Meta: si una variable con nombre
 * viaja sin ejemplo, Meta rechaza la creación en el acto. Son los mismos nombres
 * que usa `fillTemplate` en todo el sistema.
 */
const EJEMPLOS: Record<string, string> = {
  nombre: "Caro",
  vendedor: "Vale",
  destino: "Cancún",
  fecha: "12 de octubre",
  precio: "USD 1.200",
};

const idSchema = z.object({ id: z.uuid() });

function revalidate() {
  revalidatePath("/config/plantillas");
  revalidatePath("/difusiones/nueva");
}

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */

/** Credenciales del número madre de la agencia, o el motivo en criollo. */
async function credsDeLaAgencia(
  agencyId: string,
): Promise<{ ok: true; creds: CloudCreds } | { ok: false; error: string }> {
  const creds = await getCloudCreds(agencyId);
  if (!creds) return { ok: false, error: SIN_CUENTA };
  // Las plantillas son de la CUENTA, no del número: sin WABA ID el Graph no
  // tiene a dónde ir y el error de Meta sería un "(#100) Unknown path" ilegible.
  if (!creds.wabaId) return { ok: false, error: SIN_WABA };
  return { ok: true, creds };
}

const botonSchema = z.object({
  type: z.enum(["quick_reply", "url"]),
  text: z.string().trim().min(1).max(25),
  url: z.string().trim().nullish(),
  intent: z.enum(["interesado", "tal_vez", "baja"]).nullish(),
});

/** Los botones guardados en el jsonb. `null` = la columna quedó con basura. */
function leerBotones(raw: unknown): TemplateButton[] | null {
  const parsed = z.array(botonSchema).safeParse(raw ?? []);
  if (!parsed.success) return null;
  return parsed.data.map((b) => ({
    type: b.type,
    text: b.text,
    url: b.url ?? null,
    intent: b.intent ?? null,
  }));
}

/**
 * Meta exige los de respuesta rápida PRIMERO y rechaza la plantilla si vienen
 * mezclados. El orden del array es además el índice con el que se manda y con el
 * que Meta avisa el toque, así que el orden reordenado se guarda también acá: si
 * la base y Meta numeraran distinto, un "me interesa" entraría como una baja.
 */
function ordenarBotones(botones: TemplateButton[]): TemplateButton[] {
  return [
    ...botones.filter((b) => b.type === "quick_reply"),
    ...botones.filter((b) => b.type !== "quick_reply"),
  ];
}

function ejemplosDe(variables: string[], agencyName: string): Record<string, string> {
  return Object.fromEntries(
    variables.map((v) => [v, v === "agencia" ? agencyName : (EJEMPLOS[v] ?? "Ejemplo")]),
  );
}

/**
 * Meta suma estados nuevos cada tanto (IN_APPEAL, LIMIT_EXCEEDED…) y la base
 * solo acepta los seis conocidos. Uno desconocido no es "aprobada", así que se
 * guarda como pausada —que es lo que significa en la práctica: existe pero no se
 * puede usar— y el nombre real queda a la vista en el motivo.
 */
function estadoParaLaBase(status: string): { estado: string; nota: string | null } {
  if (ESTADOS_META.has(status)) return { estado: status, nota: null };
  return { estado: "PAUSED", nota: `Meta la reporta como ${status}.` };
}

/** Meta devuelve la categoría en mayúscula; la base acepta las tres en minúscula. */
function categoriaParaLaBase(categoria: string, actual: string): string {
  const lower = categoria.trim().toLowerCase();
  return CATEGORIAS.has(lower) ? lower : actual;
}

/** "promo_brasil" → "Promo brasil": un nombre para leer, no para Meta. */
function nombreHumano(metaName: string): string {
  const conEspacios = metaName.replace(/_/g, " ").trim();
  if (!conEspacios) return metaName;
  return conEspacios.charAt(0).toUpperCase() + conEspacios.slice(1);
}

/**
 * Borrar algo que ya no está no es un error: puede haberla borrado alguien desde
 * el panel de Meta. Se reconoce por el texto porque el Graph devuelve el mismo
 * código 100 para "no existe" y para media docena de cosas más.
 */
function yaNoEstaEnMeta(error: string): boolean {
  return /does ?n[o']?t exist|not found|no existe|no such/i.test(error);
}

/**
 * ¿Meta rechazó la creación porque el nombre ya está tomado?
 *
 * Es el único motivo por el que se borra antes de recrear. Cualquier otro error
 * tiene que dejar la plantilla de Meta donde estaba.
 */
function nombreOcupado(error: string): boolean {
  return /already exists|ya existe|duplicate/i.test(error);
}

/**
 * La intención de cada botón la ponemos NOSOTROS: Meta no la conoce, no la
 * guarda y no la devuelve (`parseButtons` la trae siempre en null).
 *
 * Sin este merge, tocar "Sincronizar con Meta" apagaba la calificación de leads
 * de toda la agencia en silencio: los tres botones quedaban con `intent: null`,
 * la difusión congelaba esa foto y después nadie entendía por qué el embudo
 * mostraba respuestas sin intención y el botón de baja no daba de baja.
 *
 * El empate se resuelve por el texto del botón, que es lo único que viaja a Meta
 * y vuelve idéntico. Si alguien le cambia el texto desde el panel de Meta, la
 * intención de ESE botón se pierde: es un cambio que hicieron allá y no tenemos
 * con qué reconocerlo.
 */
function conservarIntenciones(
  deMeta: TemplateButton[],
  local: Tables<"wa_templates"> | null,
): TemplateButton[] {
  const locales = leerBotones(local?.buttons) ?? [];
  if (locales.length === 0) return deMeta;

  const porTexto = new Map<string, TemplateButton>();
  for (const b of locales) {
    if (b.type === "quick_reply" && b.intent) porTexto.set(b.text.trim().toLowerCase(), b);
  }
  if (porTexto.size === 0) return deMeta;

  return deMeta.map((b) =>
    b.type === "quick_reply" && !b.intent
      ? { ...b, intent: porTexto.get(b.text.trim().toLowerCase())?.intent ?? null }
      : b,
  );
}

/** Lo que se escribe en la base a partir de lo que devolvió Meta. */
function filaDesdeMeta(
  agencyId: string,
  meta: MetaTemplate,
  local: Tables<"wa_templates"> | null,
  ahora: string,
): TablesInsert<"wa_templates"> {
  const { estado, nota } = estadoParaLaBase(meta.status);
  return {
    agency_id: agencyId,
    meta_name: meta.name,
    // El nombre humano es de la agencia: solo se inventa cuando la plantilla
    // aparece por primera vez (la crearon del lado de Meta).
    name: local?.name ?? nombreHumano(meta.name),
    stage: local?.stage ?? null,
    body: meta.body,
    header_text: meta.header,
    footer_text: meta.footer,
    category: categoriaParaLaBase(meta.category, local?.category ?? "marketing"),
    language: meta.language,
    meta_id: meta.id,
    meta_status: estado,
    rejected_reason: meta.rejectedReason ?? nota,
    quality_score: meta.qualityScore,
    // La intención de cada botón es nuestra: Meta la devuelve vacía y pisarla
    // apagaría la calificación de leads de todas las difusiones futuras.
    buttons: conservarIntenciones(meta.buttons, local) as unknown as Json,
    variables: meta.variables,
    synced_at: ahora,
    // is_approved NO se toca: la escribe el trigger desde meta_status.
  };
}

/** ¿Meta trae algo distinto de lo que ya teníamos? Solo para contar de verdad. */
function huboCambio(
  local: Tables<"wa_templates">,
  fila: TablesInsert<"wa_templates">,
): boolean {
  return (
    local.meta_status !== fila.meta_status ||
    local.meta_id !== fila.meta_id ||
    local.body !== fila.body ||
    local.header_text !== fila.header_text ||
    local.footer_text !== fila.footer_text ||
    local.category !== fila.category ||
    local.language !== fila.language ||
    local.rejected_reason !== fila.rejected_reason ||
    local.quality_score !== fila.quality_score ||
    JSON.stringify(local.variables) !== JSON.stringify(fila.variables) ||
    JSON.stringify(local.buttons) !== JSON.stringify(fila.buttons)
  );
}

/**
 * Meta permite la misma plantilla en varios idiomas y las devuelve como filas
 * distintas con el mismo `name`; acá el nombre técnico es único por agencia. Nos
 * quedamos con una: la del idioma que ya tenía la plantilla local, o la primera
 * en castellano, o la primera que llegue.
 */
function ganaElIdioma(
  candidata: MetaTemplate,
  actual: MetaTemplate,
  idiomaLocal: string | undefined,
): boolean {
  if (idiomaLocal) {
    if (candidata.language === idiomaLocal) return true;
    if (actual.language === idiomaLocal) return false;
  }
  const castellano = (l: string) => l.toLowerCase().startsWith("es");
  return castellano(candidata.language) && !castellano(actual.language);
}

/* ═══════════════════════════════════════════════════════════
   Guardar la plantilla de este lado
   ═══════════════════════════════════════════════════════════ */

const guardarSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Poné un nombre").max(80),
  meta_name: z
    .string()
    .trim()
    .min(1, "Falta el nombre técnico")
    .max(60)
    .regex(/^[a-z0-9_]+$/, "Solo minúsculas, números y guión bajo"),
  stage: z
    .enum(["nuevo", "contactado", "presupuestado", "negociacion", "ganado", "perdido"])
    .nullish(),
  category: z.enum(["marketing", "utility"]),
  body: z.string().trim().min(1, "El mensaje no puede estar vacío").max(MAX_BODY),
  header_text: z.string().trim().max(MAX_HEADER).nullish(),
  footer_text: z.string().trim().max(MAX_FOOTER).nullish(),
  buttons: z.array(botonSchema).max(MAX_BOTONES).default([]),
});

/**
 * Crea o actualiza la plantilla en nuestra base. Es el paso previo a mandarla a
 * Meta, así que devuelve la fila entera: el diálogo la necesita para seguir con
 * el envío sin volver a leer.
 *
 * `is_approved` y `meta_status` no se tocan acá: los escribe el trigger y el
 * sync con Meta.
 */
export async function saveTemplate(
  input: z.input<typeof guardarSchema>,
): Promise<ActionResult<Tables<"wa_templates">>> {
  const parsed = guardarSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "Revisá los datos de la plantilla.";
    return fail(first);
  }
  const { supabase, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const datos = parsed.data;
  const botones = ordenarBotones(
    datos.buttons.map((b) => ({
      type: b.type,
      text: b.text,
      url: b.url ?? null,
      intent: b.intent ?? null,
    })),
  );
  if (botones.filter((b) => b.type === "url").length > MAX_BOTONES_URL) {
    return fail(`Meta acepta hasta ${MAX_BOTONES_URL} botones con link.`);
  }

  const fila = {
    name: datos.name,
    meta_name: datos.meta_name,
    stage: datos.stage ?? null,
    category: datos.category,
    body: datos.body,
    header_text: datos.header_text || null,
    footer_text: datos.footer_text || null,
    buttons: botones as unknown as Json,
    variables: extractVariables(datos.body),
  };

  /* El nombre técnico es único por agencia y el diálogo lo deriva solo del
     nombre humano ("Promo Brasil" → promo_brasil), así que chocar es lo NORMAL
     cuando alguien reusa un nombre. Sin este chequeo el insert explota con un
     23505 y el admin ve "No se pudo crear la plantilla": un cartel que no dice
     qué pasó ni qué hacer, sobre un error que se arregla en dos segundos. */
  const { data: chocada } = await supabase
    .from("wa_templates")
    .select("id, name")
    .eq("agency_id", agency.id)
    .eq("meta_name", fila.meta_name)
    .maybeSingle();

  if (chocada && chocada.id !== datos.id) {
    return fail(
      `Ya tenés una plantilla con el nombre técnico "${fila.meta_name}" (${chocada.name}). ` +
        `Cambiá el nombre, o editá esa en vez de crear una nueva.`,
    );
  }

  if (datos.id) {
    /* El `agency_id` va explícito aunque la RLS ya lo cubra: `my_agency_ids()`
       es PLURAL y `getMemberContext` elige una agencia con un limit(1). Alguien
       activo en dos agencias podría pasar el id de una plantilla de la B
       mientras la sesión resuelve a la A. */
    const { data: actual } = await supabase
      .from("wa_templates")
      .select("id, meta_status, body, header_text, footer_text, buttons, meta_name, category")
      .eq("id", datos.id)
      .eq("agency_id", agency.id)
      .maybeSingle();
    if (!actual) return fail("No encontramos esa plantilla.");

    /* La inmutabilidad no puede vivir solo en el `disabled` del diálogo: si el
       cuerpo de una aprobada cambiara, la difusión congelaría un texto con otra
       cantidad de variables que el que Meta tiene aprobado y el envío entero
       fallaría con un 132000. Nombre y etapa sí se pueden retocar: son nuestros. */
    if (templateEstaCongelada(actual.meta_status)) {
      const cambioElMensaje =
        actual.body !== fila.body ||
        (actual.header_text ?? null) !== fila.header_text ||
        (actual.footer_text ?? null) !== fila.footer_text ||
        actual.meta_name !== fila.meta_name ||
        actual.category !== fila.category ||
        JSON.stringify(actual.buttons ?? []) !== JSON.stringify(fila.buttons);
      if (cambioElMensaje) {
        return fail(
          "En Meta esta plantilla ya no se puede editar. Creá una nueva con el texto que querés.",
        );
      }
    }

    const { data, error } = await supabase
      .from("wa_templates")
      .update(fila)
      .eq("id", datos.id)
      .eq("agency_id", agency.id)
      .select("*")
      .single();
    if (error || !data) return fail("No se pudo guardar la plantilla.");
    revalidate();
    return succeed(data);
  }

  const { data, error } = await supabase
    .from("wa_templates")
    .insert({ agency_id: agency.id, ...fila })
    .select("*")
    .single();
  if (error || !data) {
    // Red de contención del chequeo de arriba: entre el select y el insert
    // alguien pudo crear la misma. El motivo tiene que llegar igual.
    if (error?.code === "23505") {
      return fail(
        `Ya tenés una plantilla con el nombre técnico "${fila.meta_name}". Cambiá el nombre.`,
      );
    }
    return fail("No se pudo crear la plantilla.");
  }

  revalidate();
  return succeed(data);
}

/* ═══════════════════════════════════════════════════════════
   Mandar una plantilla a aprobar
   ═══════════════════════════════════════════════════════════ */

/**
 * Crea la plantilla en Meta y deja el estado que Meta devolvió.
 *
 * Es idempotente de hecho: si la plantilla ya viajó y está pendiente o aprobada,
 * NO se vuelve a crear —Meta la duplicaría o rechazaría el nombre repetido—, se
 * sincroniza su estado y se devuelve eso. Volver a tocar el botón nunca rompe
 * nada.
 */
export async function submitTemplateToMeta(
  input: z.infer<typeof idSchema>,
): Promise<ActionResult<{ status: string }>> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, agency, member, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  /* El `agency_id` explícito no es redundante con la RLS: `my_agency_ids()` es
     plural y la sesión resuelve UNA agencia. Sin este filtro, alguien activo en
     dos agencias podría mandar la plantilla de la B a la WABA de la A. */
  const { data: tpl, error: errorLectura } = await supabase
    .from("wa_templates")
    .select("*")
    .eq("id", parsed.data.id)
    .eq("agency_id", agency.id)
    .maybeSingle();
  if (errorLectura) return fail("No pudimos leer la plantilla. Probá de nuevo.");
  if (!tpl) return fail("No encontramos esa plantilla.");

  const resolved = await credsDeLaAgencia(agency.id);
  if (!resolved.ok) return fail(resolved.error);
  const creds = resolved.creds;

  const ahora = new Date().toISOString();

  /* ── Ya está en Meta: sincronizar en vez de volver a crear ── */
  if (tpl.meta_id && (tpl.meta_status === "PENDING" || tpl.meta_status === "APPROVED")) {
    const listado = await listMetaTemplates(creds);
    if (!listado.ok) {
      // No pudimos preguntar, pero la plantilla YA está allá: crearla de nuevo
      // sería duplicarla. Devolvemos lo último que sabemos, que es la verdad
      // disponible.
      return succeed({ status: tpl.meta_status });
    }
    /* Meta devuelve UNA FILA POR IDIOMA con el mismo `name`. Quedarse con la
       primera que llegue puede traer la versión en portugués: después
       `launchBroadcast` congela ese `language_snapshot` y el despachador manda
       con un idioma que quizá no existe para ese número. Mismo desempate que
       usa el sync. */
    const enMeta = listado.data.reduce<MetaTemplate | null>((mejor, t) => {
      if (t.id !== tpl.meta_id && t.name !== tpl.meta_name) return mejor;
      if (!mejor) return t;
      return ganaElIdioma(t, mejor, tpl.language) ? t : mejor;
    }, null);
    if (enMeta) {
      const fila = filaDesdeMeta(agency.id, enMeta, tpl, ahora);
      const { error } = await supabase.from("wa_templates").update(fila).eq("id", tpl.id);
      if (error) return fail("No se pudo guardar el estado que devolvió Meta. Probá de nuevo.");
      revalidate();
      return succeed({ status: fila.meta_status ?? tpl.meta_status });
    }
    // Estaba en Meta y ya no: la borraron desde el panel. Se vuelve a crear.
  }

  /* ── Validaciones que podemos hacer sin molestar a Meta ── */
  const body = tpl.body.trim();
  if (!body) return fail("La plantilla no tiene mensaje. Escribilo y guardá antes de mandarla.");
  if (body.length > MAX_BODY) {
    return fail(
      `El mensaje tiene ${body.length} caracteres y Meta acepta hasta ${MAX_BODY}. Recortalo y probá de nuevo.`,
    );
  }
  if (tpl.category === "authentication") {
    return fail(
      "Las plantillas de autenticación se crean desde el panel de Meta. Para difundir elegí Marketing.",
    );
  }
  const header = tpl.header_text?.trim() || null;
  const footer = tpl.footer_text?.trim() || null;
  if (header && header.length > MAX_HEADER) {
    return fail(`El encabezado no puede pasar de ${MAX_HEADER} caracteres.`);
  }
  if (footer && footer.length > MAX_FOOTER) {
    return fail(`El pie no puede pasar de ${MAX_FOOTER} caracteres.`);
  }

  const botones = leerBotones(tpl.buttons);
  if (!botones) {
    return fail("Los botones quedaron mal guardados. Abrí la plantilla, revisalos y guardá de nuevo.");
  }
  if (botones.length > MAX_BOTONES) {
    return fail(`Meta acepta hasta ${MAX_BOTONES} botones por plantilla.`);
  }
  if (botones.filter((b) => b.type === "url").length > MAX_BOTONES_URL) {
    return fail(`Meta acepta hasta ${MAX_BOTONES_URL} botones de link por plantilla.`);
  }
  const sinDireccion = botones.find((b) => b.type === "url" && !b.url);
  if (sinDireccion) {
    return fail(`El botón "${sinDireccion.text}" abre un link y no tiene dirección cargada.`);
  }
  const ordenados = ordenarBotones(botones);
  const variables = extractVariables(body);

  const payload = {
    name: tpl.meta_name,
    language: tpl.language,
    category: (tpl.category === "utility" ? "UTILITY" : "MARKETING") as "UTILITY" | "MARKETING",
    body,
    variables,
    sampleVars: ejemplosDe(variables, agency.name),
    header,
    footer,
    buttons: ordenados,
  };

  /* ── Crear PRIMERO, borrar solo si el nombre está ocupado ──
     Una rechazada sigue existiendo en Meta y ocupa el nombre, así que hay que
     borrarla para poder recrearla. Pero borrar de entrada dejaba a la agencia
     sin la plantilla cuando la creación fallaba por cualquier otra cosa (una
     validación nuestra, un 4xx de Meta): la fila local seguía con su `meta_id`
     y su estado viejo, y una difusión en curso pasaba a fallar entera con
     "template not found". Este orden no puede perder nada. */
  let creada = await createMetaTemplate(creds, payload);
  const viveEnMeta = !!tpl.meta_id || tpl.meta_status !== "local";
  if (!creada.ok && viveEnMeta && nombreOcupado(creada.error)) {
    await deleteMetaTemplate(creds, { name: tpl.meta_name, metaId: tpl.meta_id });
    creada = await createMetaTemplate(creds, payload);
  }
  if (!creada.ok) {
    /* Lo que dice Meta es lo ÚNICO que le dice a la agencia qué cambiar, así
       que el detalle va entero — pero enmarcado, porque llega en inglés y solo
       con eso nadie sabe qué hacer. Nuestras propias validaciones (code null)
       ya están en criollo: esas van tal cual. */
    return fail(
      creada.code === null
        ? creada.error
        : `Meta no aceptó la plantilla. Dice: "${creada.error}". Corregí el mensaje y volvé a mandarla.`,
    );
  }

  const { error } = await supabase
    .from("wa_templates")
    .update({
      meta_id: creada.data.id,
      meta_status: creada.data.status,
      buttons: ordenados as unknown as Json,
      variables,
      // Arranca de cero: el motivo del rechazo anterior y la calidad vieja son
      // de una plantilla que ya no existe.
      rejected_reason: null,
      quality_score: null,
      synced_at: ahora,
    })
    .eq("id", tpl.id);
  if (error) {
    return fail(
      "La plantilla se creó en Meta pero no pudimos guardar el estado acá. Tocá Sincronizar con Meta.",
    );
  }

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    type: "sistema",
    body: `Se mandó a aprobar la plantilla ${tpl.name} a Meta`,
  });

  revalidate();
  return succeed({ status: creada.data.status });
}

/* ═══════════════════════════════════════════════════════════
   Traer todo lo que Meta sabe
   ═══════════════════════════════════════════════════════════ */

/**
 * Baja el estado real de todas las plantillas de la cuenta.
 *
 * Es la única forma de enterarse de una aprobación o de un rechazo: el webhook
 * de `message_template_status_update` solo llega si la suscripción se pudo hacer
 * a nivel app, y eso no siempre pasa.
 *
 * Las plantillas que están en Meta y no acá se crean; las que están acá y no en
 * Meta NO se borran: pueden ser de las viejas (`meta_status = 'local'`), que son
 * textos de la agencia que nunca viajaron a ningún lado.
 */
export async function syncTemplatesFromMeta(): Promise<
  ActionResult<{ actualizadas: number; nuevas: number }>
> {
  const { supabase, agency, member, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const resolved = await credsDeLaAgencia(agency.id);
  if (!resolved.ok) return fail(resolved.error);

  const listado = await listMetaTemplates(resolved.creds);
  if (!listado.ok) return fail(listado.error);

  const { data: locales, error: errorLocales } = await supabase
    .from("wa_templates")
    .select("*")
    .eq("agency_id", agency.id);
  if (errorLocales) return fail("No pudimos leer las plantillas guardadas. Probá de nuevo.");

  const porNombre = new Map((locales ?? []).map((t) => [t.meta_name, t]));

  // Una sola plantilla por nombre técnico: el índice único es (agency_id,
  // meta_name) y dos idiomas en el mismo lote harían fallar el upsert entero.
  const elegidas = new Map<string, MetaTemplate>();
  for (const t of listado.data) {
    const actual = elegidas.get(t.name);
    if (!actual || ganaElIdioma(t, actual, porNombre.get(t.name)?.language)) {
      elegidas.set(t.name, t);
    }
  }

  const ahora = new Date().toISOString();
  const filas: TablesInsert<"wa_templates">[] = [];
  let nuevas = 0;
  let actualizadas = 0;

  for (const meta of elegidas.values()) {
    const local = porNombre.get(meta.name) ?? null;
    const fila = filaDesdeMeta(agency.id, meta, local, ahora);
    filas.push(fila);
    if (!local) nuevas += 1;
    else if (huboCambio(local, fila)) actualizadas += 1;
  }

  if (filas.length > 0) {
    // Sin `id` en las filas: el conflicto sobre (agency_id, meta_name) es el que
    // decide si actualiza o inserta, y así la plantilla conserva su id de siempre
    // (del que cuelgan las difusiones y los seguimientos).
    const { error } = await supabase
      .from("wa_templates")
      .upsert(filas, { onConflict: "agency_id,meta_name" });
    if (error) {
      return fail("No se pudieron guardar las plantillas que devolvió Meta. Probá de nuevo.");
    }
  }

  if (nuevas > 0 || actualizadas > 0) {
    await logActivity({
      agencyId: agency.id,
      memberId: member.id,
      type: "sistema",
      body: `Se sincronizaron las plantillas con Meta: ${nuevas} nuevas y ${actualizadas} con cambios`,
    });
  }

  revalidate();
  return succeed({ actualizadas, nuevas });
}

/* ═══════════════════════════════════════════════════════════
   Borrar
   ═══════════════════════════════════════════════════════════ */

/**
 * Borra la plantilla en Meta y recién después acá.
 *
 * El orden importa: si se borrara primero en la base y Meta fallara, el nombre
 * quedaría ocupado allá para siempre y la agencia no podría volver a crearla.
 * Las difusiones y los seguimientos que la usaron no se caen: la referencia
 * queda en null y el texto que salió está congelado en cada difusión.
 */
export async function deleteMetaTemplateAction(
  input: z.infer<typeof idSchema>,
): Promise<ActionResult<null>> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, agency, member, isAdmin } = await requireAction();
  if (!isAdmin) return fail(ADMIN_ONLY);

  const { data: tpl, error: errorLectura } = await supabase
    .from("wa_templates")
    .select("id, name, meta_name, meta_id, meta_status")
    .eq("id", parsed.data.id)
    // Ídem submitTemplateToMeta: la RLS es plural, la sesión resuelve una sola.
    .eq("agency_id", agency.id)
    .maybeSingle();
  if (errorLectura) return fail("No pudimos leer la plantilla. Probá de nuevo.");
  if (!tpl) return fail("No encontramos esa plantilla.");

  const viveEnMeta = !!tpl.meta_id || tpl.meta_status !== "local";
  if (viveEnMeta) {
    const resolved = await credsDeLaAgencia(agency.id);
    if (!resolved.ok) return fail(resolved.error);

    const borrada = await deleteMetaTemplate(resolved.creds, {
      name: tpl.meta_name,
      metaId: tpl.meta_id,
    });
    if (!borrada.ok && !yaNoEstaEnMeta(borrada.error)) return fail(borrada.error);
  }

  const { error } = await supabase.from("wa_templates").delete().eq("id", tpl.id);
  if (error) {
    return fail(
      viveEnMeta
        ? "Se borró en Meta pero no acá. Probá de nuevo para terminar."
        : "No se pudo eliminar la plantilla. Probá de nuevo.",
    );
  }

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    type: "sistema",
    body: `Se eliminó la plantilla ${tpl.name}`,
  });

  revalidate();
  return succeed(null);
}
