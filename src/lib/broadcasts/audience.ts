/**
 * A QUIÉNES LES LLEGA UNA DIFUSIÓN.
 *
 * Tipos y helpers puros: los usa la pantalla que arma la difusión (browser) y
 * la action que la materializa (servidor). Por eso NO lleva "use server" ni
 * toca Supabase.
 *
 * El filtrado de verdad vive en SQL (`public.broadcast_audience`, migración
 * 0027): contar "clientes de Brasil que no compran hace 6 meses" tiene que
 * volver en milisegundos mientras el vendedor mueve los filtros. Acá arriba
 * solo hay tres cosas:
 *   1. la forma de la fila que devuelve esa función,
 *   2. cómo se le explica al vendedor a quién está por escribirle,
 *   3. los atajos (presets) que resuelven las difusiones que de verdad hacen
 *      plata en una agencia argentina.
 *
 * Lo que la función de base YA descuenta sola y no hay que repetir en ningún
 * lado: los que no tienen teléfono, los que se dieron de baja, los que
 * recibieron otra difusión hace poco y —salvo que se pida lo contrario— los que
 * están en medio de un presupuesto o una negociación.
 */

import {
  Cake,
  Luggage,
  Megaphone,
  MessageCircleQuestion,
  ReceiptText,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { STAGE_BY_KEY } from "@/lib/domain";
import { fmtDate } from "@/lib/format";
import type { BroadcastAudience, LeadStage } from "@/lib/types";

/* ═══════════════════════════════════════════════════════════
   La fila de la audiencia
   ═══════════════════════════════════════════════════════════ */

/** Una persona alcanzada por los filtros, ya lista para pintar o para mandar. */
export type AudienceRow = {
  contactId: string;
  fullName: string;
  phone: string;
  isClient: boolean;
  lastStage: LeadStage | null;
  lastDestination: string | null;
  branchId: string | null;
  lastBroadcastAt: string | null;
};

/**
 * La fila cruda de la RPC, en snake_case. Los tipos generados la dan sin nulls
 * (postgres no declara la nulabilidad de un `returns table`), pero en la
 * práctica todo lo que sale de un left join puede venir vacío.
 */
export type AudienceRpcRow = {
  contact_id: string;
  full_name: string | null;
  phone: string | null;
  is_client: boolean | null;
  last_lead_stage: LeadStage | null;
  last_destination: string | null;
  branch_id: string | null;
  last_broadcast_at: string | null;
};

export function toAudienceRow(row: AudienceRpcRow): AudienceRow {
  return {
    contactId: row.contact_id,
    fullName: row.full_name?.trim() || "Sin nombre",
    phone: row.phone ?? "",
    isClient: row.is_client ?? false,
    lastStage: row.last_lead_stage,
    lastDestination: row.last_destination?.trim() || null,
    branchId: row.branch_id,
    lastBroadcastAt: row.last_broadcast_at,
  };
}

/**
 * El formulario en blanco. Todas las claves presentes para que la pantalla
 * pueda atarlas sin `?? null` en cada input, y con los mismos valores por
 * defecto que asume la función de base.
 */
export const EMPTY_AUDIENCE: BroadcastAudience = {
  tags: [],
  tags_mode: "any",
  stages: [],
  clients: "todos",
  branch_id: null,
  assigned_to: null,
  destination: null,
  created_from: null,
  created_to: null,
  birthday_month: null,
  quiet_days: null,
  no_broadcast_days: 7,
  skip_active: true,
};

/** El freno de fatiga que aplica la base cuando nadie lo toca. */
const FATIGA_POR_DEFECTO = 7;

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/* ═══════════════════════════════════════════════════════════
   Cómo se lo contamos al vendedor
   ═══════════════════════════════════════════════════════════ */

/** "Brasil, Caribe y Europa" / "Brasil o Caribe" */
function enumerar(items: string[], union: "y" | "o"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${union} ${items[items.length - 1]}`;
}

/** "1 día" / "90 días" */
function dias(n: number): string {
  return n === 1 ? "1 día" : `${n} días`;
}

/**
 * Los filtros en criollo, una frase por chip.
 *
 * Es la última línea de defensa antes de mandarle un mensaje a mil personas:
 * el vendedor tiene que poder leer de un vistazo a quién le está por escribir,
 * sin traducir mentalmente un jsonb.
 */
export function describeAudience(
  a: BroadcastAudience,
  ctx: { tags: { id: string; name: string }[]; branches: { id: string; name: string }[] },
): string[] {
  const chips: string[] = [];

  if (a.clients === "clientes") chips.push("Clientes");
  else if (a.clients === "no_clientes") chips.push("Todavía no compraron");

  const stages = a.stages ?? [];
  if (stages.length === 1) {
    chips.push(`Etapa ${STAGE_BY_KEY[stages[0]].label}`);
  } else if (stages.length > 1) {
    chips.push(`Etapas ${enumerar(stages.map((s) => STAGE_BY_KEY[s].label), "o")}`);
  }

  const tagIds = a.tags ?? [];
  if (tagIds.length > 0) {
    const nombres = tagIds
      .map((id) => ctx.tags.find((t) => t.id === id)?.name)
      .filter((n): n is string => !!n);
    const todas = a.tags_mode === "all";
    if (nombres.length === 0) {
      // las etiquetas se borraron o todavía no cargaron: al menos decir cuántas
      chips.push(tagIds.length === 1 ? "1 etiqueta" : `${tagIds.length} etiquetas`);
    } else if (nombres.length === 1) {
      chips.push(`Etiqueta ${nombres[0]}`);
    } else {
      chips.push(
        todas
          ? `Con las etiquetas ${enumerar(nombres, "y")}`
          : `Etiqueta ${enumerar(nombres, "o")}`,
      );
    }
  }

  const destino = a.destination?.trim();
  if (destino) chips.push(`Preguntaron por ${destino}`);

  if (a.branch_id) {
    const nombre = ctx.branches.find((b) => b.id === a.branch_id)?.name;
    chips.push(nombre ? `Sucursal ${nombre}` : "De una sucursal");
  }

  if (a.assigned_to) chips.push("De un solo vendedor");

  if (a.birthday_month && a.birthday_month >= 1 && a.birthday_month <= 12) {
    chips.push(`Cumplen en ${MESES[a.birthday_month - 1]}`);
  }

  if (a.created_from && a.created_to) {
    chips.push(`Cargados entre el ${fmtDate(a.created_from)} y el ${fmtDate(a.created_to)}`);
  } else if (a.created_from) {
    chips.push(`Cargados desde el ${fmtDate(a.created_from)}`);
  } else if (a.created_to) {
    chips.push(`Cargados hasta el ${fmtDate(a.created_to)}`);
  }

  if (a.quiet_days != null && a.quiet_days > 0) {
    chips.push(`Sin movimiento hace ${dias(a.quiet_days)}`);
  }

  // La fatiga se menciona solo cuando la tocaron: repetir el default en cada
  // difusión es ruido, y el chip tiene que decir lo que este envío hace distinto.
  const fatiga = a.no_broadcast_days;
  if (fatiga != null && fatiga !== FATIGA_POR_DEFECTO) {
    chips.push(fatiga === 0 ? "Aunque hayan recibido otra difusión" : `Sin difusiones hace ${dias(fatiga)}`);
  }

  if (a.skip_active === false) chips.push("Incluye presupuestos y negociaciones en curso");

  if (chips.length === 0) return ["Todos los que tienen teléfono y no se dieron de baja"];
  return chips;
}

/* ═══════════════════════════════════════════════════════════
   Presets: las difusiones que hacen plata
   ═══════════════════════════════════════════════════════════ */

export type AudiencePreset = {
  key: string;
  label: string;
  /** Por qué a esta gente le conviene escribirle. Una línea, sin vueltas. */
  hint: string;
  icon: LucideIcon;
  filters: BroadcastAudience;
};

/** El mes en curso, 1-12. */
function mesActual(): number {
  return new Date().getMonth() + 1;
}

/**
 * Atajos pensados desde el mostrador, no desde la base de datos.
 *
 * El vendedor no piensa "contactos con is_client = true y último lead sin
 * actualizar hace 150 días": piensa "a los que ya viajaron conmigo y no
 * volvieron". Cada preset es una de esas frases, y el `hint` dice qué se gana
 * mandándole a esa gente.
 *
 * Lo que NO está acá como preset —"los etiquetados con Brasil" o "los que
 * preguntaron por Cancún"— es porque depende de las etiquetas y los destinos de
 * cada agencia: eso se elige en los filtros finos, arriba de cualquiera de
 * estos atajos (por ejemplo: "Clientes que ya viajaron" + etiqueta Caribe).
 */
export const AUDIENCE_PRESETS: AudiencePreset[] = [
  {
    key: "clientes_dormidos",
    label: "Clientes que ya viajaron",
    hint: "Te compraron una vez y hace meses que no saben nada de vos: venderle de nuevo a un cliente sale mucho menos que conseguir uno.",
    icon: Luggage,
    filters: { ...EMPTY_AUDIENCE, clients: "clientes", quiet_days: 150 },
  },
  {
    key: "leads_perdidos",
    label: "Leads perdidos hace 60 días",
    hint: "Cotizaron y no cerraron. Ya se les pasó el susto del precio y una promo nueva los vuelve a poner en carrera.",
    icon: RotateCcw,
    filters: { ...EMPTY_AUDIENCE, stages: ["perdido"], quiet_days: 60 },
  },
  {
    key: "nunca_compraron",
    label: "Nunca compraron",
    hint: "Preguntaron una vez y quedó ahí. Ya saben quién sos: son los más baratos de despertar.",
    icon: MessageCircleQuestion,
    filters: {
      ...EMPTY_AUDIENCE,
      clients: "no_clientes",
      stages: ["nuevo", "contactado"],
      quiet_days: 30,
    },
  },
  {
    key: "presupuestos_frios",
    label: "Presupuestos sin respuesta",
    hint: "Tienen el precio en la mano hace tres semanas y no contestan: de toda la lista son los que están más cerca de comprar.",
    icon: ReceiptText,
    /* skip_active en false a propósito: por defecto la base no molesta a los
       que están en presupuestado o negociación, y sin eso este preset no
       alcanzaría a una sola persona. */
    filters: {
      ...EMPTY_AUDIENCE,
      stages: ["presupuestado"],
      quiet_days: 21,
      skip_active: false,
    },
  },
  {
    key: "cumpleaneros",
    label: "Cumpleañeros del mes",
    hint: "Saludar en el cumpleaños es la excusa más natural que hay para volver a aparecer, y casi ninguna agencia la usa.",
    icon: Cake,
    /* El mes se calcula al LEER la lista y no al cargar el módulo: en el
       servidor este archivo queda en memoria semanas enteras y el 1° de agosto
       seguiría ofreciendo los cumpleaños de julio.
       La fatiga baja a 1 día porque un saludo de cumpleaños no compite con una
       promo: aunque le hayas escrito el martes, hoy corresponde igual. */
    get filters(): BroadcastAudience {
      return { ...EMPTY_AUDIENCE, birthday_month: mesActual(), no_broadcast_days: 1 };
    },
  },
  {
    key: "todos",
    label: "Todos los alcanzables",
    hint: "Todos los que tienen teléfono y no se dieron de baja. Dejalo para la promo que le sirve a cualquiera; si podés, sumale una etiqueta.",
    icon: Megaphone,
    filters: { ...EMPTY_AUDIENCE },
  },
];

/* ═══════════════════════════════════════════════════════════
   Las variables del mensaje
   ═══════════════════════════════════════════════════════════ */

/**
 * Las únicas variables que una difusión sabe completar.
 *
 * Meta rechaza el envío ENTERO si una variable declarada viaja vacía, así que
 * no hay "se llena si hay dato": o tiene valor para todos, o la plantilla no
 * sirve para difundir.
 */
export const BROADCAST_VAR_KEYS = ["nombre", "destino", "agencia", "vendedor"] as const;
export type BroadcastVarKey = (typeof BROADCAST_VAR_KEYS)[number];

/**
 * El primer nombre, o null si lo que hay no es un nombre.
 *
 * Los contactos que entran por WhatsApp sin nombre de perfil se guardan con el
 * teléfono formateado como nombre (`fmtPhone` en el webhook de entrada). Nadie
 * quiere abrir un mensaje que dice "Hola +54 9 351 555-0118".
 */
export function firstName(fullName: string | null | undefined): string | null {
  const limpio = (fullName ?? "").trim();
  if (!limpio) return null;

  const primera = limpio.split(/\s+/)[0].replace(/[^\p{L}\p{M}'-]+$/u, "");
  if (!/\p{L}/u.test(primera)) return null;

  // "MARÍA" gritando en un WhatsApp promocional se lee como spam
  const todoMayus = primera === primera.toUpperCase() && primera.length > 1;
  const nombre = todoMayus
    ? primera[0] + primera.slice(1).toLocaleLowerCase("es-AR")
    : primera;
  return nombre.slice(0, 40);
}

/**
 * Saludo cuando no hay nombre. "Hola qué tal, tenemos una promo…" suena a
 * persona; "Hola Hola," suena a sistema roto.
 */
const SIN_NOMBRE = "qué tal";

/**
 * Meta rechaza los parámetros con saltos de línea o con cuatro espacios
 * seguidos. Un destino cargado a mano como "Brasil \n Bariloche" tiraría abajo
 * la difusión entera sin decir por qué.
 */
function limpiarVar(valor: string, respaldo: string): string {
  const limpio = valor.replace(/\s+/g, " ").trim().slice(0, 120);
  return limpio || respaldo;
}

/**
 * Los valores con los que sale el mensaje de UNA persona.
 *
 * Se calculan al materializar la difusión y se guardan en el destinatario: el
 * despachador manda lo que quedó congelado, aunque mañana el contacto cambie de
 * nombre o el lead cambie de destino. `missing` son las variables que la
 * plantilla pide y esto no sabe llenar — con una sola que quede afuera, Meta
 * rechaza el envío completo, así que el que llama tiene que frenar.
 */
export function buildRecipientVars(input: {
  /** Nombres de las variables de la plantilla, sin llaves. */
  variables: string[];
  fullName: string | null;
  lastDestination: string | null;
  agencyName: string;
  sellerName: string | null;
}): { vars: Record<string, string>; missing: string[] } {
  const agencia = limpiarVar(input.agencyName, "la agencia");
  const valores: Record<BroadcastVarKey, string> = {
    nombre: limpiarVar(firstName(input.fullName) ?? "", SIN_NOMBRE),
    destino: limpiarVar(input.lastDestination ?? "", "tu próximo viaje"),
    agencia,
    vendedor: limpiarVar(input.sellerName ?? "", agencia),
  };

  const vars: Record<string, string> = {};
  const missing: string[] = [];
  for (const clave of input.variables) {
    if (clave in valores) vars[clave] = valores[clave as BroadcastVarKey];
    else if (!missing.includes(clave)) missing.push(clave);
  }
  return { vars, missing };
}
