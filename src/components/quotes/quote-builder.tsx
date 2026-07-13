"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bus,
  Check,
  ChevronDown,
  ChevronUp,
  MapPin,
  Palette,
  Plane,
  Plus,
  Search,
  Send,
  StickyNote,
  Trash2,
  UserRound,
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
} from "@/components/ui/misc";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import {
  computeQuoteTotals,
  QUOTE_COLORS,
  QUOTE_FONTS,
  round2,
  SERVICE_ORDER,
  SERVICE_TYPES,
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
  pax: number;
  currency: string;
  valid_until: string | null;
  markup_type: string;
  markup_value: number;
  discount: number;
  notes: string | null;
  internal_notes: string | null;
  theme: { color?: string; font?: string };
  items: {
    type: ServiceType;
    description: string;
    supplier_id: string | null;
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
  cost: string;
  gross: string;
  commissionPct: string;
  /** filas agregadas por el usuario entran con slide-up */
  fresh: boolean;
};

/* ───────────────────────── helpers ───────────────────────── */

let rowSeq = 0;
function newRow(type: ServiceType, fresh = false): ItemRow {
  return {
    key: `row-${++rowSeq}-${Date.now()}`,
    type,
    description: "",
    supplierId: "",
    cost: "",
    gross: "",
    commissionPct: type === "aereo" ? "0" : "",
    fresh,
  };
}

function parseNum(s: string): number {
  const n = parseFloat(s.replace(",", "."));
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

/* grillas tipo planilla (container queries del card de ítems) */
const GRID_WITH_TYPE =
  "@2xl:grid-cols-[118px_minmax(0,1fr)_132px_88px_88px_56px_28px]";
const GRID_NO_TYPE = "@2xl:grid-cols-[minmax(0,1fr)_132px_88px_88px_56px_28px]";

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
  const [pax, setPax] = React.useState(
    String(initial?.pax ?? (lead ? lead.pax_adults + lead.pax_children : 2)),
  );
  const [currency, setCurrency] = React.useState<"USD" | "ARS">(
    initial?.currency === "ARS" ? "ARS" : "USD",
  );
  const [validUntil, setValidUntil] = React.useState(initial?.valid_until ?? isoPlusDays(15));

  /* ítems */
  const [rows, setRows] = React.useState<ItemRow[]>(() => {
    if (initial && initial.items.length > 0) {
      return [...initial.items]
        .sort((a, b) => a.position - b.position)
        .map((i) => ({
          key: `row-${++rowSeq}`,
          type: i.type,
          description: i.description,
          supplierId: i.supplier_id ?? "",
          cost: i.cost ? String(i.cost) : "",
          gross: i.gross != null ? String(i.gross) : "",
          commissionPct: String(i.commission_pct ?? 0),
          fresh: false,
        }));
    }
    return [newRow("aereo"), newRow("hotel")];
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
  const paxNum = Math.max(1, Math.round(parseNum(pax)) || 1);
  const totals = React.useMemo<QuoteTotals>(
    () =>
      computeQuoteTotals({
        items: rows.map((r) => ({
          type: r.type,
          cost: parseNum(r.cost),
          gross: r.gross.trim() === "" ? parseNum(r.cost) : parseNum(r.gross),
          commission_pct: parseNum(r.commissionPct),
        })),
        markup_type: markupType,
        markup_value: parseNum(markupValue),
        discount: parseNum(discount),
        pax: paxNum,
      }),
    [rows, markupType, markupValue, discount, paxNum],
  );

  const nights = nightsBetween(dateFrom || null, dateTo || null);

  const previewData: QuoteSheetData = {
    code: initial?.code ?? "P-····",
    title: title.trim() || null,
    destination: destination.trim() || "Tu próximo destino",
    currency,
    pax: paxNum,
    nights,
    tripDateFrom: dateFrom || null,
    tripDateTo: dateTo || null,
    validUntil: validUntil || null,
    totalPrice: totals.totalPrice,
    perPerson: totals.perPerson,
    discount: totals.discount,
    notes: notes.trim() || null,
    createdAt: null,
    contactName:
      contactMode === "prospecto" ? prospectName.trim() || null : contact?.full_name ?? null,
    contactPhone: contactMode === "prospecto" ? null : contact?.phone ?? null,
    agencyName: agency.name,
    agencyLogoUrl: agency.logoUrl,
    agencyPhone: agency.phone,
    sellerName,
    items: rows
      .filter((r) => r.description.trim())
      .map((r) => ({ type: r.type, description: r.description.trim() })),
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
  function addRow(type: ServiceType) {
    const row = newRow(type, true);
    pendingFocusRef.current = row.key;
    setRows((rs) => [...rs, row]);
  }
  function addTerrestre() {
    // default inteligente: repite el tipo del último servicio terrestre cargado
    const last = [...rows].reverse().find((r) => r.type !== "aereo");
    addRow(last?.type ?? "hotel");
  }
  function pickSupplier(row: ItemRow, supplierId: string) {
    const sup = suppliers.find((s) => s.id === supplierId);
    updateRow(row.key, {
      supplierId,
      commissionPct:
        row.type === "aereo"
          ? "0"
          : sup
            ? String(sup.default_commission_pct)
            : row.commissionPct,
    });
  }
  const focusDescription = (row: ItemRow) => (el: HTMLInputElement | null) => {
    if (el && pendingFocusRef.current === row.key) {
      pendingFocusRef.current = null;
      el.focus();
    }
  };

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
    const cleanRows = rows.filter((r) => r.description.trim() || parseNum(r.cost) > 0);
    if (cleanRows.length === 0) {
      toast.error("Agregá al menos un servicio al presupuesto.");
      return;
    }
    if (cleanRows.some((r) => !r.description.trim())) {
      toast.error("Completá la descripción de todos los servicios.");
      return;
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
      pax: paxNum,
      currency,
      validUntil: validUntil || null,
      markupType,
      markupValue: parseNum(markupValue),
      discount: parseNum(discount),
      notes: notes.trim() || null,
      internalNotes: internalNotes.trim() || null,
      theme,
      items: cleanRows.map((r) => ({
        type: r.type,
        description: r.description.trim(),
        supplierId: r.supplierId || null,
        cost: parseNum(r.cost),
        gross: r.gross.trim() === "" ? null : parseNum(r.gross),
        commissionPct: parseNum(r.commissionPct),
      })),
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
        totalPrice: totals.totalPrice,
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

  const aereos = rows.filter((r) => r.type === "aereo");
  const terrestres = rows.filter((r) => r.type !== "aereo");

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
          = {fmtMoney(totals.markupAmount, currency)}
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
                <Label htmlFor="pax">Pasajeros</Label>
                <Input
                  id="pax"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={pax}
                  onChange={(e) => setPax(e.target.value)}
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
              <div className="col-span-2 sm:col-span-4">
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

          {/* ítems: aéreos */}
          <section className={cn(sectionCard, "@container")}>
            <ItemGroupHeader
              icon={Plane}
              label="Aéreos"
              subtotal={totals.byGroup.aereos}
              currency={currency}
            />
            <ItemHeaderRow withType={false} />
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
                  withType={false}
                  removing={removingKeys.has(row.key)}
                  onChange={(patch) => updateRow(row.key, patch)}
                  onPickSupplier={(id) => pickSupplier(row, id)}
                  onRemove={() => removeRow(row.key)}
                  onEnter={idx === aereos.length - 1 ? () => addRow("aereo") : undefined}
                  descRef={focusDescription(row)}
                />
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2.5 text-brand-700"
              onClick={() => addRow("aereo")}
            >
              <Plus /> Agregar aéreo
            </Button>
          </section>

          {/* ítems: terrestres */}
          <section className={cn(sectionCard, "@container")}>
            <ItemGroupHeader
              icon={Bus}
              label="Terrestres"
              subtotal={totals.byGroup.terrestres}
              currency={currency}
            />
            <ItemHeaderRow withType />
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
                  withType
                  removing={removingKeys.has(row.key)}
                  onChange={(patch) => updateRow(row.key, patch)}
                  onPickSupplier={(id) => pickSupplier(row, id)}
                  onRemove={() => removeRow(row.key)}
                  onEnter={idx === terrestres.length - 1 ? addTerrestre : undefined}
                  descRef={focusDescription(row)}
                />
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2.5 text-brand-700"
              onClick={addTerrestre}
            >
              <Plus /> Agregar servicio
            </Button>
          </section>

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
                  <TotalsPanel totals={totals} currency={currency} markupSlot={markupSlot} />
                </div>
              )}
              <SummaryBar
                totals={totals}
                currency={currency}
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
          <div className={cn("hidden", isDialog ? "lg:block" : "xl:block")}>
            <TotalsPanel totals={totals} currency={currency} markupSlot={markupSlot} />
          </div>
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
                <TotalsPanel totals={totals} currency={currency} markupSlot={markupSlot} />
              </div>
            )}
            <SummaryBar
              totals={totals}
              currency={currency}
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
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-ink">
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

function ItemHeaderRow({ withType }: { withType: boolean }) {
  return (
    <div
      className={cn(
        "mb-1.5 hidden gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint @2xl:grid",
        withType ? GRID_WITH_TYPE : GRID_NO_TYPE,
      )}
    >
      {withType && <span>Tipo</span>}
      <span>Descripción</span>
      <span>Proveedor</span>
      <span className="text-right">Final</span>
      <span
        className="text-right"
        title="Tarifa comisionable del mayorista. Vacío = igual al Final."
      >
        Bruto
      </span>
      <span className="text-right">% com</span>
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
  withType,
  removing,
  onChange,
  onPickSupplier,
  onRemove,
  onEnter,
  descRef,
}: {
  row: ItemRow;
  suppliers: BuilderSupplier[];
  currency: string;
  withType: boolean;
  removing: boolean;
  onChange: (patch: Partial<ItemRow>) => void;
  onPickSupplier: (supplierId: string) => void;
  onRemove: () => void;
  /** Enter en los números agrega otra fila del mismo grupo (solo última fila) */
  onEnter?: () => void;
  descRef?: (el: HTMLInputElement | null) => void;
}) {
  const commission =
    ((row.gross.trim() === "" ? parseNum(row.cost) : parseNum(row.gross)) *
      parseNum(row.commissionPct)) /
    100;

  function handleEnter(e: React.KeyboardEvent) {
    if (e.key === "Enter" && onEnter) {
      e.preventDefault();
      onEnter();
    }
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-sand-soft/30 p-3",
        "@2xl:grid @2xl:items-center @2xl:gap-2 @2xl:border-0 @2xl:bg-transparent @2xl:p-0",
        withType ? GRID_WITH_TYPE : GRID_NO_TYPE,
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
        <button
          type="button"
          onClick={onRemove}
          aria-label="Eliminar ítem"
          className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-tone-red-soft hover:text-tone-red-text"
        >
          <Trash2 className="size-4" />
        </button>
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
      <div className="mt-2 grid grid-cols-3 gap-2 @2xl:col-span-3 @2xl:mt-0 @2xl:grid-cols-subgrid">
        <div>
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-faint @2xl:hidden">
            Final ({currency})
          </span>
          <Input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={row.cost}
            onChange={(e) => onChange({ cost: e.target.value })}
            onKeyDown={handleEnter}
            placeholder="0"
            className="h-9 text-right text-[13px] tabular-nums"
          />
        </div>
        <div>
          <span
            className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-faint @2xl:hidden"
            title="Tarifa comisionable del mayorista. Vacío = igual al Final."
          >
            Bruto
          </span>
          <Input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={row.gross}
            onChange={(e) => onChange({ gross: e.target.value })}
            onKeyDown={handleEnter}
            placeholder="= final"
            className="h-9 text-right text-[13px] tabular-nums"
          />
        </div>
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
            className="h-9 text-right text-[13px] tabular-nums"
          />
        </div>
      </div>

      {/* eliminar (desktop) + comisión de la fila (mobile) */}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Eliminar ítem"
        className="hidden rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-tone-red-soft hover:text-tone-red-text @2xl:block"
      >
        <Trash2 className="size-4" />
      </button>
      {commission > 0 && (
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
  open,
  onToggle,
}: {
  totals: QuoteTotals;
  currency: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="card flex w-full items-center justify-between px-4 py-3 text-left shadow-lg shadow-ink/10 transition-all tap-highlight-none active:scale-[0.99]"
    >
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
          Precio cliente
        </p>
        <MoneyTicker
          value={totals.totalPrice}
          currency={currency}
          className="text-lg font-semibold leading-tight text-ink"
        />
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Comisión
          </p>
          <MoneyTicker
            value={totals.commissionTotal}
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
  currency,
  markupSlot,
}: {
  totals: QuoteTotals;
  currency: string;
  /** en el builder, los controles de markup/descuento viven acá adentro */
  markupSlot?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      {/* precio cliente */}
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
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              Precio cliente
            </p>
            <MoneyTicker
              value={totals.totalPrice}
              currency={currency}
              className="text-[26px] font-semibold leading-none text-ink"
            />
          </div>
          <p className="mt-1 text-right text-xs tabular-nums text-ink-faint">
            por persona {fmtMoney(totals.perPerson, currency)}
          </p>
        </div>
      </div>

      {/* comisión (como la planilla) */}
      <div className="card p-4 sm:p-5">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Comisión
        </p>
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-baseline justify-between">
            <dt className="flex items-center gap-1.5 text-ink-soft">
              <Plane className="size-4 self-center text-ink-faint" strokeWidth={1.75} />
              Aéreos
            </dt>
            <dd className="tabular-nums text-ink">
              {fmtMoney(totals.commissionByGroup.aereos, currency)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="flex items-center gap-1.5 text-ink-soft">
              <Bus className="size-4 self-center text-ink-faint" strokeWidth={1.75} />
              Terrestres
            </dt>
            <dd className="tabular-nums text-ink">
              {fmtMoney(totals.commissionByGroup.terrestres, currency)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-ink-soft">Markup</dt>
            <dd className="tabular-nums text-ink">{fmtMoney(totals.markupAmount, currency)}</dd>
          </div>
          {totals.discount > 0 && (
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-soft">Descuento</dt>
              <dd className="tabular-nums text-tone-red-text">
                −{fmtMoney(totals.discount, currency)}
              </dd>
            </div>
          )}
        </dl>
        <div className="mt-2.5 flex items-baseline justify-between border-t border-line pt-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-money-700">
            Total comisión
          </p>
          <MoneyTicker
            value={totals.commissionTotal}
            currency={currency}
            className="text-xl font-semibold text-money-700"
          />
        </div>
      </div>
    </div>
  );
}
