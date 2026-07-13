/**
 * Núcleo compartido de server actions. NO lleva "use server":
 * son helpers que los módulos importan desde sus propios archivos de actions.
 */
import { createClient } from "@/lib/supabase/server";
import { getMemberContext, type MemberContext } from "@/lib/auth";
import { round2 } from "@/lib/domain";
import type { ActivityType, TablesInsert } from "@/lib/types";

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

/** Devuelve (o crea) la conversación de WhatsApp de un contacto. */
export async function ensureConversation(
  contactId: string,
): Promise<ActionResult<{ conversationId: string }>> {
  const { supabase, agency, member } = await requireAction();

  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("agency_id", agency.id)
    .eq("contact_id", contactId)
    .eq("channel", "whatsapp")
    .maybeSingle();

  if (existing) return succeed({ conversationId: existing.id });

  const { data: contact } = await supabase
    .from("contacts")
    .select("phone")
    .eq("id", contactId)
    .single();

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({
      agency_id: agency.id,
      contact_id: contactId,
      channel: "whatsapp",
      wa_id: contact?.phone ?? null,
      assigned_to: member.id,
    })
    .select("id")
    .single();

  if (error || !created) return fail("No se pudo abrir la conversación.");
  return succeed({ conversationId: created.id });
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
  let quote = null;
  if (input.quoteId) {
    const { data } = await supabase
      .from("quotes")
      .select("*, items:quote_items(*)")
      .eq("id", input.quoteId)
      .single();
    quote = data;
  } else {
    const { data } = await supabase
      .from("quotes")
      .select("*, items:quote_items(*)")
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
    })
    .select("id, code")
    .single();

  if (fileError || !file) return fail("No se pudo crear el file.");

  // servicios desde el presupuesto, con markup distribuido proporcionalmente
  if (quote && quote.items.length > 0) {
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
