"use server";

import { z } from "zod";
import { requireAction, succeed, fail, type ActionResult } from "@/lib/actions/core";
import type { SearchResults } from "@/components/shell/command-palette";

const schema = z.object({ q: z.string().trim().min(1).max(80) });

const LIMIT = 5;

function dedupe<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Map<string, T>();
  for (const r of rows) if (!seen.has(r.id)) seen.set(r.id, r);
  return [...seen.values()].slice(0, LIMIT);
}

/**
 * Búsqueda global (⌘K): clientes, leads, files, presupuestos y chats.
 * RLS ya aísla por agencia; acá solo filtramos por texto.
 */
export async function globalSearch(input: {
  q: string;
}): Promise<ActionResult<SearchResults>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail("Búsqueda inválida.");
  const { supabase } = await requireAction();

  // coma y paréntesis rompen el filtro or() de PostgREST → los neutralizamos
  const term = parsed.data.q.replace(/[,()]/g, " ").replace(/\s+/g, " ").trim();
  const empty: SearchResults = {
    contacts: [],
    leads: [],
    files: [],
    quotes: [],
    conversations: [],
  };
  if (!term) return succeed(empty);

  const like = `%${term}%`;
  const digits = parsed.data.q.replace(/\D/g, "");

  const contactOr = [
    `full_name.ilike.${like}`,
    `phone.ilike.${like}`,
    `email.ilike.${like}`,
    // teléfonos: también por dígitos normalizados ("351 555" → "351555")
    ...(digits.length >= 3 ? [`phone.ilike.%${digits}%`] : []),
  ].join(",");

  // 1) contactos primero: sus ids alimentan leads/files/chats
  const { data: contacts, error: contactsError } = await supabase
    .from("contacts")
    .select("id, full_name, phone, is_client")
    .or(contactOr)
    .order("updated_at", { ascending: false })
    .limit(LIMIT);

  if (contactsError) return fail("No se pudo buscar. Probá de nuevo.");

  const contactIds = (contacts ?? []).map((c) => c.id);

  // 2) el resto en paralelo (.in() con lista vacía devuelve vacío, no falla)
  const [leadsByDest, leadsByContact, filesByText, filesByContact, quotesRes, convsRes] =
    await Promise.all([
      supabase
        .from("leads")
        .select("id, destination, stage, contact:contacts(full_name)")
        .ilike("destination", like)
        .order("updated_at", { ascending: false })
        .limit(LIMIT),
      supabase
        .from("leads")
        .select("id, destination, stage, contact:contacts(full_name)")
        .in("contact_id", contactIds)
        .order("updated_at", { ascending: false })
        .limit(LIMIT),
      supabase
        .from("files")
        .select("id, code, destination, status, contact:contacts(full_name)")
        .or(`code.ilike.${like},destination.ilike.${like}`)
        .order("created_at", { ascending: false })
        .limit(LIMIT),
      supabase
        .from("files")
        .select("id, code, destination, status, contact:contacts(full_name)")
        .in("contact_id", contactIds)
        .order("created_at", { ascending: false })
        .limit(LIMIT),
      supabase
        .from("quotes")
        .select("id, code, destination, status, total_price, currency")
        .or(`code.ilike.${like},destination.ilike.${like},title.ilike.${like}`)
        .order("created_at", { ascending: false })
        .limit(LIMIT),
      supabase
        .from("conversations")
        .select("id, last_message_preview, contact:contacts(full_name)")
        .in("contact_id", contactIds)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(LIMIT),
    ]);

  const leads = dedupe([...(leadsByDest.data ?? []), ...(leadsByContact.data ?? [])]);
  const files = dedupe([...(filesByText.data ?? []), ...(filesByContact.data ?? [])]);

  return succeed({
    contacts: (contacts ?? []).map((c) => ({
      id: c.id,
      name: c.full_name,
      phone: c.phone,
      isClient: c.is_client,
    })),
    leads: leads.map((l) => ({
      id: l.id,
      contactName: l.contact?.full_name ?? "Sin nombre",
      destination: l.destination,
      stage: l.stage,
    })),
    files: files.map((f) => ({
      id: f.id,
      code: f.code,
      destination: f.destination,
      contactName: f.contact?.full_name ?? "Sin nombre",
      status: f.status,
    })),
    quotes: (quotesRes.data ?? []).map((q) => ({
      id: q.id,
      code: q.code,
      destination: q.destination,
      status: q.status,
      totalPrice: Number(q.total_price),
      currency: q.currency,
    })),
    conversations: (convsRes.data ?? []).map((c) => ({
      id: c.id,
      contactName: c.contact?.full_name ?? "Sin nombre",
      lastPreview: c.last_message_preview,
    })),
  });
}
