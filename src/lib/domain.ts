import {
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  Baby,
  BadgeCheck,
  Banknote,
  BedDouble,
  Briefcase,
  Bus,
  CarFront,
  HandCoins,
  Percent,
  RotateCcw,
  User2,
  Users2,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Clock,
  Cog,
  Coins,
  CreditCard,
  Flag,
  Globe,
  Camera,
  Handshake,
  Heart,
  Landmark,
  Luggage,
  Mail,
  MessageCircle,
  MessageSquare,
  PencilLine,
  Phone,
  PiggyBank,
  Plane,
  PlaneTakeoff,
  ReceiptText,
  Route,
  Send,
  Ship,
  ShieldCheck,
  Smartphone,
  Sparkles,
  StickyNote,
  Trophy,
  User,
  UserPlus,
  Users,
  UsersRound,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import type {
  ActivityType,
  FileStatus,
  LeadChannel,
  LeadStage,
  PaymentDirection,
  PaymentMethod,
  QuoteStatus,
  ServiceType,
  TripType,
} from "@/lib/types";

/* ───────────────────────────────────────────
   Pipeline / etapas del CRM
   Los chips usan tokens `tone-*` (flipean solos en modo oscuro);
   dot/headerBar usan el color vivo 500 (funciona en ambos temas).
   ─────────────────────────────────────────── */
export type StageMeta = {
  key: LeadStage;
  label: string;
  icon: LucideIcon;
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
    icon: Sparkles,
    dot: "bg-sky-500",
    chip: "bg-tone-sky-soft text-tone-sky-text border-tone-sky-line",
    headerBar: "bg-sky-500",
    active: true,
  },
  {
    key: "contactado",
    label: "Contactado",
    icon: MessageCircle,
    dot: "bg-amber-500",
    chip: "bg-tone-amber-soft text-tone-amber-text border-tone-amber-line",
    headerBar: "bg-amber-500",
    active: true,
  },
  {
    key: "presupuestado",
    label: "Presupuestado",
    icon: ReceiptText,
    dot: "bg-violet-500",
    chip: "bg-tone-violet-soft text-tone-violet-text border-tone-violet-line",
    headerBar: "bg-violet-500",
    active: true,
  },
  {
    key: "negociacion",
    label: "En negociación",
    icon: Handshake,
    dot: "bg-brand-500",
    chip: "bg-brand-tint text-brand-text border-brand-tint-line",
    headerBar: "bg-brand-500",
    active: true,
  },
  {
    key: "ganado",
    label: "Ganado",
    icon: Trophy,
    dot: "bg-emerald-500",
    chip: "bg-tone-emerald-soft text-tone-emerald-text border-tone-emerald-line",
    headerBar: "bg-emerald-500",
    active: false,
  },
  {
    key: "perdido",
    label: "Perdido",
    icon: XCircle,
    dot: "bg-stone-400",
    chip: "bg-tone-stone-soft text-tone-stone-text border-tone-stone-line",
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
export const CHANNELS: Record<
  LeadChannel,
  { label: string; short: string; icon: LucideIcon }
> = {
  whatsapp: { label: "WhatsApp", short: "WA", icon: MessageCircle },
  instagram: { label: "Instagram", short: "IG", icon: Camera },
  messenger: { label: "Messenger", short: "MS", icon: MessageSquare },
  lead_form: { label: "Formulario Meta", short: "Form", icon: ClipboardList },
  web: { label: "Web", short: "Web", icon: Globe },
  referido: { label: "Referido", short: "Ref", icon: UserPlus },
  manual: { label: "Carga manual", short: "Manual", icon: PencilLine },
};

export const TRIP_TYPES: Record<TripType, { label: string; icon: LucideIcon }> = {
  familiar: { label: "Familiar", icon: Users },
  pareja: { label: "Pareja", icon: Heart },
  grupal: { label: "Grupal", icon: UsersRound },
  corporativo: { label: "Corporativo", icon: Briefcase },
  solo: { label: "Solo/a", icon: User },
};

/* ───────────────────────────────────────────
   Servicios (cotizador y files)
   ─────────────────────────────────────────── */
export const SERVICE_TYPES: Record<
  ServiceType,
  { label: string; plural: string; icon: LucideIcon }
> = {
  aereo: { label: "Aéreo", plural: "Aéreos", icon: Plane },
  hotel: { label: "Hotelería", plural: "Hotelería", icon: BedDouble },
  paquete: { label: "Paquete", plural: "Paquetes", icon: Luggage },
  excursion: { label: "Excursión", plural: "Excursiones", icon: Bus },
  traslado: { label: "Traslado", plural: "Traslados", icon: CarFront },
  asistencia: { label: "Asistencia", plural: "Asistencia", icon: ShieldCheck },
  circuito: { label: "Circuito", plural: "Circuitos", icon: Route },
  crucero: { label: "Crucero", plural: "Cruceros", icon: Ship },
  otro: { label: "Otro", plural: "Otros", icon: Coins },
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
export const FILE_STATUSES: Record<
  FileStatus,
  { label: string; chip: string; icon: LucideIcon }
> = {
  vendido: {
    label: "Vendido",
    chip: "bg-tone-sky-soft text-tone-sky-text border-tone-sky-line",
    icon: BadgeCheck,
  },
  pagado: {
    label: "Pagado",
    chip: "bg-tone-emerald-soft text-tone-emerald-text border-tone-emerald-line",
    icon: CircleDollarSign,
  },
  en_curso: {
    label: "En curso",
    chip: "bg-tone-violet-soft text-tone-violet-text border-tone-violet-line",
    icon: PlaneTakeoff,
  },
  finalizado: {
    label: "Finalizado",
    chip: "bg-tone-stone-soft text-tone-stone-text border-tone-stone-line",
    icon: Flag,
  },
  cancelado: {
    label: "Cancelado",
    chip: "bg-tone-red-soft text-tone-red-text border-tone-red-line",
    icon: XCircle,
  },
};

export const QUOTE_STATUSES: Record<
  QuoteStatus,
  { label: string; chip: string; icon: LucideIcon }
> = {
  borrador: {
    label: "Borrador",
    chip: "bg-tone-stone-soft text-tone-stone-text border-tone-stone-line",
    icon: PencilLine,
  },
  enviado: {
    label: "Enviado",
    chip: "bg-tone-sky-soft text-tone-sky-text border-tone-sky-line",
    icon: Send,
  },
  aceptado: {
    label: "Aceptado",
    chip: "bg-tone-emerald-soft text-tone-emerald-text border-tone-emerald-line",
    icon: CheckCircle2,
  },
  rechazado: {
    label: "Rechazado",
    chip: "bg-tone-red-soft text-tone-red-text border-tone-red-line",
    icon: XCircle,
  },
  vencido: {
    label: "Vencido",
    chip: "bg-tone-amber-soft text-tone-amber-text border-tone-amber-line",
    icon: Clock,
  },
};

export const PAYMENT_METHODS: Record<
  PaymentMethod,
  { label: string; icon: LucideIcon }
> = {
  efectivo: { label: "Efectivo", icon: Banknote },
  transferencia: { label: "Transferencia", icon: Landmark },
  tarjeta: { label: "Tarjeta", icon: CreditCard },
  mercado_pago: { label: "Mercado Pago", icon: Smartphone },
  deposito: { label: "Depósito", icon: PiggyBank },
  otro: { label: "Otro", icon: Coins },
};

/* ───────────────────────────────────────────
   Direcciones de movimiento de caja
   (entra plata / sale plata; chips con tokens tone-*)
   ─────────────────────────────────────────── */
export const PAYMENT_DIRECTIONS: Record<
  PaymentDirection,
  { label: string; short: string; icon: LucideIcon; circle: string; sign: "+" | "−" }
> = {
  cobro: {
    label: "Cobro",
    short: "Cobro",
    icon: ArrowDownToLine,
    circle: "bg-money-tint text-money-text",
    sign: "+",
  },
  pago_proveedor: {
    label: "Pago a proveedor",
    short: "Proveedor",
    icon: ArrowUpFromLine,
    circle: "bg-tone-orange-soft text-tone-orange-text",
    sign: "−",
  },
  pago_comision: {
    label: "Pago de comisión",
    short: "Comisión",
    icon: HandCoins,
    circle: "bg-tone-violet-soft text-tone-violet-text",
    sign: "−",
  },
  reembolso: {
    label: "Reembolso",
    short: "Reembolso",
    icon: RotateCcw,
    circle: "bg-tone-stone-soft text-tone-stone-text",
    sign: "−",
  },
};

/* ───────────────────────────────────────────
   Esquema de comisión del vendedor sobre una venta.
   · utilidad_pct → % sobre la utilidad del file (lo de siempre)
   · monto_fijo   → monto plano por venta (enlatados: "Grupal Europa, USD 100")
   ─────────────────────────────────────────── */
export type CommissionType = "utilidad_pct" | "monto_fijo";

export const COMMISSION_TYPES: Record<
  CommissionType,
  { label: string; short: string; icon: LucideIcon; hint: string }
> = {
  utilidad_pct: {
    label: "% de la utilidad",
    short: "Porcentaje",
    icon: Percent,
    hint: "Se calcula sobre la utilidad del file",
  },
  monto_fijo: {
    label: "Monto fijo",
    short: "Fija",
    icon: Coins,
    hint: "Un monto plano por venta, sin importar la utilidad",
  },
};

/** Comisión del vendedor por una venta, según el esquema del file. */
export function fileCommission(input: {
  commission_type: string | null;
  commission_pct: number;
  commission_amount: number;
  utility: number;
}): number {
  if (input.commission_type === "monto_fijo") return round2(input.commission_amount || 0);
  return round2(((input.utility || 0) * (input.commission_pct || 0)) / 100);
}

export const ACTIVITY_TYPES: Record<ActivityType, { label: string; icon: LucideIcon }> = {
  nota: { label: "Nota", icon: StickyNote },
  llamada: { label: "Llamada", icon: Phone },
  whatsapp: { label: "WhatsApp", icon: MessageCircle },
  email: { label: "Email", icon: Mail },
  etapa: { label: "Cambio de etapa", icon: ArrowRightLeft },
  presupuesto: { label: "Presupuesto", icon: ReceiptText },
  sistema: { label: "Sistema", icon: Cog },
};

/* ───────────────────────────────────────────
   Colores de etiquetas (tags.color → clases)
   Tokens tone-*: flipean solos en modo oscuro.
   ─────────────────────────────────────────── */
export const TAG_COLORS: Record<string, string> = {
  gray: "bg-tone-stone-soft text-tone-stone-text border-tone-stone-line",
  red: "bg-tone-red-soft text-tone-red-text border-tone-red-line",
  orange: "bg-tone-orange-soft text-tone-orange-text border-tone-orange-line",
  amber: "bg-tone-amber-soft text-tone-amber-text border-tone-amber-line",
  yellow: "bg-tone-yellow-soft text-tone-yellow-text border-tone-yellow-line",
  green: "bg-tone-green-soft text-tone-green-text border-tone-green-line",
  emerald: "bg-tone-emerald-soft text-tone-emerald-text border-tone-emerald-line",
  teal: "bg-tone-teal-soft text-tone-teal-text border-tone-teal-line",
  cyan: "bg-tone-cyan-soft text-tone-cyan-text border-tone-cyan-line",
  sky: "bg-tone-sky-soft text-tone-sky-text border-tone-sky-line",
  blue: "bg-tone-blue-soft text-tone-blue-text border-tone-blue-line",
  indigo: "bg-tone-indigo-soft text-tone-indigo-text border-tone-indigo-line",
  violet: "bg-tone-violet-soft text-tone-violet-text border-tone-violet-line",
  fuchsia: "bg-tone-fuchsia-soft text-tone-fuchsia-text border-tone-fuchsia-line",
  pink: "bg-tone-pink-soft text-tone-pink-text border-tone-pink-line",
  rose: "bg-tone-rose-soft text-tone-rose-text border-tone-rose-line",
};

/** Punto de color vivo por etiqueta (swatches de pickers; legible en ambos temas). */
export const TAG_DOTS: Record<string, string> = {
  gray: "bg-stone-400",
  red: "bg-red-500",
  orange: "bg-orange-500",
  amber: "bg-amber-500",
  yellow: "bg-yellow-400",
  green: "bg-green-500",
  emerald: "bg-emerald-500",
  teal: "bg-teal-500",
  cyan: "bg-cyan-500",
  sky: "bg-sky-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  fuchsia: "bg-fuchsia-500",
  pink: "bg-pink-500",
  rose: "bg-rose-500",
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
   Pasajeros del presupuesto.
   El infante paga el 30% del precio por persona (70% menos).
   Los menores pagan como un adulto: la edad se pide para la reserva.
   ─────────────────────────────────────────── */
export const INFANT_FACTOR = 0.3;

export type QuotePax = {
  adults: number;
  children: number;
  infants: number;
  /** edades de los menores, en orden de carga */
  childrenAges: number[];
};

export const EMPTY_PAX: QuotePax = { adults: 2, children: 0, infants: 0, childrenAges: [] };

export const PAX_KINDS = [
  {
    key: "adults" as const,
    label: "Adultos",
    singular: "adulto",
    icon: User2,
    hint: null as string | null,
  },
  {
    key: "children" as const,
    label: "Menores",
    singular: "menor",
    icon: Users2,
    hint: "Pedimos la edad de cada uno",
  },
  {
    key: "infants" as const,
    label: "Infantes",
    singular: "infante",
    icon: Baby,
    hint: "Paga el 30% (70% menos)",
  },
];

/** Cantidad real de personas que viajan. */
export function paxCount(p: QuotePax): number {
  return Math.max(0, p.adults) + Math.max(0, p.children) + Math.max(0, p.infants);
}

/** "Unidades de precio": el infante cuenta 0,3. Nunca menos de 1. */
export function paxUnits(p: QuotePax): number {
  const units =
    Math.max(0, p.adults) + Math.max(0, p.children) + Math.max(0, p.infants) * INFANT_FACTOR;
  return units > 0 ? round2(units) : 1;
}

/** "2 adultos · 1 menor (8) · 1 infante" */
export function paxLabel(p: QuotePax, withAges = true): string {
  const parts: string[] = [];
  if (p.adults > 0) parts.push(`${p.adults} ${p.adults === 1 ? "adulto" : "adultos"}`);
  if (p.children > 0) {
    const ages = withAges && p.childrenAges.length > 0 ? ` (${p.childrenAges.join(", ")})` : "";
    parts.push(`${p.children} ${p.children === 1 ? "menor" : "menores"}${ages}`);
  }
  if (p.infants > 0) parts.push(`${p.infants} ${p.infants === 1 ? "infante" : "infantes"}`);
  return parts.join(" · ") || "1 pasajero";
}

/* ───────────────────────────────────────────
   Fees automáticos del cotizador: se carga el BRUTO
   y el FINAL sale solo (aéreos +2%, terrestres +4% por defecto).
   ─────────────────────────────────────────── */
export type QuoteFees = { aereo_pct: number; terrestre_pct: number };

export const DEFAULT_QUOTE_FEES: QuoteFees = { aereo_pct: 2, terrestre_pct: 4 };

/** % que se le suma al bruto según el grupo del servicio. */
export function feePct(type: ServiceType, fees: QuoteFees = DEFAULT_QUOTE_FEES): number {
  return type === "aereo" ? (fees.aereo_pct ?? 0) : (fees.terrestre_pct ?? 0);
}

/** Final (lo que se paga) a partir del bruto comisionable. */
export function finalFromGross(
  gross: number,
  type: ServiceType,
  fees: QuoteFees = DEFAULT_QUOTE_FEES,
): number {
  return round2((gross || 0) * (1 + feePct(type, fees) / 100));
}

/** % del markup que se lleva el vendedor (estimado que ve en el presupuesto). */
export const DEFAULT_SELLER_MARKUP_PCT = 30;

/* ───────────────────────────────────────────
   Matemática del cotizador — ÚNICA fuente de verdad.
   Replica la planilla "Cotizador Paquetes":
   · gross (Bruto) = tarifa comisionable del mayorista (lo que se carga a mano)
   · cost (Final)  = lo que se paga al proveedor = bruto + fee del grupo
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
  pax: QuotePax;
};

export type QuoteTotals = {
  totalCost: number; // Total Paquete
  markupAmount: number; // Mkup en dólares
  markupPct: number; // % sobre el total
  discount: number;
  totalPrice: number; // Precio Cliente
  perPerson: number; // Por adulto (protagonista de la interfaz)
  perChild: number; // Por menor (hoy = adulto)
  perInfant: number; // Por infante (30%)
  paxCount: number;
  paxUnits: number;
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

  const units = paxUnits(input.pax);
  const perPerson = round2(totalPrice / units);

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
    perPerson,
    perChild: perPerson,
    perInfant: round2(perPerson * INFANT_FACTOR),
    paxCount: paxCount(input.pax),
    paxUnits: units,
    supplierCommission,
    commissionTotal: round2(supplierCommission + markupAmount - discount),
    byGroup: { aereos, terrestres: round2(totalCost - aereos) },
    commissionByGroup: {
      aereos: commissionAereos,
      terrestres: round2(supplierCommission - commissionAereos),
    },
  };
}

/* ───────────────────────────────────────────
   Opciones comparables dentro de un mismo presupuesto:
   "con este hotel vale 10, con este otro 15".
   Los ítems comunes (aéreo, traslados) entran en TODAS las opciones.
   ─────────────────────────────────────────── */
export type QuoteOptionInput = {
  key: string;
  name: string;
  subtitle?: string | null;
  isRecommended?: boolean;
  items: QuoteItemInput[];
};

export type QuoteOptionTotals = {
  key: string;
  name: string;
  subtitle: string | null;
  isRecommended: boolean;
  totals: QuoteTotals;
};

/** Totales de cada opción = ítems comunes + ítems propios de la opción. */
export function computeOptionTotals(
  common: QuoteItemInput[],
  options: QuoteOptionInput[],
  calc: Omit<QuoteCalcInput, "items">,
): QuoteOptionTotals[] {
  return options.map((o) => ({
    key: o.key,
    name: o.name,
    subtitle: o.subtitle ?? null,
    isRecommended: !!o.isRecommended,
    totals: computeQuoteTotals({ ...calc, items: [...common, ...o.items] }),
  }));
}

/** Comisión estimada del vendedor sobre el markup del presupuesto. */
export function sellerMarkupCommission(
  markupAmount: number,
  pct: number = DEFAULT_SELLER_MARKUP_PCT,
): number {
  return round2((markupAmount * (pct || 0)) / 100);
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
