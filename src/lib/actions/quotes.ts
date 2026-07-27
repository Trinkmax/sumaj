"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  requireAction,
  succeed,
  fail,
  logActivity,
  convertLeadToSale,
  selectQuoteSale,
  type ActionResult,
} from "@/lib/actions/core";
import {
  computeQuoteTotals,
  DEFAULT_QUOTE_FEES,
  DEFAULT_SELLER_MARKUP_PCT,
  paxCount,
  round2,
  type QuoteItemInput,
  type QuotePax,
} from "@/lib/domain";
import { nightsBetween } from "@/lib/format";
import type { AgencySettings, TablesUpdate } from "@/lib/types";
import type { QuoteBuilderData } from "@/components/quotes/types";

/* ───────────────────────────────────────────
   getQuoteBuilderData — todo lo que necesita el
   QuoteBuilder para armarse client-side (popup).
   Replica lo que /presupuestos/nuevo arma server-side.
   ─────────────────────────────────────────── */

const builderDataSchema = z.object({
  leadId: z.string().uuid().nullish(),
  contactId: z.string().uuid().nullish(),
});

export async function getQuoteBuilderData(input: {
  leadId?: string | null;
  contactId?: string | null;
}): Promise<ActionResult<QuoteBuilderData>> {
  const parsed = builderDataSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { leadId, contactId } = parsed.data;
  const { supabase, member, agency, isAdmin } = await requireAction();

  const [suppliersRes, contactsRes, leadRes] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id, name, default_commission_pct")
      .eq("is_active", true)
      .order("name"),
    // solo los últimos 30 — el resto se busca server-side desde el picker
    supabase
      .from("contacts")
      .select("id, full_name, phone")
      .order("created_at", { ascending: false })
      .limit(30),
    leadId
      ? supabase
          .from("leads")
          .select(
            "id, destination, trip_date_from, trip_date_to, pax_adults, pax_children, contact:contacts(id, full_name, phone)",
          )
          .eq("id", leadId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (suppliersRes.error || contactsRes.error)
    return fail("No se pudo cargar el cotizador. Probá de nuevo.");

  const suppliers: QuoteBuilderData["suppliers"] = (suppliersRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    default_commission_pct: Number(s.default_commission_pct),
  }));

  const contacts: QuoteBuilderData["contacts"] = [...(contactsRes.data ?? [])];
  // si vino un contactId que no está entre los últimos 30, lo sumamos adelante
  if (contactId && !contacts.some((c) => c.id === contactId)) {
    const { data: extra } = await supabase
      .from("contacts")
      .select("id, full_name, phone")
      .eq("id", contactId)
      .maybeSingle();
    if (extra) contacts.unshift(extra);
  }

  const leadRow = leadRes.data;
  const lead: QuoteBuilderData["lead"] =
    leadRow && leadRow.contact
      ? {
          id: leadRow.id,
          destination: leadRow.destination,
          trip_date_from: leadRow.trip_date_from,
          trip_date_to: leadRow.trip_date_to,
          pax_adults: leadRow.pax_adults,
          pax_children: leadRow.pax_children,
          contact: leadRow.contact,
        }
      : null;

  const settings = (agency.settings ?? {}) as unknown as Partial<AgencySettings>;

  return succeed({
    lead,
    contacts,
    suppliers,
    savedNotes: settings.quote_saved_notes ?? [],
    defaultTheme: settings.quote_theme ?? { color: "sand", font: "editorial" },
    agency: { name: agency.name, logoUrl: agency.logo_url, phone: agency.phone },
    sellerName: member.display_name,
    isAdmin,
    fees: {
      aereo_pct: Number(settings.quote_fees?.aereo_pct ?? DEFAULT_QUOTE_FEES.aereo_pct),
      terrestre_pct: Number(
        settings.quote_fees?.terrestre_pct ?? DEFAULT_QUOTE_FEES.terrestre_pct,
      ),
    },
    sellerCommissionPct: Number(
      settings.quote_seller_commission_pct ?? DEFAULT_SELLER_MARKUP_PCT,
    ),
  });
}

/* ───────────────────────────────────────────
   saveQuote — upsert de presupuesto + ítems.
   Totales SIEMPRE con computeQuoteTotals (única fuente de verdad).
   ─────────────────────────────────────────── */

const itemSchema = z.object({
  type: z.enum([
    "aereo",
    "hotel",
    "paquete",
    "excursion",
    "traslado",
    "asistencia",
    "circuito",
    "crucero",
    "otro",
  ]),
  description: z.string().trim().min(1),
  supplierId: z.string().uuid().nullable(),
  /** key de la opción a la que pertenece; null = común a todas */
  optionKey: z.string().max(60).nullable(),
  cost: z.number().min(0),
  gross: z.number().min(0).nullable(),
  commissionPct: z.number().min(0).max(100),
});

const optionSchema = z.object({
  key: z.string().min(1).max(60),
  name: z.string().trim().min(1).max(80),
  subtitle: z.string().trim().max(120).nullable(),
  isRecommended: z.boolean(),
});

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

const saveSchema = z.object({
  id: z.string().uuid().nullable(),
  leadId: z.string().uuid().nullable(),
  contactId: z.string().uuid().nullable(),
  prospectName: z.string().trim().max(120).nullable(),
  destination: z.string().trim().min(1).max(160),
  title: z.string().trim().max(160).nullable(),
  tripDateFrom: dateStr,
  tripDateTo: dateStr,
  paxAdults: z.number().int().min(1).max(60),
  paxChildren: z.number().int().min(0).max(30),
  paxInfants: z.number().int().min(0).max(20),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(30),
  currency: z.enum(["USD", "ARS"]),
  validUntil: dateStr,
  markupType: z.enum(["monto", "porcentaje"]),
  markupValue: z.number().min(0),
  discount: z.number().min(0),
  notes: z.string().trim().max(2000).nullable(),
  internalNotes: z.string().trim().max(2000).nullable(),
  theme: z.object({ color: z.string(), font: z.string() }),
  options: z.array(optionSchema).max(4),
  items: z.array(itemSchema).min(1),
  send: z.boolean(),
});

export type SaveQuoteInput = z.infer<typeof saveSchema>;

export async function saveQuote(
  input: SaveQuoteInput,
): Promise<ActionResult<{ quoteId: string; code: string; publicToken: string }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return fail("Revisá los datos del presupuesto: falta algo.");
  const data = parsed.data;
  const { supabase, member, agency } = await requireAction();

  // contacto: existente, prospecto nuevo, o ninguno
  let contactId = data.contactId;
  if (!contactId && data.prospectName) {
    const { data: created, error } = await supabase
      .from("contacts")
      .insert({
        agency_id: agency.id,
        full_name: data.prospectName,
        source: "manual",
      })
      .select("id")
      .single();
    if (error || !created) return fail("No se pudo crear el prospecto.");
    contactId = created.id;
  }

  const pax: QuotePax = {
    adults: data.paxAdults,
    children: data.paxChildren,
    infants: data.paxInfants,
    childrenAges: data.childrenAges.slice(0, data.paxChildren),
  };

  const toInput = (i: (typeof data.items)[number]): QuoteItemInput => ({
    cost: i.cost,
    gross: i.gross ?? i.cost,
    commission_pct: i.commissionPct,
    type: i.type,
  });

  const calc = {
    markup_type: data.markupType,
    markup_value: data.markupValue,
    discount: data.discount,
    pax,
  };

  const commonItems = data.items.filter((i) => !i.optionKey);
  const validOptions = data.options.filter((o) =>
    data.items.some((i) => i.optionKey === o.key),
  );

  // totales de los servicios comunes (o del presupuesto entero si no hay opciones)
  const baseTotals = computeQuoteTotals({ ...calc, items: commonItems.map(toInput) });

  // totales por opción: comunes + propios
  const optionTotals = validOptions.map((o) => ({
    option: o,
    totals: computeQuoteTotals({
      ...calc,
      items: [
        ...commonItems.map(toInput),
        ...data.items.filter((i) => i.optionKey === o.key).map(toInput),
      ],
    }),
  }));

  // los totales de la fila del presupuesto son los de la opción recomendada
  const headline =
    optionTotals.find((o) => o.option.isRecommended)?.totals ??
    optionTotals[0]?.totals ??
    baseTotals;

  const nights = nightsBetween(data.tripDateFrom, data.tripDateTo);

  const quoteFields = {
    lead_id: data.leadId,
    contact_id: contactId,
    destination: data.destination,
    title: data.title,
    trip_date_from: data.tripDateFrom,
    trip_date_to: data.tripDateTo,
    nights,
    pax: paxCount(pax),
    pax_adults: pax.adults,
    pax_children: pax.children,
    pax_infants: pax.infants,
    children_ages: pax.childrenAges,
    currency: data.currency,
    valid_until: data.validUntil,
    markup_type: data.markupType,
    markup_value: data.markupValue,
    discount: data.discount,
    notes: data.notes,
    internal_notes: data.internalNotes,
    theme: data.theme,
    total_cost: headline.totalCost,
    total_price: headline.totalPrice,
    commission_total: headline.commissionTotal,
    updated_at: new Date().toISOString(),
  };

  let quoteId: string;
  let code: string;
  let publicToken: string;
  let prevItemIds: string[] = [];
  let prevOptionIds: string[] = [];

  if (data.id) {
    // update: mantener estado salvo que se envíe
    const { data: existing } = await supabase
      .from("quotes")
      .select("id, status, sent_at")
      .eq("id", data.id)
      .single();
    if (!existing) return fail("No encontramos el presupuesto.");

    // ítems previos: se borran DESPUÉS de insertar los nuevos, para no perder nada si falla
    const [{ data: prevItems, error: prevError }, { data: prevOptions }] = await Promise.all([
      supabase.from("quote_items").select("id").eq("quote_id", data.id),
      supabase.from("quote_options").select("id").eq("quote_id", data.id),
    ]);
    if (prevError) return fail("No se pudo guardar el presupuesto.");
    prevItemIds = (prevItems ?? []).map((i) => i.id);
    prevOptionIds = (prevOptions ?? []).map((o) => o.id);

    const { data: updated, error } = await supabase
      .from("quotes")
      .update({
        ...quoteFields,
        ...(data.send
          ? { status: "enviado" as const, sent_at: existing.sent_at ?? new Date().toISOString() }
          : {}),
      })
      .eq("id", data.id)
      .select("id, code, public_token")
      .single();
    if (error || !updated) return fail("No se pudo guardar el presupuesto.");

    quoteId = updated.id;
    code = updated.code;
    publicToken = updated.public_token;
  } else {
    const { data: created, error } = await supabase
      .from("quotes")
      .insert({
        agency_id: agency.id,
        created_by: member.id,
        status: data.send ? ("enviado" as const) : ("borrador" as const),
        ...(data.send ? { sent_at: new Date().toISOString() } : {}),
        ...quoteFields,
      })
      .select("id, code, public_token")
      .single();
    if (error || !created) return fail("No se pudo crear el presupuesto.");
    quoteId = created.id;
    code = created.code;
    publicToken = created.public_token;
  }

  // opciones nuevas (con sus totales ya calculados) → mapa key → id
  const optionIdByKey = new Map<string, string>();
  if (optionTotals.length > 0) {
    const { data: createdOptions, error: optionsError } = await supabase
      .from("quote_options")
      .insert(
        optionTotals.map((o, idx) => ({
          agency_id: agency.id,
          quote_id: quoteId,
          name: o.option.name,
          subtitle: o.option.subtitle,
          is_recommended: o.option.isRecommended,
          position: idx,
          total_cost: o.totals.totalCost,
          total_price: o.totals.totalPrice,
          per_person: o.totals.perPerson,
        })),
      )
      .select("id, position");
    if (optionsError || !createdOptions)
      return fail("No se pudieron guardar las opciones del presupuesto.");
    for (const created of createdOptions) {
      const source = optionTotals[created.position];
      if (source) optionIdByKey.set(source.option.key, created.id);
    }
  }

  // ítems: aéreos primero, después terrestres (orden de la planilla)
  const ordered = [
    ...data.items.filter((i) => i.type === "aereo"),
    ...data.items.filter((i) => i.type !== "aereo"),
  ];
  const { error: itemsError } = await supabase.from("quote_items").insert(
    ordered.map((i, idx) => ({
      agency_id: agency.id,
      quote_id: quoteId,
      option_id: i.optionKey ? optionIdByKey.get(i.optionKey) ?? null : null,
      type: i.type,
      description: i.description,
      supplier_id: i.supplierId,
      cost: i.cost,
      gross: i.gross,
      commission_pct: i.commissionPct,
      position: idx,
    })),
  );
  if (itemsError) return fail("Se guardó el presupuesto pero fallaron los ítems. Probá de nuevo.");

  // recién ahora borramos los viejos (por id, para no tocar los recién insertados)
  if (prevItemIds.length > 0) {
    const { error: cleanupError } = await supabase
      .from("quote_items")
      .delete()
      .in("id", prevItemIds);
    if (cleanupError)
      return fail("Se guardó el presupuesto pero quedaron ítems repetidos. Guardalo de nuevo.");
  }
  if (prevOptionIds.length > 0) {
    await supabase.from("quote_options").delete().in("id", prevOptionIds);
  }

  // opción vigente (la que se usa al convertir en venta): la recomendada.
  // Se reapunta en cada guardado porque las opciones se regeneran.
  const recommendedId =
    optionTotals.length > 0
      ? optionIdByKey.get(
          (optionTotals.find((o) => o.option.isRecommended) ?? optionTotals[0]).option.key,
        ) ?? null
      : null;
  await supabase.from("quotes").update({ accepted_option_id: recommendedId }).eq("id", quoteId);

  if (data.send) {
    await logActivity({
      agencyId: agency.id,
      memberId: member.id,
      leadId: data.leadId,
      contactId,
      type: "presupuesto",
      body: `Presupuesto ${code} enviado — ${data.destination}`,
      metadata: { quote_id: quoteId, total_price: headline.totalPrice },
    });
    // lead en etapas tempranas pasa a "presupuestado"
    if (data.leadId) {
      const { data: lead } = await supabase
        .from("leads")
        .select("stage")
        .eq("id", data.leadId)
        .maybeSingle();
      if (lead && (lead.stage === "nuevo" || lead.stage === "contactado")) {
        await supabase.from("leads").update({ stage: "presupuestado" }).eq("id", data.leadId);
      }
    }
  }

  revalidatePath("/presupuestos");
  revalidatePath(`/presupuestos/${quoteId}`);
  if (data.leadId) revalidatePath(`/crm/${data.leadId}`);
  return succeed({ quoteId, code, publicToken });
}

/* ───────────────────────────────────────────
   searchContacts — búsqueda para el picker del cotizador
   ─────────────────────────────────────────── */

const searchContactsSchema = z.object({ q: z.string().trim().min(1).max(80) });

export async function searchContacts(input: {
  q: string;
}): Promise<ActionResult<{ id: string; full_name: string; phone: string | null }[]>> {
  const parsed = searchContactsSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase } = await requireAction();

  // sin caracteres que rompan la sintaxis del filtro or() de PostgREST
  const term = parsed.data.q.replace(/[%_,()]/g, " ").trim();
  if (!term) return succeed([]);

  const { data, error } = await supabase
    .from("contacts")
    .select("id, full_name, phone")
    .or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`)
    .order("full_name")
    .limit(20);
  if (error) return fail("No se pudo buscar contactos.");
  return succeed(data ?? []);
}

/* ───────────────────────────────────────────
   duplicateQuote — copia como borrador nuevo
   ─────────────────────────────────────────── */

const duplicateSchema = z.object({ quoteId: z.string().uuid() });

export async function duplicateQuote(input: {
  quoteId: string;
}): Promise<ActionResult<{ quoteId: string; code: string }>> {
  const parsed = duplicateSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, member, agency } = await requireAction();

  const { data: quote } = await supabase
    .from("quotes")
    .select("*, items:quote_items(*), options:quote_options!quote_options_quote_id_fkey(*)")
    .eq("id", parsed.data.quoteId)
    .single();
  if (!quote) return fail("No encontramos el presupuesto.");

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 15);

  const { data: created, error } = await supabase
    .from("quotes")
    .insert({
      agency_id: agency.id,
      created_by: member.id,
      lead_id: quote.lead_id,
      contact_id: quote.contact_id,
      status: "borrador",
      destination: quote.destination,
      title: quote.title,
      trip_date_from: quote.trip_date_from,
      trip_date_to: quote.trip_date_to,
      nights: quote.nights,
      pax: quote.pax,
      pax_adults: quote.pax_adults,
      pax_children: quote.pax_children,
      pax_infants: quote.pax_infants,
      children_ages: quote.children_ages,
      currency: quote.currency,
      valid_until: validUntil.toISOString().slice(0, 10),
      markup_type: quote.markup_type,
      markup_value: quote.markup_value,
      discount: quote.discount,
      notes: quote.notes,
      internal_notes: quote.internal_notes,
      theme: quote.theme,
      total_cost: quote.total_cost,
      total_price: quote.total_price,
      commission_total: quote.commission_total,
    })
    .select("id, code")
    .single();
  if (error || !created) return fail("No se pudo duplicar el presupuesto.");

  // opciones: se copian primero para poder reapuntar los ítems
  const newOptionId = new Map<string, string>();
  const sourceOptions = [...(quote.options ?? [])].sort((a, b) => a.position - b.position);
  if (sourceOptions.length > 0) {
    const { data: copiedOptions, error: optionsError } = await supabase
      .from("quote_options")
      .insert(
        sourceOptions.map((o, idx) => ({
          agency_id: agency.id,
          quote_id: created.id,
          name: o.name,
          subtitle: o.subtitle,
          is_recommended: o.is_recommended,
          position: idx,
          total_cost: o.total_cost,
          total_price: o.total_price,
          per_person: o.per_person,
        })),
      )
      .select("id, position");
    if (optionsError || !copiedOptions) return fail("No se pudieron copiar las opciones.");
    for (const copied of copiedOptions) {
      const source = sourceOptions[copied.position];
      if (source) newOptionId.set(source.id, copied.id);
    }
  }

  if (quote.items.length > 0) {
    const { error: itemsError } = await supabase.from("quote_items").insert(
      [...quote.items]
        .sort((a, b) => a.position - b.position)
        .map((i, idx) => ({
          agency_id: agency.id,
          quote_id: created.id,
          option_id: i.option_id ? newOptionId.get(i.option_id) ?? null : null,
          type: i.type,
          description: i.description,
          supplier_id: i.supplier_id,
          cost: i.cost,
          gross: i.gross,
          commission_pct: i.commission_pct,
          show_in_client_quote: i.show_in_client_quote,
          position: idx,
        })),
    );
    if (itemsError) return fail("No se pudieron copiar los ítems.");
  }

  revalidatePath("/presupuestos");
  return succeed({ quoteId: created.id, code: created.code });
}

/* ───────────────────────────────────────────
   setQuoteStatus — enviado / aceptado / rechazado
   ─────────────────────────────────────────── */

const statusSchema = z.object({
  quoteId: z.string().uuid(),
  status: z.enum(["borrador", "enviado", "aceptado", "rechazado", "vencido"]),
});

export async function setQuoteStatus(input: {
  quoteId: string;
  status: "borrador" | "enviado" | "aceptado" | "rechazado" | "vencido";
}): Promise<ActionResult<null>> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, member, agency } = await requireAction();

  const { data: quote } = await supabase
    .from("quotes")
    .select("id, code, sent_at, accepted_at, lead_id, contact_id, destination")
    .eq("id", parsed.data.quoteId)
    .single();
  if (!quote) return fail("No encontramos el presupuesto.");

  const patch: TablesUpdate<"quotes"> = { status: parsed.data.status };
  if (parsed.data.status === "enviado" && !quote.sent_at) patch.sent_at = new Date().toISOString();
  if (parsed.data.status === "aceptado" && !quote.accepted_at)
    patch.accepted_at = new Date().toISOString();

  const { error } = await supabase.from("quotes").update(patch).eq("id", quote.id);
  if (error) return fail("No se pudo actualizar el estado.");

  const bodies: Record<string, string> = {
    enviado: `Presupuesto ${quote.code} enviado`,
    aceptado: `Presupuesto ${quote.code} aceptado`,
    rechazado: `Presupuesto ${quote.code} rechazado`,
    vencido: `Presupuesto ${quote.code} vencido`,
    borrador: `Presupuesto ${quote.code} vuelto a borrador`,
  };
  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    leadId: quote.lead_id,
    contactId: quote.contact_id,
    type: "presupuesto",
    body: bodies[parsed.data.status],
    metadata: { quote_id: quote.id },
  });

  revalidatePath("/presupuestos");
  revalidatePath(`/presupuestos/${quote.id}`);
  return succeed(null);
}

/* ───────────────────────────────────────────
   convertQuoteDirect — venta directa sin lead.
   Misma distribución proporcional del markup que convertLeadToSale.
   ─────────────────────────────────────────── */

const convertSchema = z.object({ quoteId: z.string().uuid() });

export async function convertQuoteDirect(input: {
  quoteId: string;
}): Promise<ActionResult<{ fileId: string; fileCode: string }>> {
  const parsed = convertSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, member, agency } = await requireAction();

  const { data: quote } = await supabase
    .from("quotes")
    .select("*, items:quote_items(*), options:quote_options!quote_options_quote_id_fkey(*)")
    .eq("id", parsed.data.quoteId)
    .single();
  if (!quote) return fail("No encontramos el presupuesto.");
  if (quote.file_id) return fail("Este presupuesto ya tiene una venta creada.");
  if (!quote.contact_id)
    return fail("El presupuesto no tiene contacto asignado. Editalo y elegí uno.");

  const sale = selectQuoteSale(quote, quote.items, quote.options ?? []);

  // vendedor: quien creó el presupuesto, o quien convierte
  let sellerId = quote.created_by ?? member.id;
  let sellerCommission = member.commission_pct;
  if (quote.created_by && quote.created_by !== member.id) {
    const { data: seller } = await supabase
      .from("members")
      .select("id, commission_pct")
      .eq("id", quote.created_by)
      .maybeSingle();
    if (seller) {
      sellerId = seller.id;
      sellerCommission = seller.commission_pct;
    }
  }

  const { data: file, error: fileError } = await supabase
    .from("files")
    .insert({
      agency_id: agency.id,
      contact_id: quote.contact_id,
      lead_id: null,
      quote_id: quote.id,
      seller_id: sellerId,
      destination: quote.destination,
      departure_date: quote.trip_date_from,
      return_date: quote.trip_date_to,
      currency: quote.currency,
      commission_pct: sellerCommission,
      status: "vendido",
    })
    .select("id, code")
    .single();
  if (fileError || !file) return fail("No se pudo crear el file.");

  if (sale.saleItems.length > 0) {
    const totalCost = sale.saleItems.reduce((a, i) => a + Number(i.cost), 0);
    const factor = totalCost > 0 ? sale.totalPrice / totalCost : 1;
    let priceAcc = 0;
    const services = [...sale.saleItems]
      .sort((a, b) => a.position - b.position)
      .map((item, idx, arr) => {
        const isLast = idx === arr.length - 1;
        const price = isLast
          ? round2(sale.totalPrice - priceAcc)
          : round2(Number(item.cost) * factor);
        priceAcc = round2(priceAcc + price);
        return {
          agency_id: agency.id,
          file_id: file.id,
          type: item.type,
          description: item.description,
          supplier_id: item.supplier_id,
          date_from: quote.trip_date_from,
          date_to: quote.trip_date_to,
          cost: Number(item.cost),
          price,
          position: item.position,
        };
      });
    const { error: servicesError } = await supabase.from("file_services").insert(services);
    if (servicesError) {
      // deshacer el file para no dejar una venta "vacía" (total 0, saldo 0)
      await supabase.from("files").delete().eq("id", file.id);
      return fail("No se pudieron cargar los servicios del file. Probá de nuevo.");
    }
  }

  await supabase
    .from("quotes")
    .update({
      status: "aceptado",
      accepted_at: quote.accepted_at ?? new Date().toISOString(),
      accepted_option_id: sale.optionId,
      file_id: file.id,
    })
    .eq("id", quote.id);

  await supabase.from("contacts").update({ is_client: true }).eq("id", quote.contact_id);

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    contactId: quote.contact_id,
    fileId: file.id,
    type: "presupuesto",
    body: `Presupuesto ${quote.code} aceptado — se creó el file ${file.code}`,
    metadata: { quote_id: quote.id },
  });

  revalidatePath("/presupuestos");
  revalidatePath(`/presupuestos/${quote.id}`);
  revalidatePath("/files");
  return succeed({ fileId: file.id, fileCode: file.code });
}

/* ───────────────────────────────────────────
   convertQuote — despacho: con lead usa convertLeadToSale (core),
   sin lead usa convertQuoteDirect.
   ─────────────────────────────────────────── */

const convertWithOptionSchema = z.object({
  quoteId: z.string().uuid(),
  /** con qué opción cerró el cliente (si el presupuesto compara varias) */
  optionId: z.string().uuid().nullable().optional(),
});

export async function convertQuote(input: {
  quoteId: string;
  optionId?: string | null;
}): Promise<ActionResult<{ fileId: string; fileCode: string }>> {
  const parsed = convertWithOptionSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase } = await requireAction();

  const { data: quote } = await supabase
    .from("quotes")
    .select("id, lead_id, file_id")
    .eq("id", parsed.data.quoteId)
    .single();
  if (!quote) return fail("No encontramos el presupuesto.");
  if (quote.file_id) return fail("Este presupuesto ya tiene una venta creada.");

  // la opción elegida manda: se guarda antes de armar la venta
  if (parsed.data.optionId) {
    const { data: option } = await supabase
      .from("quote_options")
      .select("id")
      .eq("id", parsed.data.optionId)
      .eq("quote_id", quote.id)
      .maybeSingle();
    if (!option) return fail("No encontramos esa opción del presupuesto.");
    await supabase
      .from("quotes")
      .update({ accepted_option_id: option.id })
      .eq("id", quote.id);
  }

  const result = quote.lead_id
    ? await convertLeadToSale({ leadId: quote.lead_id, quoteId: quote.id })
    : await convertQuoteDirect({ quoteId: quote.id });

  if (result.ok) {
    revalidatePath("/presupuestos");
    revalidatePath(`/presupuestos/${quote.id}`);
    revalidatePath("/crm");
    revalidatePath("/files");
  }
  return result;
}

/* ───────────────────────────────────────────
   Settings de agencia: notas guardadas y tema default
   ─────────────────────────────────────────── */

const notesSchema = z.object({ notes: z.array(z.string().trim().min(1).max(500)).max(30) });

export async function updateSavedNotes(input: {
  notes: string[];
}): Promise<ActionResult<null>> {
  const parsed = notesSchema.safeParse(input);
  if (!parsed.success) return fail("La nota es demasiado larga.");
  const { supabase, agency } = await requireAction();

  const settings = (agency.settings ?? {}) as Partial<AgencySettings>;
  const next = { ...settings, quote_saved_notes: parsed.data.notes };

  const { error } = await supabase
    .from("agencies")
    .update({ settings: next as never })
    .eq("id", agency.id);
  if (error) return fail("No se pudo guardar la nota.");

  revalidatePath("/presupuestos");
  return succeed(null);
}

const themeSchema = z.object({ color: z.string().max(30), font: z.string().max(30) });

export async function updateDefaultTheme(input: {
  color: string;
  font: string;
}): Promise<ActionResult<null>> {
  const parsed = themeSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, agency } = await requireAction();

  const settings = (agency.settings ?? {}) as Partial<AgencySettings>;
  const next = { ...settings, quote_theme: parsed.data };

  const { error } = await supabase
    .from("agencies")
    .update({ settings: next as never })
    .eq("id", agency.id);
  if (error) return fail("No se pudo guardar el tema.");

  return succeed(null);
}
