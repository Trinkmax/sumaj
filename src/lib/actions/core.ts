/**
 * Núcleo compartido de server actions. NO lleva "use server":
 * son helpers que los módulos importan desde sus propios archivos de actions.
 */
import { createClient } from "@/lib/supabase/server";
import { getMemberContext, type MemberContext } from "@/lib/auth";
import { round2 } from "@/lib/domain";
import type { ActivityType, LeadStage, TablesInsert } from "@/lib/types";

export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function fail<T = null>(error: string): ActionResult<T> {
  return { ok: false, error };
}
export function succeed<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

/** Contexto autenticado para actions. Lanza si no hay sesión/membresía. */
export async function requireAction(): Promise<
  MemberContext & { supabase: Awaited<ReturnType<typeof createClient>> }
> {
  const ctx = await getMemberContext();
  if (!ctx) throw new Error("No autenticado");
  const supabase = await createClient();
  return { ...ctx, supabase };
}

/** Registra una entrada en el historial (best-effort, nunca corta el flujo). */
export async function logActivity(input: {
  agencyId: string;
  memberId?: string | null;
  leadId?: string | null;
  contactId?: string | null;
  fileId?: string | null;
  type: ActivityType;
  body: string;
  metadata?: Record<string, unknown>;
}) {
  const supabase = await createClient();
  await supabase.from("activities").insert({
    agency_id: input.agencyId,
    member_id: input.memberId ?? null,
    lead_id: input.leadId ?? null,
    contact_id: input.contactId ?? null,
    file_id: input.fileId ?? null,
    type: input.type,
    body: input.body,
    metadata: (input.metadata ?? {}) as TablesInsert<"activities">["metadata"],
  });
}

/** Posición nueva arriba de todo en una columna: min − 1 (0 si está vacía). */
export async function topPosition(
  supabase: Awaited<ReturnType<typeof requireAction>>["supabase"],
  stage: LeadStage,
  excludeLeadId?: string,
): Promise<number> {
  let query = supabase
    .from("leads")
    .select("position")
    .eq("stage", stage)
    .order("position", { ascending: true })
    .limit(1);
  if (excludeLeadId) query = query.neq("id", excludeLeadId);
  const { data } = await query;
  return data && data.length > 0 ? Number(data[0].position) - 1 : 0;
}

/**
 * Sucursal dueña de un lead: la del vendedor; si trabaja en todas (los admins),
 * la sucursal por defecto activa. Sin sucursal el seguimiento automático no
 * puede salir por el número de la sucursal y volvería a caer en plantillas pagas,
 * así que todo alta de lead tiene que pasar por acá.
 */
export async function resolveBranchId(
  supabase: Awaited<ReturnType<typeof requireAction>>["supabase"],
  agencyId: string,
  memberBranchId: string | null,
): Promise<string | null> {
  if (memberBranchId) return memberBranchId;

  const { data: defaultBranch } = await supabase
    .from("branches")
    .select("id")
    .eq("agency_id", agencyId)
    .eq("is_default", true)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  return defaultBranch?.id ?? null;
}

/** Devuelve (o crea) la conversación de WhatsApp de un contacto. */
export async function ensureConversation(
  contactId: string,
): Promise<ActionResult<{ conversationId: string }>> {
  const { supabase, agency, member } = await requireAction();

  // Un contacto puede tener DOS hilos de WhatsApp (número madre y sucursal):
  // se prioriza el de la sucursal, que es por donde se sigue la charla.
  const { data: existing } = await supabase
    .from("conversations")
    .select("id, branch_id, last_message_at")
    .eq("agency_id", agency.id)
    .eq("contact_id", contactId)
    .eq("channel", "whatsapp")
    .order("branch_id", { ascending: false, nullsFirst: false })
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(1);

  if (existing && existing.length > 0) return succeed({ conversationId: existing[0].id });

  const { data: contact } = await supabase
    .from("contacts")
    .select("phone")
    .eq("id", contactId)
    .single();

  // sin hilo previo, el chat arranca en el número madre de la agencia
  const { data: mother } = await supabase
    .from("wa_channels")
    .select("id")
    .eq("agency_id", agency.id)
    .eq("is_mother", true)
    .maybeSingle();

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({
      agency_id: agency.id,
      contact_id: contactId,
      channel: "whatsapp",
      channel_id: mother?.id ?? null,
      wa_id: contact?.phone ?? null,
      assigned_to: member.id,
    })
    .select("id")
    .single();

  if (error || !created) return fail("No se pudo abrir la conversación.");
  return succeed({ conversationId: created.id });
}

/**
 * Un presupuesto puede tener varias opciones ("con este hotel vale 10, con este
 * otro 15"). Al vender, van a la venta los servicios comunes + los de la opción
 * elegida, y el precio es el de esa opción.
 */
export function selectQuoteSale<
  I extends { option_id: string | null; cost: number | string; position: number },
  O extends { id: string; is_recommended: boolean; total_price: number | string },
>(
  quote: { total_price: number | string; accepted_option_id: string | null },
  items: I[],
  options: O[],
): { saleItems: I[]; totalPrice: number; optionId: string | null } {
  const optionId =
    (quote.accepted_option_id && options.some((o) => o.id === quote.accepted_option_id)
      ? quote.accepted_option_id
      : null) ??
    options.find((o) => o.is_recommended)?.id ??
    options[0]?.id ??
    null;

  const selected = options.find((o) => o.id === optionId) ?? null;
  return {
    saleItems: items.filter((i) => i.option_id === null || i.option_id === optionId),
    totalPrice: Number(selected ? selected.total_price : quote.total_price),
    optionId,
  };
}

/**
 * Convierte un lead en venta (file). Si hay presupuesto, arma los servicios
 * a partir de sus ítems distribuyendo el markup proporcionalmente para que
 * Σ precio de venta = Precio Cliente del presupuesto.
 * El dato entra una vez y fluye: lead → file → cliente, sin retipear.
 */
export async function convertLeadToSale(input: {
  leadId: string;
  quoteId?: string | null;
}): Promise<ActionResult<{ fileId: string; fileCode: string }>> {
  const { supabase, agency, member } = await requireAction();

  const { data: lead } = await supabase
    .from("leads")
    .select("*, contact:contacts(id, full_name)")
    .eq("id", input.leadId)
    .single();
  if (!lead) return fail("Lead no encontrado.");
  if (lead.won_file_id) return fail("Este lead ya tiene una venta creada.");

  // presupuesto: el indicado, o el último enviado/aceptado del lead
  const QUOTE_SELECT = "*, items:quote_items(*), options:quote_options!quote_options_quote_id_fkey(*)";
  let quote = null;
  if (input.quoteId) {
    const { data } = await supabase
      .from("quotes")
      .select(QUOTE_SELECT)
      .eq("id", input.quoteId)
      .single();
    quote = data;
  } else {
    const { data } = await supabase
      .from("quotes")
      .select(QUOTE_SELECT)
      .eq("lead_id", input.leadId)
      .in("status", ["aceptado", "enviado"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    quote = data;
  }

  // vendedor del file: el asignado al lead, o quien convierte
  let sellerId = lead.assigned_to ?? member.id;
  let sellerCommission = member.commission_pct;
  if (lead.assigned_to && lead.assigned_to !== member.id) {
    const { data: seller } = await supabase
      .from("members")
      .select("id, commission_pct")
      .eq("id", lead.assigned_to)
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
      contact_id: lead.contact_id,
      lead_id: lead.id,
      quote_id: quote?.id ?? null,
      seller_id: sellerId,
      destination: quote?.destination ?? lead.destination ?? "A definir",
      departure_date: quote?.trip_date_from ?? lead.trip_date_from,
      return_date: quote?.trip_date_to ?? lead.trip_date_to,
      currency: quote?.currency ?? "USD",
      commission_pct: sellerCommission,
      status: "vendido",
      // nace del pipeline: los montos y servicios vienen del presupuesto,
      // así que la venta entra en revisión hasta que un admin la valide
      review_status: "pendiente",
    })
    .select("id, code")
    .single();

  if (fileError || !file) return fail("No se pudo crear el file.");

  // servicios desde el presupuesto, con markup distribuido proporcionalmente
  const sale = quote ? selectQuoteSale(quote, quote.items, quote.options ?? []) : null;
  if (quote && sale && sale.saleItems.length > 0) {
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
      // sin transacción entre round-trips: si fallan los servicios,
      // deshacemos el file para no dejar una venta "vacía" (total 0, saldo 0)
      await supabase.from("files").delete().eq("id", file.id);
      return fail("No se pudieron cargar los servicios del file. Probá de nuevo.");
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
  }

  await supabase
    .from("leads")
    .update({
      stage: "ganado",
      won_file_id: file.id,
      closed_at: new Date().toISOString(),
    })
    .eq("id", lead.id);

  await supabase.from("contacts").update({ is_client: true }).eq("id", lead.contact_id);

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    leadId: lead.id,
    contactId: lead.contact_id,
    fileId: file.id,
    type: "etapa",
    body: `Lead ganado — se creó el file ${file.code}`,
  });

  return succeed({ fileId: file.id, fileCode: file.code });
}
