import type {
  ActivityType,
  FileStatus,
  LeadChannel,
  LeadStage,
  PaymentMethod,
  QuoteStatus,
  ServiceType,
  TripType,
} from "@/lib/types";

/* ───────────────────────────────────────────
   Pipeline / etapas del CRM
   ─────────────────────────────────────────── */
export type StageMeta = {
  key: LeadStage;
  label: string;
  /** clases para el chip/columna del kanban */
  dot: string;
  chip: string;
  headerBar: string;
  /** etapas activas participan del funnel abierto */
  active: boolean;
};

export const STAGES: StageMeta[] = [
  {
    key: "nuevo",
    label: "Nuevo",
    dot: "bg-sky-500",
    chip: "bg-sky-50 text-sky-700 border-sky-200",
    headerBar: "bg-sky-500",
    active: true,
  },
  {
    key: "contactado",
    label: "Contactado",
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-700 border-amber-200",
    headerBar: "bg-amber-500",
    active: true,
  },
  {
    key: "presupuestado",
    label: "Presupuestado",
    dot: "bg-violet-500",
    chip: "bg-violet-50 text-violet-700 border-violet-200",
    headerBar: "bg-violet-500",
    active: true,
  },
  {
    key: "negociacion",
    label: "En negociación",
    dot: "bg-brand-500",
    chip: "bg-brand-50 text-brand-700 border-brand-200",
    headerBar: "bg-brand-500",
    active: true,
  },
  {
    key: "ganado",
    label: "Ganado",
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
    headerBar: "bg-emerald-500",
    active: false,
  },
  {
    key: "perdido",
    label: "Perdido",
    dot: "bg-stone-400",
    chip: "bg-stone-100 text-stone-600 border-stone-200",
    headerBar: "bg-stone-400",
    active: false,
  },
];

export const STAGE_BY_KEY = Object.fromEntries(STAGES.map((s) => [s.key, s])) as Record<
  LeadStage,
  StageMeta
>;

/* ───────────────────────────────────────────
   Canales de origen
   ─────────────────────────────────────────── */
export const CHANNELS: Record<LeadChannel, { label: string; short: string }> = {
  whatsapp: { label: "WhatsApp", short: "WA" },
  instagram: { label: "Instagram", short: "IG" },
  messenger: { label: "Messenger", short: "MS" },
  lead_form: { label: "Formulario Meta", short: "Form" },
  web: { label: "Web", short: "Web" },
  referido: { label: "Referido", short: "Ref" },
  manual: { label: "Carga manual", short: "Manual" },
};

export const TRIP_TYPES: Record<TripType, string> = {
  familiar: "Familiar",
  pareja: "Pareja",
  grupal: "Grupal",
  corporativo: "Corporativo",
  solo: "Solo/a",
};

/* ───────────────────────────────────────────
   Servicios (cotizador y files)
   ─────────────────────────────────────────── */
export const SERVICE_TYPES: Record<
  ServiceType,
  { label: string; plural: string; emoji: string }
> = {
  aereo: { label: "Aéreo", plural: "Aéreos", emoji: "✈️" },
  hotel: { label: "Hotelería", plural: "Hotelería", emoji: "🏨" },
  paquete: { label: "Paquete", plural: "Paquetes", emoji: "🧳" },
  excursion: { label: "Excursión", plural: "Excursiones", emoji: "🚌" },
  traslado: { label: "Traslado", plural: "Traslados", emoji: "🚐" },
  asistencia: { label: "Asistencia", plural: "Asistencia", emoji: "🛡️" },
  circuito: { label: "Circuito", plural: "Circuitos", emoji: "🗺️" },
  crucero: { label: "Crucero", plural: "Cruceros", emoji: "🛳️" },
  otro: { label: "Otro", plural: "Otros", emoji: "📎" },
};

/** Orden de la planilla: aéreos primero, después terrestres */
export const SERVICE_ORDER: ServiceType[] = [
  "aereo",
  "hotel",
  "paquete",
  "circuito",
  "crucero",
  "excursion",
  "traslado",
  "asistencia",
  "otro",
];

/* ───────────────────────────────────────────
   Estados de file / presupuesto / cobros
   ─────────────────────────────────────────── */
export const FILE_STATUSES: Record<FileStatus, { label: string; chip: string }> = {
  vendido: { label: "Vendido", chip: "bg-sky-50 text-sky-700 border-sky-200" },
  pagado: { label: "Pagado", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  en_curso: { label: "En curso", chip: "bg-violet-50 text-violet-700 border-violet-200" },
  finalizado: { label: "Finalizado", chip: "bg-stone-100 text-stone-600 border-stone-200" },
  cancelado: { label: "Cancelado", chip: "bg-red-50 text-red-700 border-red-200" },
};

export const QUOTE_STATUSES: Record<QuoteStatus, { label: string; chip: string }> = {
  borrador: { label: "Borrador", chip: "bg-stone-100 text-stone-600 border-stone-200" },
  enviado: { label: "Enviado", chip: "bg-sky-50 text-sky-700 border-sky-200" },
  aceptado: { label: "Aceptado", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  rechazado: { label: "Rechazado", chip: "bg-red-50 text-red-700 border-red-200" },
  vencido: { label: "Vencido", chip: "bg-amber-50 text-amber-700 border-amber-200" },
};

export const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  mercado_pago: "Mercado Pago",
  deposito: "Depósito",
  otro: "Otro",
};

export const ACTIVITY_TYPES: Record<ActivityType, { label: string; emoji: string }> = {
  nota: { label: "Nota", emoji: "📝" },
  llamada: { label: "Llamada", emoji: "📞" },
  whatsapp: { label: "WhatsApp", emoji: "💬" },
  email: { label: "Email", emoji: "✉️" },
  etapa: { label: "Cambio de etapa", emoji: "🔀" },
  presupuesto: { label: "Presupuesto", emoji: "🧾" },
  sistema: { label: "Sistema", emoji: "⚙️" },
};

/* ───────────────────────────────────────────
   Colores de etiquetas (tags.color → clases)
   ─────────────────────────────────────────── */
export const TAG_COLORS: Record<string, string> = {
  gray: "bg-stone-100 text-stone-700 border-stone-200",
  red: "bg-red-50 text-red-700 border-red-200",
  orange: "bg-orange-50 text-orange-700 border-orange-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  yellow: "bg-yellow-50 text-yellow-700 border-yellow-200",
  green: "bg-green-50 text-green-700 border-green-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  teal: "bg-teal-50 text-teal-700 border-teal-200",
  cyan: "bg-cyan-50 text-cyan-700 border-cyan-200",
  sky: "bg-sky-50 text-sky-700 border-sky-200",
  blue: "bg-blue-50 text-blue-700 border-blue-200",
  indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
  violet: "bg-violet-50 text-violet-700 border-violet-200",
  fuchsia: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
  pink: "bg-pink-50 text-pink-700 border-pink-200",
  rose: "bg-rose-50 text-rose-700 border-rose-200",
};

export const TAG_CATEGORIES = [
  { key: "destino", label: "Destino" },
  { key: "tipo_viaje", label: "Tipo de viaje" },
  { key: "temporada", label: "Temporada" },
  { key: "origen", label: "Origen" },
  { key: "presupuesto", label: "Presupuesto" },
  { key: "otro", label: "Otra" },
] as const;

/* ───────────────────────────────────────────
   Matemática del cotizador — ÚNICA fuente de verdad.
   Replica la planilla "Cotizador Paquetes":
   · cost (Final)  = lo que se paga al proveedor (con impuestos)
   · gross (Bruto) = tarifa comisionable del mayorista
   · comisión mayorista = gross × pct/100
   · Total Paquete = Σ cost
   · Precio Cliente = Total + markup − descuento
   · Comisión total agencia = Σ comisiones + markup − descuento
   ─────────────────────────────────────────── */
export type QuoteItemInput = {
  cost: number;
  gross: number | null;
  commission_pct: number;
  type: ServiceType;
};

export type QuoteCalcInput = {
  items: QuoteItemInput[];
  markup_type: "monto" | "porcentaje";
  markup_value: number;
  discount: number;
  pax: number;
};

export type QuoteTotals = {
  totalCost: number; // Total Paquete
  markupAmount: number; // Mkup en dólares
  markupPct: number; // % sobre el total
  discount: number;
  totalPrice: number; // Precio Cliente
  perPerson: number; // Por persona
  supplierCommission: number; // Σ comisión mayorista
  commissionTotal: number; // comisión mayorista + markup − descuento
  byGroup: { aereos: number; terrestres: number }; // costos por grupo (como la planilla)
  commissionByGroup: { aereos: number; terrestres: number };
};

export function computeQuoteTotals(input: QuoteCalcInput): QuoteTotals {
  const totalCost = round2(input.items.reduce((acc, i) => acc + (i.cost || 0), 0));
  const markupAmount =
    input.markup_type === "porcentaje"
      ? round2((totalCost * (input.markup_value || 0)) / 100)
      : round2(input.markup_value || 0);
  const discount = round2(input.discount || 0);
  const totalPrice = round2(totalCost + markupAmount - discount);
  const pax = Math.max(1, input.pax || 1);

  const supplierCommission = round2(
    input.items.reduce((acc, i) => acc + ((i.gross || 0) * (i.commission_pct || 0)) / 100, 0),
  );

  const aereos = round2(
    input.items.filter((i) => i.type === "aereo").reduce((a, i) => a + (i.cost || 0), 0),
  );
  const commissionAereos = round2(
    input.items
      .filter((i) => i.type === "aereo")
      .reduce((a, i) => a + ((i.gross || 0) * (i.commission_pct || 0)) / 100, 0),
  );

  return {
    totalCost,
    markupAmount,
    markupPct: totalCost > 0 ? round2((markupAmount / totalCost) * 100) : 0,
    discount,
    totalPrice,
    perPerson: round2(totalPrice / pax),
    supplierCommission,
    commissionTotal: round2(supplierCommission + markupAmount - discount),
    byGroup: { aereos, terrestres: round2(totalCost - aereos) },
    commissionByGroup: {
      aereos: commissionAereos,
      terrestres: round2(supplierCommission - commissionAereos),
    },
  };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/* ───────────────────────────────────────────
   Temas del presupuesto compartible (como peluquerOS):
   color + tipografía, persistidos en quotes.theme
   ─────────────────────────────────────────── */
export type QuoteColorTheme = {
  key: string;
  label: string;
  /** fondo de la hoja */
  bg: string;
  /** tinta principal */
  ink: string;
  /** acento (líneas, títulos de sección) */
  accent: string;
  /** swatch para el picker */
  swatch: string;
};

export const QUOTE_COLORS: QuoteColorTheme[] = [
  { key: "sand", label: "Arena", bg: "#faf6ef", ink: "#3d3427", accent: "#a8763e", swatch: "#ead9bd" },
  { key: "rose", label: "Rosa", bg: "#fdf2f4", ink: "#4a2a33", accent: "#b04a5a", swatch: "#f5ccd4" },
  { key: "sky", label: "Cielo", bg: "#f0f6fb", ink: "#243447", accent: "#3b6ea5", swatch: "#c8dff0" },
  { key: "sage", label: "Salvia", bg: "#f2f7f2", ink: "#2c3b2e", accent: "#5a7d5f", swatch: "#cfe0cf" },
  { key: "cyan", label: "Caribe", bg: "#effafa", ink: "#1d3a3c", accent: "#2b7e83", swatch: "#c3e8e9" },
  { key: "lavender", label: "Lavanda", bg: "#f6f4fb", ink: "#332c47", accent: "#6b5ca5", swatch: "#d9d2ee" },
  { key: "terracotta", label: "Terracota", bg: "#fbf3ee", ink: "#42291c", accent: "#b85c38", swatch: "#f0d3c3" },
  { key: "ivory", label: "Marfil", bg: "#fffdf8", ink: "#33302a", accent: "#8f8465", swatch: "#efe9d8" },
];

export const QUOTE_FONTS = [
  { key: "editorial", label: "Editorial", css: "var(--font-fraunces), Georgia, serif" },
  { key: "moderna", label: "Moderna", css: "var(--font-inter), system-ui, sans-serif" },
  { key: "clasica", label: "Clásica", css: "var(--font-cormorant), Georgia, serif" },
];

export function quoteColor(key: string | undefined): QuoteColorTheme {
  return QUOTE_COLORS.find((c) => c.key === key) ?? QUOTE_COLORS[0];
}
export function quoteFont(key: string | undefined) {
  return QUOTE_FONTS.find((f) => f.key === key) ?? QUOTE_FONTS[0];
}

/* ───────────────────────────────────────────
   WhatsApp: interpolación de variables de plantillas
   ─────────────────────────────────────────── */
export function fillTemplate(
  body: string,
  vars: Record<string, string | null | undefined>,
): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

/** link wa.me para abrir chat externo */
export function waLink(phone: string, text?: string): string {
  const p = phone.replace(/\D/g, "");
  return `https://wa.me/${p}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
