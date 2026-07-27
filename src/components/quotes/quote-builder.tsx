"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeftRight,
  Bus,
  Check,
  ChevronDown,
  ChevronUp,
  Columns2,
  MapPin,
  Palette,
  Plane,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  StickyNote,
  Trash2,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  AnimatedNumber,
  ChoiceGrid,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Segmented,
  Tooltip,
} from "@/components/ui/misc";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
} from "@/components/ui/dropdown";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import {
  computeOptionTotals,
  computeQuoteTotals,
  DEFAULT_QUOTE_FEES,
  DEFAULT_SELLER_MARKUP_PCT,
  feePct,
  finalFromGross,
  INFANT_FACTOR,
  PAX_KINDS,
  paxCount,
  paxLabel,
  QUOTE_COLORS,
  QUOTE_FONTS,
  round2,
  sellerMarkupCommission,
  SERVICE_ORDER,
  SERVICE_TYPES,
  type QuoteFees,
  type QuoteOptionTotals,
  type QuotePax,
  type QuoteTotals,
} from "@/lib/domain";
import { fmtMoney, fmtNumber, fmtPhone, nightsBetween } from "@/lib/format";
import type { QuoteStatus, ServiceType } from "@/lib/types";
import {
  saveQuote,
  searchContacts,
  updateDefaultTheme,
  updateSavedNotes,
} from "@/lib/actions/quotes";
import { QuoteSheet, type QuoteSheetData } from "@/components/quotes/quote-sheet";
import { ShareDialog } from "@/components/quotes/share-dialog";

/* ───────────────────────── tipos de props ───────────────────────── */

export type BuilderContact = { id: string; full_name: string; phone: string | null };
export type BuilderSupplier = { id: string; name: string; default_commission_pct: number };

export type BuilderLead = {
  id: string;
  destination: string | null;
  trip_date_from: string | null;
  trip_date_to: string | null;
  pax_adults: number;
  pax_children: number;
  contact: BuilderContact;
};

export type BuilderInitialQuote = {
  id: string;
  code: string;
  public_token: string;
  status: QuoteStatus;
  lead_id: string | null;
  contact_id: string | null;
  destination: string;
  title: string | null;
  trip_date_from: string | null;
  trip_date_to: string | null;
  pax_adults: number;
  pax_children: number;
  pax_infants: number;
  children_ages: number[];
  currency: string;
  valid_until: string | null;
  markup_type: string;
  markup_value: number;
  discount: number;
  notes: string | null;
  internal_notes: string | null;
  theme: { color?: string; font?: string };
  options: {
    id: string;
    name: string;
    subtitle: string | null;
    is_recommended: boolean;
    position: number;
  }[];
  items: {
    type: ServiceType;
    description: string;
    supplier_id: string | null;
    option_id: string | null;
    cost: number;
    gross: number | null;
    commission_pct: number;
    position: number;
  }[];
};

/** Resultado que recibe el caller de variant="dialog" al guardar. */
export type QuoteSavedResult = {
  quoteId: string;
  code: string;
  publicToken: string;
  totalPrice: number;
  currency: string;
  destination: string;
  sent: boolean;
};

type ItemRow = {
  key: string;
  type: ServiceType;
  description: string;
  supplierId: string;
  /** Bruto: la tarifa comisionable, lo que se carga a mano */
  gross: string;
  /** Final: sale solo del bruto + fee, salvo que lo pisen a mano */
  cost: string;
  costManual: boolean;
  commissionPct: string;
  /** null = servicio común a todas las opciones */
  optionKey: string | null;
  /** filas agregadas por el usuario entran con slide-up */
  fresh: boolean;
};

type OptionRow = {
  key: string;
  name: string;
  subtitle: string;
  recommended: boolean;
};

/* ───────────────────────── helpers ───────────────────────── */

let rowSeq = 0;
function newRow(type: ServiceType, optionKey: string | null, fresh = false): ItemRow {
  return {
    key: `row-${++rowSeq}-${Date.now()}`,
    type,
    description: "",
    supplierId: "",
    gross: "",
    cost: "",
    costManual: false,
    commissionPct: "",
    optionKey,
    fresh,
  };
}

function parseNum(s: string): number {
  const n = parseFloat(String(s).replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  // fecha local (no UTC): cerca de medianoche AR no corre un día
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const TERRESTRE_TYPES = SERVICE_ORDER.filter((t) => t !== "aereo");

const TERRESTRE_OPTIONS = TERRESTRE_TYPES.map((t) => ({
  value: t,
  label: SERVICE_TYPES[t].label,
  icon: SERVICE_TYPES[t].icon,
}));

/** placeholders por tipo: el ejemplo enseña el formato sin manual */
const ROW_PLACEHOLDERS: Record<ServiceType, string> = {
  aereo: "Ej: AEP → CUN por Copa, con valija",
  hotel: "Ej: Hotel Riu 5★ all inclusive",
  paquete: "Ej: 7 noches con desayuno + traslados",
  excursion: "Ej: Chichén Itzá día completo",
  traslado: "Ej: Aeropuerto ↔ hotel, privado",
  asistencia: "Ej: Asistencia 30 días con cobertura COVID",
  circuito: "Ej: Europa clásica, 12 días",
  crucero: "Ej: Caribe 7 noches, cabina con balcón",
  otro: "Ej: Visado, seguro, upgrade…",
};

const OPTION_LETTERS = ["A", "B", "C", "D"];

/* grillas tipo planilla (container queries del card de ítems).
   Clases estáticas: Tailwind necesita verlas escritas tal cual. */
const GRIDS = {
  "type-com": "@2xl:grid-cols-[118px_minmax(0,1fr)_132px_92px_92px_56px_28px]",
  "type-nocom": "@2xl:grid-cols-[118px_minmax(0,1fr)_132px_92px_92px_28px]",
  "notype-com": "@2xl:grid-cols-[minmax(0,1fr)_132px_92px_92px_56px_28px]",
  "notype-nocom": "@2xl:grid-cols-[minmax(0,1fr)_132px_92px_92px_28px]",
} as const;

function gridFor(withType: boolean, withCommission: boolean): string {
  return GRIDS[`${withType ? "type" : "notype"}-${withCommission ? "com" : "nocom"}`];
}

/* ───────────────────────── componente ───────────────────────── */

export function QuoteBuilder({
  initial,
  lead,
  contacts,
  suppliers,
  savedNotes: savedNotesInitial,
  defaultTheme,
  agency,
  sellerName,
  isAdmin,
  fees = DEFAULT_QUOTE_FEES,
  sellerCommissionPct = DEFAULT_SELLER_MARKUP_PCT,
  variant = "page",
  onSaved,
}: {
  initial: BuilderInitialQuote | null;
  lead: BuilderLead | null;
  contacts: BuilderContact[];
  suppliers: BuilderSupplier[];
  savedNotes: string[];
  defaultTheme: { color: string; font: string };
  agency: { name: string; logoUrl: string | null; phone: string | null };
  sellerName: string;
  /** la comisión solo la ve el administrador; el vendedor ve un estimado */
  isAdmin: boolean;
  /** fees que se le suman al bruto para llegar al final */
  fees?: QuoteFees;
  /** % del markup que se lleva el vendedor */
  sellerCommissionPct?: number;
  /** "dialog": compacto, dentro de un popup — al guardar NO navega, llama onSaved */
  variant?: "page" | "dialog";
  onSaved?: (r: QuoteSavedResult) => void;
}) {
  const router = useRouter();
  const isDialog = variant === "dialog";
  const sectionCard = isDialog ? "card p-3.5 sm:p-4" : "card p-4 sm:p-5";

  const initialContact =
    lead?.contact ??
    (initial?.contact_id ? contacts.find((c) => c.id === initial.contact_id) ?? null : null);

  /* contacto */
  const [contactMode, setContactMode] = React.useState<"cliente" | "prospecto">("cliente");
  const [contact, setContact] = React.useState<BuilderContact | null>(initialContact);
  const [prospectName, setProspectName] = React.useState("");
  const [contactSearch, setContactSearch] = React.useState("");

  /* datos del viaje */
  const [destination, setDestination] = React.useState(
    initial?.destination ?? lead?.destination ?? "",
  );
  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [dateFrom, setDateFrom] = React.useState(
    initial?.trip_date_from ?? lead?.trip_date_from ?? "",
  );
  const [dateTo, setDateTo] = React.useState(initial?.trip_date_to ?? lead?.trip_date_to ?? "");
  const [currency, setCurrency] = React.useState<"USD" | "ARS">(
    initial?.currency === "ARS" ? "ARS" : "USD",
  );
  const [validUntil, setValidUntil] = React.useState(initial?.valid_until ?? isoPlusDays(15));

  /* pasajeros: adultos / menores (con edad) / infantes */
  const [pax, setPax] = React.useState<QuotePax>(() => {
    if (initial) {
      return {
        adults: initial.pax_adults,
        children: initial.pax_children,
        infants: initial.pax_infants,
        childrenAges: initial.children_ages ?? [],
      };
    }
    if (lead) {
      return {
        adults: Math.max(1, lead.pax_adults),
        children: lead.pax_children,
        infants: 0,
        childrenAges: Array.from({ length: lead.pax_children }, () => 0),
      };
    }
    return { adults: 2, children: 0, infants: 0, childrenAges: [] };
  });

  /* opciones comparables (2 hoteles en un mismo presupuesto) */
  const [options, setOptions] = React.useState<OptionRow[]>(() =>
    (initial?.options ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((o) => ({
        key: o.id,
        name: o.name,
        subtitle: o.subtitle ?? "",
        recommended: o.is_recommended,
      })),
  );
  const [activeOption, setActiveOption] = React.useState<string | null>(
    initial?.options?.[0]?.id ?? null,
  );

  /* ítems */
  const [rows, setRows] = React.useState<ItemRow[]>(() => {
    if (initial && initial.items.length > 0) {
      return [...initial.items]
        .sort((a, b) => a.position - b.position)
        .map((i) => {
          const gross = i.gross != null ? i.gross : i.cost;
          const auto = finalFromGross(gross, i.type, fees);
          return {
            key: `row-${++rowSeq}`,
            type: i.type,
            description: i.description,
            supplierId: i.supplier_id ?? "",
            gross: gross ? String(gross) : "",
            cost: i.cost ? String(i.cost) : "",
            costManual: Math.abs((i.cost || 0) - auto) > 0.01,
            commissionPct: i.commission_pct ? String(i.commission_pct) : "",
            optionKey: i.option_id,
            fresh: false,
          };
        });
    }
    return [newRow("aereo", null), newRow("hotel", null)];
  });
  const [removingKeys, setRemovingKeys] = React.useState<ReadonlySet<string>>(new Set());
  const pendingFocusRef = React.useRef<string | null>(null);

  /* markup, descuento, notas */
  const [markupType, setMarkupType] = React.useState<"monto" | "porcentaje">(
    initial?.markup_type === "porcentaje" ? "porcentaje" : "monto",
  );
  const [markupValue, setMarkupValue] = React.useState(
    initial && initial.markup_value ? String(initial.markup_value) : "",
  );
  const [discount, setDiscount] = React.useState(
    initial && initial.discount ? String(initial.discount) : "",
  );
  const [notes, setNotes] = React.useState(initial?.notes ?? "");
  const [internalNotes, setInternalNotes] = React.useState(initial?.internal_notes ?? "");
  const [savedNotes, setSavedNotes] = React.useState(savedNotesInitial);

  /* tema — vive con ESTE presupuesto; el default de la agencia se guarda aparte */
  const [theme, setTheme] = React.useState<{ color: string; font: string }>({
    color: initial?.theme?.color ?? defaultTheme.color,
    font: initial?.theme?.font ?? defaultTheme.font,
  });
  const [agencyTheme, setAgencyTheme] = React.useState(defaultTheme);
  const [savingThemeDefault, setSavingThemeDefault] = React.useState(false);
  const isAgencyTheme = theme.color === agencyTheme.color && theme.font === agencyTheme.font;

  /* ui */
  const [mobileTab, setMobileTab] = React.useState<"editor" | "preview">("editor");
  const [summaryOpen, setSummaryOpen] = React.useState(false);
  const [saving, setSaving] = React.useState<"borrador" | "enviar" | null>(null);
  const [share, setShare] = React.useState<{ token: string; code: string; id: string } | null>(
    null,
  );
  const [shareOpen, setShareOpen] = React.useState(false);

  /* ── cálculo en vivo (única fuente: computeQuoteTotals) ── */
  const toInput = React.useCallback(
    (r: ItemRow) => {
      const gross = parseNum(r.gross);
      const cost = r.costManual ? parseNum(r.cost) : finalFromGross(gross, r.type, fees);
      return {
        type: r.type,
        cost,
        gross: gross || cost,
        commission_pct: parseNum(r.commissionPct),
      };
    },
    [fees],
  );

  const commonRows = rows.filter((r) => r.optionKey === null);
  const hasOptions = options.length > 0;

  const calcBase = React.useMemo(
    () => ({
      markup_type: markupType,
      markup_value: parseNum(markupValue),
      discount: parseNum(discount),
      pax,
    }),
    [markupType, markupValue, discount, pax],
  );

  const totals = React.useMemo<QuoteTotals>(
    () =>
      computeQuoteTotals({
        ...calcBase,
        items: rows.filter((r) => r.optionKey === null).map(toInput),
      }),
    [rows, calcBase, toInput],
  );

  const optionTotals = React.useMemo<QuoteOptionTotals[]>(() => {
    if (!hasOptions) return [];
    return computeOptionTotals(
      rows.filter((r) => r.optionKey === null).map(toInput),
      options.map((o) => ({
        key: o.key,
        name: o.name.trim() || "Opción",
        subtitle: o.subtitle.trim() || null,
        isRecommended: o.recommended,
        items: rows.filter((r) => r.optionKey === o.key).map(toInput),
      })),
      calcBase,
    );
  }, [hasOptions, rows, options, calcBase, toInput]);

  /** la opción que manda en los totales guardados y en la barra resumen */
  const principal = React.useMemo(
    () => optionTotals.find((o) => o.isRecommended) ?? optionTotals[0] ?? null,
    [optionTotals],
  );
  const headline = principal?.totals ?? totals;

  const nights = nightsBetween(dateFrom || null, dateTo || null);
  const totalPax = paxCount(pax);

  const previewData: QuoteSheetData = {
    code: initial?.code ?? "P-····",
    title: title.trim() || null,
    destination: destination.trim() || "Tu próximo destino",
    currency,
    pax,
    nights,
    tripDateFrom: dateFrom || null,
    tripDateTo: dateTo || null,
    validUntil: validUntil || null,
    totalPrice: headline.totalPrice,
    perPerson: headline.perPerson,
    perInfant: headline.perInfant,
    discount: headline.discount,
    notes: notes.trim() || null,
    createdAt: null,
    contactName:
      contactMode === "prospecto" ? prospectName.trim() || null : contact?.full_name ?? null,
    contactPhone: contactMode === "prospecto" ? null : contact?.phone ?? null,
    agencyName: agency.name,
    agencyLogoUrl: agency.logoUrl,
    agencyPhone: agency.phone,
    sellerName,
    items: commonRows
      .filter((r) => r.description.trim())
      .map((r) => ({ type: r.type, description: r.description.trim() })),
    options: optionTotals.map((o) => ({
      name: o.name,
      subtitle: o.subtitle,
      isRecommended: o.isRecommended,
      totalPrice: o.totals.totalPrice,
      perPerson: o.totals.perPerson,
      perInfant: o.totals.perInfant,
      items: rows
        .filter((r) => r.optionKey === o.key && r.description.trim())
        .map((r) => ({ type: r.type, description: r.description.trim() })),
    })),
    theme,
  };

  /* ── contactos: filtro local instantáneo + búsqueda server-side con debounce ── */
  const localMatches = React.useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return [];
    return contacts.filter(
      (c) =>
        c.full_name.toLowerCase().includes(q) ||
        (c.phone ?? "").includes(q.replace(/\D/g, "") || "~"),
    );
  }, [contactSearch, contacts]);

  const [serverMatches, setServerMatches] = React.useState<BuilderContact[] | null>(null);
  React.useEffect(() => {
    const q = contactSearch.trim();
    setServerMatches(null);
    if (!q) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await searchContacts({ q });
      if (!cancelled && res.ok) setServerMatches(res.data);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [contactSearch]);

  // los resultados del server SUMAN a los locales (sin salto visual del dropdown)
  const filteredContacts = React.useMemo(() => {
    const seen = new Set(localMatches.map((c) => c.id));
    return [...localMatches, ...(serverMatches ?? []).filter((c) => !seen.has(c.id))].slice(0, 6);
  }, [localMatches, serverMatches]);

  /* ── pasajeros ── */
  function changePax(kind: "adults" | "children" | "infants", delta: number) {
    setPax((p) => {
      const next = { ...p, childrenAges: [...p.childrenAges] };
      const min = kind === "adults" ? 1 : 0;
      next[kind] = Math.max(min, Math.min(30, p[kind] + delta));
      if (kind === "children") {
        if (next.children > p.children) next.childrenAges.push(0);
        else next.childrenAges = next.childrenAges.slice(0, next.children);
      }
      return next;
    });
  }
  function changeChildAge(index: number, value: string) {
    const n = Math.max(0, Math.min(17, Math.round(parseNum(value))));
    setPax((p) => {
      const ages = [...p.childrenAges];
      ages[index] = n;
      return { ...p, childrenAges: ages };
    });
  }

  /* ── mutadores de filas ── */
  function updateRow(key: string, patch: Partial<ItemRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  /** eliminar con fade-out: primero anima, después saca la fila */
  function removeRow(key: string) {
    if (removingKeys.has(key)) return;
    setRemovingKeys((prev) => new Set(prev).add(key));
    window.setTimeout(() => {
      setRows((rs) => rs.filter((r) => r.key !== key));
      setRemovingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, 160);
  }
  /** agregar con slide-up + autofocus en la descripción */
  function addRow(type: ServiceType, optionKey: string | null) {
    const row = newRow(type, optionKey, true);
    pendingFocusRef.current = row.key;
    setRows((rs) => [...rs, row]);
  }
  function addTerrestre(optionKey: string | null) {
    // default inteligente: repite el tipo del último servicio terrestre cargado
    const last = [...rows].reverse().find((r) => r.type !== "aereo" && r.optionKey === optionKey);
    addRow(last?.type ?? "hotel", optionKey);
  }
  function pickSupplier(row: ItemRow, supplierId: string) {
    const sup = suppliers.find((s) => s.id === supplierId);
    updateRow(row.key, {
      supplierId,
      // la comisión sale sola del mayorista (aéreos incluidos)
      commissionPct: sup ? String(sup.default_commission_pct) : row.commissionPct,
    });
  }
  const focusDescription = (row: ItemRow) => (el: HTMLInputElement | null) => {
    if (el && pendingFocusRef.current === row.key) {
      pendingFocusRef.current = null;
      el.focus();
    }
  };

  /* ── opciones ── */
  function startComparing() {
    const a: OptionRow = { key: `opt-a-${Date.now()}`, name: "", subtitle: "", recommended: true };
    const b: OptionRow = { key: `opt-b-${Date.now()}`, name: "", subtitle: "", recommended: false };
    setOptions([a, b]);
    setActiveOption(a.key);
  }
  function addOption() {
    if (options.length >= 4) return;
    const o: OptionRow = {
      key: `opt-${options.length}-${Date.now()}`,
      name: "",
      subtitle: "",
      recommended: false,
    };
    setOptions((os) => [...os, o]);
    setActiveOption(o.key);
  }
  function updateOption(key: string, patch: Partial<OptionRow>) {
    setOptions((os) =>
      os.map((o) =>
        o.key === key
          ? { ...o, ...patch }
          : patch.recommended
            ? { ...o, recommended: false }
            : o,
      ),
    );
  }
  function removeOption(key: string) {
    const rest = options.filter((o) => o.key !== key);

    if (rest.length <= 1) {
      // con una sola opción no hay nada que comparar: sus servicios vuelven a ser comunes
      const survivor = rest[0]?.key ?? null;
      setRows((rs) =>
        rs
          .filter((r) => r.optionKey !== key)
          .map((r) => (r.optionKey === survivor ? { ...r, optionKey: null } : r)),
      );
      setOptions([]);
      setActiveOption(null);
      return;
    }

    const next = rest.some((o) => o.recommended)
      ? rest
      : rest.map((o, i) => (i === 0 ? { ...o, recommended: true } : o));
    setRows((rs) => rs.filter((r) => r.optionKey !== key));
    setOptions(next);
    setActiveOption(next[0].key);
  }

  /* ── tema ── */
  function changeTheme(patch: Partial<{ color: string; font: string }>) {
    setTheme((prev) => ({ ...prev, ...patch }));
  }
  async function makeThemeDefault() {
    setSavingThemeDefault(true);
    const res = await updateDefaultTheme(theme);
    setSavingThemeDefault(false);
    if (res.ok) {
      setAgencyTheme(theme);
      toast.success("Listo: es el estilo predeterminado de la agencia");
    } else {
      toast.error(res.error);
    }
  }

  /* ── notas guardadas ── */
  function appendSavedNote(note: string) {
    setNotes((n) => (n.trim() ? `${n.trimEnd()}\n${note}` : note));
  }
  async function persistCurrentNote() {
    const note = notes.trim();
    if (!note) {
      toast.error("Escribí la nota antes de guardarla.");
      return;
    }
    if (savedNotes.includes(note)) {
      toast.success("Esa nota ya está guardada.");
      return;
    }
    const next = [...savedNotes, note];
    setSavedNotes(next); // optimista
    const res = await updateSavedNotes({ notes: next });
    if (!res.ok) {
      setSavedNotes(savedNotes);
      toast.error(res.error);
    } else {
      toast.success("Nota guardada para próximos presupuestos");
    }
  }

  /* ── guardar ── */
  async function handleSave(send: boolean) {
    if (!destination.trim()) {
      toast.error("Contanos el destino del viaje.");
      return;
    }
    const cleanRows = rows.filter((r) => r.description.trim() || parseNum(r.gross) > 0);
    if (cleanRows.length === 0) {
      toast.error("Agregá al menos un servicio al presupuesto.");
      return;
    }
    if (cleanRows.some((r) => !r.description.trim())) {
      toast.error("Completá la descripción de todos los servicios.");
      return;
    }
    if (hasOptions) {
      const empty = options.find((o) => !cleanRows.some((r) => r.optionKey === o.key));
      if (empty) {
        toast.error("Cada opción necesita al menos un servicio propio.");
        setActiveOption(empty.key);
        return;
      }
    }

    setSaving(send ? "enviar" : "borrador");
    const res = await saveQuote({
      id: initial?.id ?? null,
      leadId: lead?.id ?? initial?.lead_id ?? null,
      contactId: contactMode === "cliente" ? contact?.id ?? null : null,
      prospectName: contactMode === "prospecto" ? prospectName.trim() || null : null,
      destination: destination.trim(),
      title: title.trim() || null,
      tripDateFrom: dateFrom || null,
      tripDateTo: dateTo || null,
      paxAdults: pax.adults,
      paxChildren: pax.children,
      paxInfants: pax.infants,
      childrenAges: pax.childrenAges.slice(0, pax.children),
      currency,
      validUntil: validUntil || null,
      markupType,
      markupValue: parseNum(markupValue),
      discount: parseNum(discount),
      notes: notes.trim() || null,
      internalNotes: internalNotes.trim() || null,
      theme,
      options: options.map((o, idx) => ({
        key: o.key,
        name: o.name.trim() || `Opción ${OPTION_LETTERS[idx] ?? idx + 1}`,
        subtitle: o.subtitle.trim() || null,
        isRecommended: o.recommended,
      })),
      items: cleanRows.map((r) => {
        const input = toInput(r);
        return {
          type: r.type,
          description: r.description.trim(),
          supplierId: r.supplierId || null,
          optionKey: r.optionKey,
          cost: input.cost,
          gross: input.gross,
          commissionPct: input.commission_pct,
        };
      }),
      send,
    });
    setSaving(null);

    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if (isDialog) {
      // en el popup no navegamos: el caller decide qué hacer con el resultado
      onSaved?.({
        quoteId: res.data.quoteId,
        code: res.data.code,
        publicToken: res.data.publicToken,
        totalPrice: headline.totalPrice,
        currency,
        destination: destination.trim(),
        sent: send,
      });
      return;
    }
    if (send) {
      toast.success(`¡Presupuesto ${res.data.code} listo para compartir!`);
      setShare({ token: res.data.publicToken, code: res.data.code, id: res.data.quoteId });
      setShareOpen(true);
    } else {
      toast.success("Borrador guardado");
      router.push(`/presupuestos/${res.data.quoteId}`);
    }
  }

  const aereos = commonRows.filter((r) => r.type === "aereo");
  const terrestres = commonRows.filter((r) => r.type !== "aereo");

  /** servicios comunes que tiene sentido llevar a una opción (todo menos el aéreo) */
  const movableRows = commonRows.filter(
    (r) => r.type !== "aereo" && (r.description.trim() || parseNum(r.gross) > 0),
  );

  const moveTargets = hasOptions
    ? [
        { key: null as string | null, label: "Común a todas" },
        ...options.map((o, idx) => ({
          key: o.key as string | null,
          label: o.name.trim() || `Opción ${OPTION_LETTERS[idx] ?? idx + 1}`,
        })),
      ]
    : [];

  /* controles de markup/descuento — viven dentro del panel de totales */
  const markupSlot = (
    <div className="mt-3 space-y-2.5 rounded-xl bg-sand-soft/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-ink-soft">Markup</span>
        <div className="flex items-center gap-1.5">
          <Segmented
            value={markupType}
            onChange={setMarkupType}
            options={[
              { value: "monto", label: currency },
              { value: "porcentaje", label: "%" },
            ]}
          />
          <Input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={markupValue}
            onChange={(e) => setMarkupValue(e.target.value)}
            placeholder="0"
            aria-label="Markup"
            className="h-8 w-20 rounded-lg px-2 text-right text-[13px] tabular-nums"
          />
        </div>
      </div>
      {markupType === "porcentaje" && parseNum(markupValue) > 0 && (
        <p className="text-right text-[11px] tabular-nums text-ink-faint">
          = {fmtMoney(headline.markupAmount, currency)}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-ink-soft">Descuento</span>
        <Input
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          placeholder="0"
          aria-label="Descuento"
          className="h-8 w-20 rounded-lg px-2 text-right text-[13px] tabular-nums"
        />
      </div>
    </div>
  );

  const totalsPanel = (
    <TotalsPanel
      totals={totals}
      options={optionTotals}
      currency={currency}
      pax={pax}
      isAdmin={isAdmin}
      sellerCommissionPct={sellerCommissionPct}
      markupSlot={markupSlot}
    />
  );

  /* ═══════════════════════ render ═══════════════════════ */

  return (
    <div className={isDialog ? undefined : "px-4 md:px-6"}>
      {/* tabs mobile: cotizador / vista previa */}
      <div className={cn("mb-4 flex justify-center", isDialog ? "lg:hidden" : "xl:hidden")}>
        <Segmented
          value={mobileTab}
          onChange={setMobileTab}
          options={[
            { value: "editor", label: "Cotizador" },
            { value: "preview", label: "Vista previa" },
          ]}
          className="w-full max-w-xs [&>button]:flex-1"
        />
      </div>

      <div
        className={cn(
          "grid items-start",
          isDialog
            ? "gap-5 lg:grid-cols-[minmax(0,1fr)_340px]"
            : "gap-6 xl:grid-cols-[minmax(0,1fr)_420px]",
        )}
      >
        {/* ─────────── columna editor ─────────── */}
        <div
          className={cn(
            "min-w-0 space-y-4 animate-slide-up",
            !isDialog && "pb-24 xl:pb-0",
            mobileTab === "preview" && (isDialog ? "hidden lg:block" : "hidden xl:block"),
          )}
        >
          {/* cliente */}
          <section className={sectionCard}>
            <SectionTitle icon={UserRound}>Cliente</SectionTitle>
            {lead ? (
              <ContactChip contact={contact} />
            ) : (
              <div className="space-y-3">
                <Segmented
                  value={contactMode}
                  onChange={(v) => setContactMode(v)}
                  options={[
                    { value: "cliente", label: "Cliente existente" },
                    { value: "prospecto", label: "Prospecto" },
                  ]}
                />
                {contactMode === "cliente" ? (
                  contact ? (
                    <ContactChip
                      contact={contact}
                      onClear={() => {
                        setContact(null);
                        setContactSearch("");
                      }}
                    />
                  ) : (
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
                      <Input
                        value={contactSearch}
                        onChange={(e) => setContactSearch(e.target.value)}
                        placeholder="Buscá por nombre o teléfono…"
                        className="pl-9"
                      />
                      {filteredContacts.length > 0 && (
                        <div className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-hidden rounded-2xl border border-line bg-paper shadow-lg shadow-ink/5 animate-scale-in">
                          {filteredContacts.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                setContact(c);
                                setContactSearch("");
                              }}
                              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-sand-soft"
                            >
                              <Avatar name={c.full_name} className="size-8 text-[11px]" />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-ink">
                                  {c.full_name}
                                </p>
                                <p className="text-xs text-ink-faint">{fmtPhone(c.phone)}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                ) : (
                  <div>
                    <Label htmlFor="prospect">Nombre del prospecto</Label>
                    <Input
                      id="prospect"
                      value={prospectName}
                      onChange={(e) => setProspectName(e.target.value)}
                      placeholder="Ej: Marina (consulta de Instagram)"
                    />
                    <p className="mt-1.5 text-xs text-ink-faint">
                      Se crea como contacto nuevo al guardar el presupuesto.
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* datos del viaje */}
          <section className={sectionCard}>
            <SectionTitle icon={MapPin}>Datos del viaje</SectionTitle>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="col-span-2">
                <Label htmlFor="dest">Destino *</Label>
                <Input
                  id="dest"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="Ej: Cancún, México"
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="title">Título (opcional)</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ej: Luna de miel en el Caribe"
                />
              </div>
              <div>
                <Label htmlFor="from">Desde</Label>
                <Input
                  id="from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="to">
                  Hasta{" "}
                  {nights ? (
                    <span className="font-normal text-ink-faint">
                      · {nights} {nights === 1 ? "noche" : "noches"}
                    </span>
                  ) : null}
                </Label>
                <Input
                  id="to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="valid">Válido hasta</Label>
                <Input
                  id="valid"
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </div>
              <div>
                <Label>Moneda</Label>
                <Segmented
                  value={currency}
                  onChange={setCurrency}
                  options={[
                    { value: "USD", label: "USD" },
                    { value: "ARS", label: "ARS" },
                  ]}
                />
              </div>
            </div>
          </section>

          {/* pasajeros */}
          <section className={sectionCard}>
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <SectionTitle icon={Users} className="mb-0">
                Pasajeros
              </SectionTitle>
              <p className="text-[13px] tabular-nums text-ink-faint">
                {totalPax} {totalPax === 1 ? "persona" : "personas"}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {PAX_KINDS.map((k) => (
                <PaxCounter
                  key={k.key}
                  icon={k.icon}
                  label={k.label}
                  hint={k.hint}
                  value={pax[k.key]}
                  min={k.key === "adults" ? 1 : 0}
                  onChange={(delta) => changePax(k.key, delta)}
                />
              ))}
            </div>

            {pax.children > 0 && (
              <div className="mt-3 rounded-xl bg-sand-soft/60 p-3 animate-slide-up">
                <p className="mb-2 text-[13px] font-medium text-ink-soft">
                  ¿Qué edad tienen los menores?
                </p>
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: pax.children }).map((_, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-xs text-ink-faint">#{i + 1}</span>
                      <div className="relative">
                        <Input
                          type="number"
                          min={0}
                          max={17}
                          inputMode="numeric"
                          value={pax.childrenAges[i] ? String(pax.childrenAges[i]) : ""}
                          onChange={(e) => changeChildAge(i, e.target.value)}
                          placeholder="—"
                          aria-label={`Edad del menor ${i + 1}`}
                          className="h-10 w-[74px] pr-9 text-right text-[13px] tabular-nums"
                        />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-faint">
                          años
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {pax.infants > 0 && (
              <p className="mt-2.5 text-xs text-ink-faint">
                El infante paga el {Math.round(INFANT_FACTOR * 100)}% del precio por persona.
              </p>
            )}
          </section>

          {/* ítems: aéreos */}
          <section className={cn(sectionCard, "@container")}>
            <ItemGroupHeader
              icon={Plane}
              label="Aéreos"
              subtotal={totals.byGroup.aereos}
              currency={currency}
            />
            <ItemHeaderRow withType={false} withCommission={isAdmin} fee={fees.aereo_pct} />
            <div className="space-y-2.5 @2xl:space-y-1.5">
              {aereos.length === 0 && (
                <p className="rounded-xl border border-dashed border-line-strong/70 px-3 py-3 text-center text-[13px] text-ink-faint">
                  Sin aéreos por ahora.
                </p>
              )}
              {aereos.map((row, idx) => (
                <ItemRowEditor
                  key={row.key}
                  row={row}
                  suppliers={suppliers}
                  currency={currency}
                  fees={fees}
                  withType={false}
                  withCommission={isAdmin}
                  removing={removingKeys.has(row.key)}
                  moveTargets={moveTargets}
                  onChange={(patch) => updateRow(row.key, patch)}
                  onPickSupplier={(id) => pickSupplier(row, id)}
                  onRemove={() => removeRow(row.key)}
                  onEnter={idx === aereos.length - 1 ? () => addRow("aereo", null) : undefined}
                  descRef={focusDescription(row)}
                />
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2.5 text-brand-700"
              onClick={() => addRow("aereo", null)}
            >
              <Plus /> Agregar aéreo
            </Button>
          </section>

          {/* ítems: terrestres */}
          <section className={cn(sectionCard, "@container")}>
            <ItemGroupHeader
              icon={Bus}
              label={hasOptions ? "Terrestres en común" : "Terrestres"}
              subtotal={totals.byGroup.terrestres}
              currency={currency}
            />
            {hasOptions && (
              <p className="-mt-1.5 mb-2.5 text-xs text-ink-faint">
                Lo que va en todas las opciones (traslados, excursiones, asistencia).
              </p>
            )}
            <ItemHeaderRow withType withCommission={isAdmin} fee={fees.terrestre_pct} />
            <div className="space-y-2.5 @2xl:space-y-1.5">
              {terrestres.length === 0 && (
                <p className="rounded-xl border border-dashed border-line-strong/70 px-3 py-3 text-center text-[13px] text-ink-faint">
                  Sin servicios terrestres por ahora.
                </p>
              )}
              {terrestres.map((row, idx) => (
                <ItemRowEditor
                  key={row.key}
                  row={row}
                  suppliers={suppliers}
                  currency={currency}
                  fees={fees}
                  withType
                  withCommission={isAdmin}
                  removing={removingKeys.has(row.key)}
                  moveTargets={moveTargets}
                  onChange={(patch) => updateRow(row.key, patch)}
                  onPickSupplier={(id) => pickSupplier(row, id)}
                  onRemove={() => removeRow(row.key)}
                  onEnter={
                    idx === terrestres.length - 1 ? () => addTerrestre(null) : undefined
                  }
                  descRef={focusDescription(row)}
                />
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2.5 text-brand-700"
              onClick={() => addTerrestre(null)}
            >
              <Plus /> Agregar servicio
            </Button>
          </section>

          {/* opciones comparables */}
          {!hasOptions ? (
            <button
              type="button"
              onClick={startComparing}
              className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-line-strong/70 bg-sand-soft/30 px-4 py-3.5 text-left transition-all tap-highlight-none hover:border-brand-500 hover:bg-brand-tint/40 active:scale-[0.99]"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-text">
                <Columns2 className="size-5" strokeWidth={1.9} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">Comparar dos opciones</span>
                <span className="block text-xs text-ink-faint">
                  Mismo presupuesto, dos hoteles: el cliente ve cuánto sale con cada uno.
                </span>
              </span>
              <Plus className="ml-auto size-4 shrink-0 text-ink-faint" />
            </button>
          ) : (
            <section className={cn(sectionCard, "@container")}>
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <SectionTitle icon={Columns2} className="mb-0">
                  Opciones
                </SectionTitle>
                {options.length < 4 && (
                  <Button variant="ghost" size="sm" className="text-brand-700" onClick={addOption}>
                    <Plus /> Otra opción
                  </Button>
                )}
              </div>

              {/* tabs con el precio de cada opción: la comparación en sí */}
              <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
                {options.map((o, idx) => {
                  const t = optionTotals.find((ot) => ot.key === o.key);
                  const active = activeOption === o.key;
                  return (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => setActiveOption(o.key)}
                      aria-pressed={active}
                      className={cn(
                        "min-w-[150px] flex-1 rounded-xl border px-3 py-2.5 text-left transition-all tap-highlight-none active:scale-[0.98]",
                        active
                          ? "border-brand-500 bg-brand-tint shadow-sm"
                          : "border-line bg-paper hover:border-line-strong",
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        {o.recommended && (
                          <Sparkles
                            className="size-3.5 shrink-0 text-brand-600"
                            strokeWidth={2}
                            aria-label="Recomendada"
                          />
                        )}
                        <span
                          className={cn(
                            "truncate text-[13px] font-medium",
                            active ? "text-brand-text" : "text-ink",
                          )}
                        >
                          {o.name.trim() || `Opción ${OPTION_LETTERS[idx] ?? idx + 1}`}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-base font-semibold leading-tight tabular-nums text-ink">
                        {fmtMoney(t?.totals.perPerson ?? 0, currency)}
                      </span>
                      <span className="block text-[11px] tabular-nums text-ink-faint">
                        por persona
                      </span>
                    </button>
                  );
                })}
              </div>

              {options.map((o, idx) => {
                if (o.key !== activeOption) return null;
                const optionRows = rows.filter((r) => r.optionKey === o.key);
                const t = optionTotals.find((ot) => ot.key === o.key);
                return (
                  <div key={o.key} className="animate-fade-in">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor={`opt-name-${o.key}`}>Nombre de la opción</Label>
                        <Input
                          id={`opt-name-${o.key}`}
                          value={o.name}
                          onChange={(e) => updateOption(o.key, { name: e.target.value })}
                          placeholder={`Ej: Hotel Riu 5★ (Opción ${OPTION_LETTERS[idx] ?? idx + 1})`}
                        />
                      </div>
                      <div>
                        <Label htmlFor={`opt-sub-${o.key}`}>Detalle (opcional)</Label>
                        <Input
                          id={`opt-sub-${o.key}`}
                          value={o.subtitle}
                          onChange={(e) => updateOption(o.key, { subtitle: e.target.value })}
                          placeholder="Ej: All inclusive, frente al mar"
                        />
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => updateOption(o.key, { recommended: true })}
                        aria-pressed={o.recommended}
                        className={cn(
                          "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-all tap-highlight-none active:scale-95",
                          o.recommended
                            ? "border-brand-tint-line bg-brand-tint text-brand-text"
                            : "border-line text-ink-faint hover:border-line-strong hover:text-ink-soft",
                        )}
                      >
                        <Sparkles className="size-3.5" strokeWidth={2} />
                        {o.recommended ? "Es la recomendada" : "Marcar como recomendada"}
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-tone-red-text hover:bg-tone-red-soft"
                        onClick={() => removeOption(o.key)}
                      >
                        <Trash2 /> Quitar opción
                      </Button>
                    </div>

                    <div className="mt-3.5">
                      <ItemHeaderRow withType withCommission={isAdmin} fee={fees.terrestre_pct} />
                      <div className="space-y-2.5 @2xl:space-y-1.5">
                        {optionRows.length === 0 && (
                          <div className="rounded-xl border border-dashed border-line-strong/70 px-3 py-3.5 text-center">
                            <p className="text-[13px] text-ink-faint">
                              Cargá el hotel (o lo que cambie) de esta opción.
                            </p>
                            {movableRows.length > 0 && (
                              <div className="mt-2.5">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                                  O traé uno ya cargado
                                </p>
                                <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
                                  {movableRows.map((r) => (
                                    <button
                                      key={r.key}
                                      type="button"
                                      onClick={() => updateRow(r.key, { optionKey: o.key })}
                                      className="max-w-full truncate rounded-full border border-line bg-paper px-3 py-1.5 text-xs text-ink-soft transition-all tap-highlight-none hover:border-brand-500 hover:text-brand-text active:scale-[0.97]"
                                    >
                                      {r.description.trim() || SERVICE_TYPES[r.type].label}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {optionRows.map((row, i) => (
                          <ItemRowEditor
                            key={row.key}
                            row={row}
                            suppliers={suppliers}
                            currency={currency}
                            fees={fees}
                            withType
                            withCommission={isAdmin}
                            removing={removingKeys.has(row.key)}
                            moveTargets={moveTargets}
                            onChange={(patch) => updateRow(row.key, patch)}
                            onPickSupplier={(id) => pickSupplier(row, id)}
                            onRemove={() => removeRow(row.key)}
                            onEnter={
                              i === optionRows.length - 1 ? () => addTerrestre(o.key) : undefined
                            }
                            descRef={focusDescription(row)}
                          />
                        ))}
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-brand-700"
                          onClick={() => addTerrestre(o.key)}
                        >
                          <Plus /> Agregar a esta opción
                        </Button>
                        <p className="text-sm tabular-nums text-ink-soft">
                          Total{" "}
                          <span className="font-semibold text-ink">
                            {fmtMoney(t?.totals.totalPrice ?? 0, currency)}
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {/* notas */}
          <section className={sectionCard}>
            <SectionTitle icon={StickyNote}>Notas para el cliente</SectionTitle>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: Incluye equipaje de bodega. Precios sujetos a disponibilidad."
            />
            {savedNotes.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {savedNotes.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => appendSavedNote(n)}
                    className="max-w-full truncate rounded-full border border-line bg-sand-soft/70 px-3 py-1 text-xs text-ink-soft transition-all tap-highlight-none hover:border-line-strong hover:text-ink active:scale-[0.97]"
                    title={n}
                  >
                    + {n}
                  </button>
                ))}
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 text-brand-700"
              onClick={persistCurrentNote}
            >
              Guardar esta nota
            </Button>

            <div className="mt-4 border-t border-line pt-4">
              <Label htmlFor="internal">Notas internas (no las ve el cliente)</Label>
              <Textarea
                id="internal"
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Ej: tarifa del mayorista vence el viernes"
                className="min-h-[64px]"
              />
            </div>
          </section>

          {/* tema del presupuesto */}
          <section className={sectionCard}>
            <SectionTitle icon={Palette}>Estilo del presupuesto</SectionTitle>
            <div className="flex flex-wrap items-center gap-2.5">
              {QUOTE_COLORS.map((c) => {
                const selected = theme.color === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => changeTheme({ color: c.key })}
                    aria-label={`Tema ${c.label}`}
                    aria-pressed={selected}
                    title={c.label}
                    className={cn(
                      "relative size-9 rounded-full border transition-all tap-highlight-none active:scale-95",
                      selected
                        ? "scale-110 border-ink ring-2 ring-ink ring-offset-2 ring-offset-paper"
                        : "border-line-strong/60 hover:scale-105",
                    )}
                    style={{ backgroundColor: c.swatch }}
                  >
                    {selected && (
                      <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-ink text-cream shadow-sm animate-check-pop">
                        <Check className="size-2.5" strokeWidth={3} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {QUOTE_FONTS.map((f) => {
                const selected = theme.font === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => changeTheme({ font: f.key })}
                    aria-pressed={selected}
                    className={cn(
                      "relative flex flex-col items-center gap-0.5 rounded-xl border px-2 py-2.5 transition-all tap-highlight-none active:scale-[0.98]",
                      selected
                        ? "border-brand-500 bg-brand-tint shadow-sm"
                        : "border-line hover:border-line-strong",
                    )}
                  >
                    {selected && (
                      <span className="absolute -right-1.5 -top-1.5 flex size-4.5 items-center justify-center rounded-full bg-brand-600 text-white shadow-sm animate-check-pop">
                        <Check className="size-3" strokeWidth={3} />
                      </span>
                    )}
                    <span
                      className="text-xl leading-none text-ink"
                      style={{ fontFamily: f.css }}
                    >
                      Aa
                    </span>
                    <span className="text-[11px] text-ink-faint">{f.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
              <p className="text-xs text-ink-faint">El estilo se guarda con este presupuesto.</p>
              {isAgencyTheme ? (
                <span className="flex items-center gap-1 text-xs font-medium text-ink-faint">
                  <Check className="size-3.5" /> Es el predeterminado
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={savingThemeDefault}
                  onClick={makeThemeDefault}
                >
                  Usar como predeterminado
                </Button>
              )}
            </div>
          </section>

          {/* guardar */}
          <div className="flex flex-col-reverse gap-2 pb-2 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              size="lg"
              loading={saving === "borrador"}
              disabled={saving !== null}
              onClick={() => handleSave(false)}
              className="sm:min-w-44"
            >
              Guardar borrador
            </Button>
            <Button
              variant="brand"
              size="lg"
              loading={saving === "enviar"}
              disabled={saving !== null}
              onClick={() => handleSave(true)}
              className="sm:min-w-52"
            >
              <Send /> {isDialog ? "Guardar y enviar" : "Guardar y compartir"}
            </Button>
          </div>

          {/* barra de totales del popup: sticky al pie del scroll del diálogo */}
          {isDialog && (
            <div className="sticky bottom-0 z-10 lg:hidden">
              {summaryOpen && (
                <div className="mb-2 max-h-[45dvh] overflow-y-auto animate-slide-up">
                  {totalsPanel}
                </div>
              )}
              <SummaryBar
                totals={headline}
                currency={currency}
                isAdmin={isAdmin}
                sellerCommissionPct={sellerCommissionPct}
                open={summaryOpen}
                onToggle={() => setSummaryOpen((o) => !o)}
              />
            </div>
          )}
        </div>

        {/* ─────────── columna derecha: totales + preview ─────────── */}
        <div
          className={cn(
            "min-w-0 space-y-4",
            mobileTab === "editor" && (isDialog ? "hidden lg:block" : "hidden xl:block"),
            isDialog
              ? "lg:sticky lg:top-0 lg:max-h-[calc(88dvh-11rem)] lg:overflow-y-auto lg:pb-2 lg:pr-1"
              : "xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:overflow-y-auto xl:pb-4 xl:pr-1",
          )}
        >
          <div className={cn("hidden", isDialog ? "lg:block" : "xl:block")}>{totalsPanel}</div>
          <div>
            <p
              className={cn(
                "mb-2 hidden text-center text-[11px] font-medium uppercase tracking-wide text-ink-faint",
                isDialog ? "lg:block" : "xl:block",
              )}
            >
              Así lo ve tu cliente
            </p>
            <QuoteSheet data={previewData} />
          </div>
        </div>
      </div>

      {/* barra de totales fija (página, mobile): arriba de las tabs del shell */}
      {!isDialog && (
        <div
          className={cn(
            "fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 px-4 pb-2 md:bottom-0 md:pb-3 xl:hidden",
            mobileTab !== "editor" && "hidden",
          )}
        >
          <div className="mx-auto max-w-xl">
            {summaryOpen && (
              <div className="mb-2 max-h-[55dvh] overflow-y-auto animate-slide-up">
                {totalsPanel}
              </div>
            )}
            <SummaryBar
              totals={headline}
              currency={currency}
              isAdmin={isAdmin}
              sellerCommissionPct={sellerCommissionPct}
              open={summaryOpen}
              onToggle={() => setSummaryOpen((o) => !o)}
            />
          </div>
        </div>
      )}

      {!isDialog && share && (
        <ShareDialog
          open={shareOpen}
          onOpenChange={(o) => {
            setShareOpen(o);
            if (!o) router.push(`/presupuestos/${share.id}`);
          }}
          publicToken={share.token}
          code={share.code}
          contactPhone={contactMode === "cliente" ? contact?.phone ?? null : null}
          contactName={previewData.contactName}
        />
      )}
    </div>
  );
}

/* ───────────────────────── subcomponentes ───────────────────────── */

function SectionTitle({
  icon: Icon,
  children,
  className,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "mb-3 flex items-center gap-2 font-display text-lg font-semibold text-ink",
        className,
      )}
    >
      <Icon className="size-[18px] text-ink-faint" strokeWidth={1.75} />
      {children}
    </h2>
  );
}

function ContactChip({
  contact,
  onClear,
}: {
  contact: BuilderContact | null;
  onClear?: () => void;
}) {
  if (!contact) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-sand-soft/50 px-3 py-2.5">
      <Avatar name={contact.full_name} className="size-9" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{contact.full_name}</p>
        <p className="text-xs text-ink-faint">{fmtPhone(contact.phone)}</p>
      </div>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Quitar contacto"
          className="rounded-full p-1.5 text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

/** contador de pasajeros: − [n] + con targets grandes para el pulgar */
function PaxCounter({
  icon: Icon,
  label,
  hint,
  value,
  min,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  hint: string | null;
  value: number;
  min: number;
  onChange: (delta: number) => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-sand-soft/30 p-2.5">
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink-soft">
        <Icon className="size-4 shrink-0 text-ink-faint" strokeWidth={1.9} />
        <span className="truncate">{label}</span>
      </p>
      <div className="mt-1.5 flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => onChange(-1)}
          disabled={value <= min}
          aria-label={`Menos ${label.toLowerCase()}`}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-lg leading-none text-ink-soft transition-all tap-highlight-none hover:border-line-strong hover:text-ink active:scale-90 disabled:opacity-35"
        >
          −
        </button>
        <span className="min-w-6 text-center text-lg font-semibold tabular-nums text-ink">
          {value}
        </span>
        <button
          type="button"
          onClick={() => onChange(1)}
          aria-label={`Más ${label.toLowerCase()}`}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-lg leading-none text-ink-soft transition-all tap-highlight-none hover:border-line-strong hover:text-ink active:scale-90"
        >
          +
        </button>
      </div>
      {hint && <p className="mt-1 text-[10px] leading-tight text-ink-faint">{hint}</p>}
    </div>
  );
}

function ItemGroupHeader({
  icon: Icon,
  label,
  subtotal,
  currency,
}: {
  icon: LucideIcon;
  label: string;
  subtotal: number;
  currency: string;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
        <Icon className="size-[18px] self-center text-ink-faint" strokeWidth={1.75} />
        {label}
      </h2>
      <p className="text-sm tabular-nums text-ink-soft">{fmtMoney(subtotal, currency)}</p>
    </div>
  );
}

function ItemHeaderRow({
  withType,
  withCommission,
  fee,
}: {
  withType: boolean;
  withCommission: boolean;
  fee: number;
}) {
  return (
    <div
      className={cn(
        "mb-1.5 hidden gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint @2xl:grid",
        gridFor(withType, withCommission),
      )}
    >
      {withType && <span>Tipo</span>}
      <span>Descripción</span>
      <span>Proveedor</span>
      <span className="text-right" title="Tarifa comisionable del mayorista.">
        Bruto
      </span>
      <span
        className="text-right"
        title={`Lo que se paga: el bruto + ${fee}%. Podés pisarlo a mano.`}
      >
        Final {fee > 0 ? `+${fmtNumber(fee, fee % 1 ? 1 : 0)}%` : ""}
      </span>
      {withCommission && <span className="text-right">% com</span>}
      <span />
    </div>
  );
}

/** Selector de tipo de servicio: chip con icono → popover con ChoiceGrid */
function TypePicker({
  value,
  onChange,
  className,
}: {
  value: ServiceType;
  onChange: (t: ServiceType) => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const meta = SERVICE_TYPES[value];
  const Icon = meta.icon;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Tipo de servicio: ${meta.label}. Tocá para cambiarlo`}
          className={cn(
            "flex h-9 min-w-0 items-center gap-1.5 rounded-xl border border-line bg-paper px-2.5 text-[13px] font-medium text-ink transition-colors tap-highlight-none hover:border-line-strong hover:bg-sand-soft/50",
            className,
          )}
        >
          <Icon className="size-4 shrink-0 text-ink-soft" strokeWidth={1.9} />
          <span className="truncate">{meta.label}</span>
          <ChevronDown className="ml-auto size-3.5 shrink-0 text-ink-faint" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <ChoiceGrid
          options={TERRESTRE_OPTIONS}
          value={value}
          onChange={(t) => {
            onChange(t);
            setOpen(false);
          }}
          columns={4}
          size="sm"
        />
      </PopoverContent>
    </Popover>
  );
}

function ItemRowEditor({
  row,
  suppliers,
  currency,
  fees,
  withType,
  withCommission,
  removing,
  moveTargets,
  onChange,
  onPickSupplier,
  onRemove,
  onEnter,
  descRef,
}: {
  row: ItemRow;
  suppliers: BuilderSupplier[];
  currency: string;
  fees: QuoteFees;
  withType: boolean;
  withCommission: boolean;
  removing: boolean;
  moveTargets: { key: string | null; label: string }[];
  onChange: (patch: Partial<ItemRow>) => void;
  onPickSupplier: (supplierId: string) => void;
  onRemove: () => void;
  /** Enter en los números agrega otra fila del mismo grupo (solo última fila) */
  onEnter?: () => void;
  descRef?: (el: HTMLInputElement | null) => void;
}) {
  const grossNum = parseNum(row.gross);
  const autoCost = finalFromGross(grossNum, row.type, fees);
  const costValue = row.costManual ? row.cost : autoCost ? String(round2(autoCost)) : "";
  const commission = (grossNum * parseNum(row.commissionPct)) / 100;
  const fee = feePct(row.type, fees);

  function handleEnter(e: React.KeyboardEvent) {
    if (e.key === "Enter" && onEnter) {
      e.preventDefault();
      onEnter();
    }
  }

  const moveMenu = moveTargets.length > 0 && (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          aria-label="Mover el servicio a otra opción"
          className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink"
        >
          <ArrowLeftRight className="size-4" />
        </button>
      </DropdownTrigger>
      <DropdownContent align="end" className="min-w-[180px]">
        {moveTargets.map((t) => (
          <DropdownItem
            key={t.key ?? "common"}
            onSelect={() => onChange({ optionKey: t.key })}
          >
            {t.label}
            {row.optionKey === t.key && <Check className="ml-auto size-3.5" />}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );

  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-sand-soft/30 p-3",
        "@2xl:grid @2xl:items-center @2xl:gap-2 @2xl:border-0 @2xl:bg-transparent @2xl:p-0",
        gridFor(withType, withCommission),
        row.fresh && "animate-slide-up",
        removing && "pointer-events-none animate-fade-out",
      )}
    >
      {/* mobile: header de la mini-card */}
      <div className="mb-2 flex items-center justify-between gap-2 @2xl:hidden">
        {withType ? (
          <TypePicker
            value={row.type}
            onChange={(t) => onChange({ type: t })}
            className="w-44"
          />
        ) : (
          <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink-soft">
            <Plane className="size-4 text-ink-faint" strokeWidth={1.9} /> Aéreo
          </span>
        )}
        <span className="flex items-center gap-0.5">
          {moveMenu}
          <button
            type="button"
            onClick={onRemove}
            aria-label="Eliminar ítem"
            className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-tone-red-soft hover:text-tone-red-text"
          >
            <Trash2 className="size-4" />
          </button>
        </span>
      </div>

      {/* tipo (desktop) */}
      {withType && (
        <TypePicker
          value={row.type}
          onChange={(t) => onChange({ type: t })}
          className="hidden w-full @2xl:flex"
        />
      )}

      {/* descripción */}
      <Input
        ref={descRef}
        value={row.description}
        onChange={(e) => onChange({ description: e.target.value })}
        placeholder={ROW_PLACEHOLDERS[row.type]}
        className="h-10 @2xl:h-9 @2xl:text-[13px]"
      />

      {/* proveedor */}
      <div className="mt-2 @2xl:mt-0">
        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-faint @2xl:hidden">
          Proveedor
        </span>
        <Select
          value={row.supplierId}
          onChange={(e) => onPickSupplier(e.target.value)}
          className="h-9 text-[13px]"
        >
          <option value="">Sin proveedor</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>

      {/* números */}
      <div
        className={cn(
          "mt-2 grid gap-2 @2xl:mt-0 @2xl:grid-cols-subgrid",
          withCommission ? "grid-cols-3 @2xl:col-span-3" : "grid-cols-2 @2xl:col-span-2",
        )}
      >
        <div>
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-faint @2xl:hidden">
            Bruto ({currency})
          </span>
          <Input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={row.gross}
            onChange={(e) => onChange({ gross: e.target.value })}
            onKeyDown={handleEnter}
            placeholder="0"
            aria-label="Precio bruto"
            className="h-9 text-right text-[13px] tabular-nums"
          />
        </div>
        <div>
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-faint @2xl:hidden">
            Final {fee > 0 ? `(+${fmtNumber(fee, fee % 1 ? 1 : 0)}%)` : ""}
          </span>
          <div className="relative">
            <Input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={costValue}
              onChange={(e) => onChange({ cost: e.target.value, costManual: true })}
              onKeyDown={handleEnter}
              placeholder="0"
              aria-label="Precio final"
              className={cn(
                "h-9 text-right text-[13px] tabular-nums",
                row.costManual ? "pr-7" : "bg-sand-soft/70 text-ink-soft",
              )}
            />
            {row.costManual && (
              <Tooltip content="Volver al cálculo automático">
                <button
                  type="button"
                  onClick={() => onChange({ costManual: false, cost: "" })}
                  aria-label="Volver al final automático"
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
        {withCommission && (
          <div>
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-faint @2xl:hidden">
              % com
            </span>
            <Input
              type="number"
              min={0}
              max={100}
              step="any"
              inputMode="decimal"
              value={row.commissionPct}
              onChange={(e) => onChange({ commissionPct: e.target.value })}
              onKeyDown={handleEnter}
              placeholder="0"
              aria-label="Comisión del mayorista en porcentaje"
              className="h-9 text-right text-[13px] tabular-nums"
            />
          </div>
        )}
      </div>

      {/* acciones (desktop) + comisión de la fila (mobile) */}
      <span className="hidden items-center gap-0.5 @2xl:flex">
        {moveMenu}
        <button
          type="button"
          onClick={onRemove}
          aria-label="Eliminar ítem"
          className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-tone-red-soft hover:text-tone-red-text"
        >
          <Trash2 className="size-4" />
        </button>
      </span>
      {withCommission && commission > 0 && (
        <p className="mt-2 text-right text-[11px] tabular-nums text-money-700 @2xl:hidden">
          comisión {fmtMoney(commission, currency)}
        </p>
      )}
    </div>
  );
}

/* ── número de plata que cuenta al cambiar (enteros animan, centavos exactos) ── */
function MoneyTicker({
  value,
  currency,
  className,
}: {
  value: number;
  currency: string;
  className?: string;
}) {
  const rounded = round2(value);
  if (!Number.isInteger(rounded)) {
    return <span className={cn("tabular-nums", className)}>{fmtMoney(rounded, currency)}</span>;
  }
  return (
    <AnimatedNumber
      value={rounded}
      duration={450}
      format={(n) => fmtMoney(Math.round(n), currency)}
      className={className}
    />
  );
}

/* ── barra colapsable de totales (mobile) ── */
function SummaryBar({
  totals,
  currency,
  isAdmin,
  sellerCommissionPct,
  open,
  onToggle,
}: {
  totals: QuoteTotals;
  currency: string;
  isAdmin: boolean;
  sellerCommissionPct: number;
  open: boolean;
  onToggle: () => void;
}) {
  const commission = isAdmin
    ? totals.commissionTotal
    : sellerMarkupCommission(totals.markupAmount, sellerCommissionPct);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="card flex w-full items-center justify-between px-4 py-3 text-left shadow-lg shadow-ink/10 transition-all tap-highlight-none active:scale-[0.99]"
    >
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
          Por persona
        </p>
        <MoneyTicker
          value={totals.perPerson}
          currency={currency}
          className="text-lg font-semibold leading-tight text-ink"
        />
        <p className="text-[11px] tabular-nums text-ink-faint">
          total {fmtMoney(totals.totalPrice, currency)}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            {isAdmin ? "Comisión" : "Tu comisión"}
          </p>
          <MoneyTicker
            value={commission}
            currency={currency}
            className="text-sm font-semibold leading-tight text-money-700"
          />
        </div>
        <ChevronUp
          className={cn(
            "size-4 text-ink-faint transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </div>
    </button>
  );
}

/* ── panel de totales (también lo usa el detalle del presupuesto) ── */
export function TotalsPanel({
  totals,
  options = [],
  currency,
  pax,
  isAdmin,
  sellerCommissionPct = DEFAULT_SELLER_MARKUP_PCT,
  markupSlot,
}: {
  /** totales de los servicios comunes (o del presupuesto entero si no hay opciones) */
  totals: QuoteTotals;
  /** si hay opciones, cada una con su precio */
  options?: QuoteOptionTotals[];
  currency: string;
  pax: QuotePax;
  isAdmin: boolean;
  sellerCommissionPct?: number;
  /** en el builder, los controles de markup/descuento viven acá adentro */
  markupSlot?: React.ReactNode;
}) {
  const hasOptions = options.length > 0;
  const headline = hasOptions
    ? (options.find((o) => o.isRecommended) ?? options[0]).totals
    : totals;
  const sellerEstimate = sellerMarkupCommission(headline.markupAmount, sellerCommissionPct);
  const totalPax = paxCount(pax);

  return (
    <div className="space-y-3">
      {/* precio: por persona grande, total chico */}
      {hasOptions ? (
        <div className="space-y-2.5">
          {options.map((o) => (
            <div
              key={o.key}
              className={cn(
                "card p-4",
                o.isRecommended && "border-brand-tint-line bg-brand-tint/25",
              )}
            >
              <div className="flex items-center gap-1.5">
                {o.isRecommended && (
                  <Sparkles className="size-3.5 shrink-0 text-brand-600" strokeWidth={2} />
                )}
                <p className="truncate text-[13px] font-medium text-ink">{o.name}</p>
              </div>
              {o.subtitle && (
                <p className="truncate text-xs text-ink-faint">{o.subtitle}</p>
              )}
              <div className="mt-2 flex items-end justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                    Por persona
                  </p>
                  <MoneyTicker
                    value={o.totals.perPerson}
                    currency={currency}
                    className="text-[26px] font-semibold leading-none text-ink"
                  />
                </div>
                <p className="text-right text-xs tabular-nums text-ink-faint">
                  total {fmtMoney(o.totals.totalPrice, currency)}
                  <span className="block">costo {fmtMoney(o.totals.totalCost, currency)}</span>
                </p>
              </div>
            </div>
          ))}
          {markupSlot && <div className="card p-4 sm:p-5">{markupSlot}</div>}
        </div>
      ) : (
        <div className="card p-4 sm:p-5">
          <dl className="space-y-2 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-soft">Total paquete</dt>
              <dd className="tabular-nums text-ink">{fmtMoney(totals.totalCost, currency)}</dd>
            </div>
            {!markupSlot && (
              <>
                <div className="flex items-baseline justify-between">
                  <dt className="text-ink-soft">Markup</dt>
                  <dd className="tabular-nums text-ink">
                    {fmtMoney(totals.markupAmount, currency)}
                    <span className="ml-1.5 text-xs text-ink-faint">
                      ({fmtNumber(totals.markupPct, totals.markupPct % 1 ? 1 : 0)}%)
                    </span>
                  </dd>
                </div>
                {totals.discount > 0 && (
                  <div className="flex items-baseline justify-between">
                    <dt className="text-ink-soft">Descuento</dt>
                    <dd className="tabular-nums text-tone-red-text">
                      −{fmtMoney(totals.discount, currency)}
                    </dd>
                  </div>
                )}
              </>
            )}
          </dl>
          {markupSlot}
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              Precio por persona
            </p>
            <MoneyTicker
              value={totals.perPerson}
              currency={currency}
              className="block text-[34px] font-semibold leading-none text-ink"
            />
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-xs tabular-nums text-ink-faint">
                {paxLabel(pax, false)}
                {pax.infants > 0
                  ? ` · infante ${fmtMoney(totals.perInfant, currency)}`
                  : ""}
              </p>
              <p className="text-xs tabular-nums text-ink-faint">
                total{" "}
                <span className="font-medium text-ink-soft">
                  {fmtMoney(totals.totalPrice, currency)}
                </span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* comisión: la ve solo el admin. El vendedor ve su estimado. */}
      {isAdmin ? (
        <div className="card p-4 sm:p-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Comisión {hasOptions ? "· opción recomendada" : ""}
          </p>
          <dl className="space-y-1.5 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="flex items-center gap-1.5 text-ink-soft">
                <Plane className="size-4 self-center text-ink-faint" strokeWidth={1.75} />
                Aéreos
              </dt>
              <dd className="tabular-nums text-ink">
                {fmtMoney(headline.commissionByGroup.aereos, currency)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="flex items-center gap-1.5 text-ink-soft">
                <Bus className="size-4 self-center text-ink-faint" strokeWidth={1.75} />
                Terrestres
              </dt>
              <dd className="tabular-nums text-ink">
                {fmtMoney(headline.commissionByGroup.terrestres, currency)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-soft">Markup</dt>
              <dd className="tabular-nums text-ink">
                {fmtMoney(headline.markupAmount, currency)}
              </dd>
            </div>
            {headline.discount > 0 && (
              <div className="flex items-baseline justify-between">
                <dt className="text-ink-soft">Descuento</dt>
                <dd className="tabular-nums text-tone-red-text">
                  −{fmtMoney(headline.discount, currency)}
                </dd>
              </div>
            )}
          </dl>
          <div className="mt-2.5 flex items-baseline justify-between border-t border-line pt-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-money-700">
              Total comisión
            </p>
            <MoneyTicker
              value={headline.commissionTotal}
              currency={currency}
              className="text-xl font-semibold text-money-700"
            />
          </div>
        </div>
      ) : (
        <div className="card flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Tu comisión estimada
            </p>
            <p className="text-xs text-ink-faint">
              {fmtNumber(sellerCommissionPct)}% del markup
            </p>
          </div>
          <MoneyTicker
            value={sellerEstimate}
            currency={currency}
            className="shrink-0 text-xl font-semibold text-money-700"
          />
        </div>
      )}

      {totalPax > 0 && !hasOptions && pax.infants > 0 && (
        <p className="px-1 text-[11px] text-ink-faint">
          El infante paga el {Math.round(INFANT_FACTOR * 100)}% y ya está prorrateado en el total.
        </p>
      )}
    </div>
  );
}
