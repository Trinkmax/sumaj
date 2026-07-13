"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  requireAction,
  succeed,
  fail,
  logActivity,
  convertLeadToSale,
  type ActionResult,
} from "@/lib/actions/core";
import { computeQuoteTotals, round2 } from "@/lib/domain";
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
  const { supabase, member, agency } = await requireAction();

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
  cost: z.number().min(0),
  gross: z.number().min(0).nullable(),
  commissionPct: z.number().min(0).max(100),
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
  pax: z.number().int().min(1).max(99),
  currency: z.enum(["USD", "ARS"]),
  validUntil: dateStr,
  markupType: z.enum(["monto", "porcentaje"]),
  markupValue: z.number().min(0),
  discount: z.number().min(0),
  notes: z.string().trim().max(2000).nullable(),
  internalNotes: z.string().trim().max(2000).nullable(),
  theme: z.object({ color: z.string(), font: z.string() }),
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

  // totales — el bruto vacío equivale al final (como la planilla)
  const totals = computeQuoteTotals({
    items: data.items.map((i) => ({
      cost: i.cost,
      gross: i.gross ?? i.cost,
      commission_pct: i.commissionPct,
      type: i.type,
    })),
    markup_type: data.markupType,
    markup_value: data.markupValue,
    discount: data.discount,
    pax: data.pax,
  });

  const nights = nightsBetween(data.tripDateFrom, data.tripDateTo);

  const quoteFields = {
    lead_id: data.leadId,
    contact_id: contactId,
    destination: data.destination,
    title: data.title,
    trip_date_from: data.tripDateFrom,
    trip_date_to: data.tripDateTo,
    nights,
    pax: data.pax,
    currency: data.currency,
    valid_until: data.validUntil,
    markup_type: data.markupType,
    markup_value: data.markupValue,
    discount: data.discount,
    notes: data.notes,
    internal_notes: data.internalNotes,
    theme: data.theme,
    total_cost: totals.totalCost,
    total_price: totals.totalPrice,
    commission_total: totals.commissionTotal,
    updated_at: new Date().toISOString(),
  };

  let quoteId: string;
  let code: string;
  let publicToken: string;
  let prevItemIds: string[] = [];

  if (data.id) {
    // update: mantener estado salvo que se envíe
    const { data: existing } = await supabase
      .from("quotes")
      .select("id, status, sent_at")
      .eq("id", data.id)
      .single();
    if (!existing) return fail("No encontramos el presupuesto.");

    // ítems previos: se borran DESPUÉS de insertar los nuevos, para no perder nada si falla
    const { data: prevItems, error: prevError } = await supabase
      .from("quote_items")
      .select("id")
      .eq("quote_id", data.id);
    if (prevError) return fail("No se pudo guardar el presupuesto.");
    prevItemIds = (prevItems ?? []).map((i) => i.id);

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

  // ítems: aéreos primero, después terrestres (orden de la planilla)
  const ordered = [
    ...data.items.filter((i) => i.type === "aereo"),
    ...data.items.filter((i) => i.type !== "aereo"),
  ];
  const { error: itemsError } = await supabase.from("quote_items").insert(
    ordered.map((i, idx) => ({
      agency_id: agency.id,
      quote_id: quoteId,
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

  if (data.send) {
    await logActivity({
      agencyId: agency.id,
      memberId: member.id,
      leadId: data.leadId,
      contactId,
      type: "presupuesto",
      body: `Presupuesto ${code} enviado — ${data.destination}`,
      metadata: { quote_id: quoteId, total_price: totals.totalPrice },
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
    .select("*, items:quote_items(*)")
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

  if (quote.items.length > 0) {
    const { error: itemsError } = await supabase.from("quote_items").insert(
      quote.items
        .sort((a, b) => a.position - b.position)
        .map((i, idx) => ({
          agency_id: agency.id,
          quote_id: created.id,
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
    aceptado: `Presupuesto ${quote.code} aceptado ✅`,
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
    .select("*, items:quote_items(*)")
    .eq("id", parsed.data.quoteId)
    .single();
  if (!quote) return fail("No encontramos el presupuesto.");
  if (quote.file_id) return fail("Este presupuesto ya tiene una venta creada.");
  if (!quote.contact_id)
    return fail("El presupuesto no tiene contacto asignado. Editalo y elegí uno.");

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

  if (quote.items.length > 0) {
    const totalCost = quote.items.reduce((a, i) => a + Number(i.cost), 0);
    const factor = totalCost > 0 ? Number(quote.total_price) / totalCost : 1;
    let priceAcc = 0;
    const services = quote.items
      .sort((a, b) => a.position - b.position)
      .map((item, idx, arr) => {
        const isLast = idx === arr.length - 1;
        const price = isLast
          ? round2(Number(quote.total_price) - priceAcc)
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
    body: `Presupuesto ${quote.code} aceptado 🎉 — se creó el file ${file.code}`,
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

export async function convertQuote(input: {
  quoteId: string;
}): Promise<ActionResult<{ fileId: string; fileCode: string }>> {
  const parsed = convertSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase } = await requireAction();

  const { data: quote } = await supabase
    .from("quotes")
    .select("id, lead_id, file_id")
    .eq("id", parsed.data.quoteId)
    .single();
  if (!quote) return fail("No encontramos el presupuesto.");
  if (quote.file_id) return fail("Este presupuesto ya tiene una venta creada.");

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
