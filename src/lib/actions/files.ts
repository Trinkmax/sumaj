"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import {
  requireAction,
  succeed,
  fail,
  logActivity,
  type ActionResult,
} from "@/lib/actions/core";
import { COMMISSION_TYPES, FILE_STATUSES } from "@/lib/domain";
import type { TablesInsert, TablesUpdate } from "@/lib/types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateField = z.string().regex(DATE_RE).nullable().optional();

/** jsonb de file_services.images — el cast evita pelear con el tipo Json generado */
type ImagesColumn = TablesInsert<"file_services">["images"];

const FILE_STATUS_KEYS = [
  "vendido",
  "pagado",
  "en_curso",
  "finalizado",
  "cancelado",
] as const;

const SERVICE_TYPE_KEYS = [
  "aereo",
  "hotel",
  "paquete",
  "excursion",
  "traslado",
  "asistencia",
  "circuito",
  "crucero",
  "otro",
] as const;

const DOCUMENT_TYPE_KEYS = ["dni", "pasaporte", "visa", "otro"] as const;

const COMMISSION_TYPE_KEYS = ["utilidad_pct", "monto_fijo"] as const;

/** imagen del servicio (voucher / comprobante) ya subida al bucket privado */
const serviceImageSchema = z.object({
  path: z.string().trim().min(1).max(400),
  name: z.string().trim().max(160),
});

function revalidateFile(fileId: string) {
  revalidatePath("/files");
  revalidatePath(`/files/${fileId}`);
}

/* ───────────────────────────────────────────
   Crear file (carga directa, sin pasar por el CRM)
   ─────────────────────────────────────────── */
const createFileSchema = z.object({
  contactId: z.string().uuid(),
  destination: z.string().trim().min(2, "Destino muy corto").max(120),
  departureDate: dateField,
  returnDate: dateField,
  sellerId: z.string().uuid().nullable().optional(),
  currency: z.enum(["USD", "ARS"]),
});

export async function createFile(
  input: z.infer<typeof createFileSchema>,
): Promise<ActionResult<{ fileId: string; code: string }>> {
  const parsed = createFileSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos. Revisá el destino y las fechas.");
  const { supabase, member, agency } = await requireAction();

  // el sellerId del cliente solo vale si es un member activo de la agencia; si no, va el propio
  let sellerId = member.id;
  let commissionPct = member.commission_pct;
  if (parsed.data.sellerId && parsed.data.sellerId !== member.id) {
    const { data: seller } = await supabase
      .from("members")
      .select("id, commission_pct")
      .eq("id", parsed.data.sellerId)
      .eq("agency_id", agency.id)
      .eq("is_active", true)
      .maybeSingle();
    if (seller) {
      sellerId = seller.id;
      commissionPct = seller.commission_pct;
    }
  }

  const { data: file, error } = await supabase
    .from("files")
    .insert({
      agency_id: agency.id,
      contact_id: parsed.data.contactId,
      seller_id: sellerId,
      destination: parsed.data.destination,
      departure_date: parsed.data.departureDate ?? null,
      return_date: parsed.data.returnDate ?? null,
      currency: parsed.data.currency,
      commission_pct: commissionPct,
      status: "vendido",
    })
    .select("id, code")
    .single();

  if (error || !file) return fail("No se pudo crear el file. Probá de nuevo.");

  await supabase.from("contacts").update({ is_client: true }).eq("id", parsed.data.contactId);

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    contactId: parsed.data.contactId,
    fileId: file.id,
    type: "sistema",
    body: `Se creó el file ${file.code} — ${parsed.data.destination}`,
  });

  revalidatePath("/files");
  return succeed({ fileId: file.id, code: file.code });
}

/* ───────────────────────────────────────────
   Editar file (fechas / notas)
   ─────────────────────────────────────────── */
const updateFileSchema = z.object({
  fileId: z.string().uuid(),
  departureDate: dateField,
  returnDate: dateField,
  notes: z.string().max(4000).nullable().optional(),
});

export async function updateFile(
  input: z.infer<typeof updateFileSchema>,
): Promise<ActionResult<null>> {
  const parsed = updateFileSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos. Revisá las fechas.");
  const { supabase } = await requireAction();

  const patch: TablesUpdate<"files"> = {};
  if (parsed.data.departureDate !== undefined) patch.departure_date = parsed.data.departureDate;
  if (parsed.data.returnDate !== undefined) patch.return_date = parsed.data.returnDate;
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;
  if (Object.keys(patch).length === 0) return succeed(null);

  const { error } = await supabase.from("files").update(patch).eq("id", parsed.data.fileId);
  if (error) return fail("No se pudo guardar. Probá de nuevo.");

  revalidateFile(parsed.data.fileId);
  return succeed(null);
}

/* ───────────────────────────────────────────
   Cambiar estado del file
   ─────────────────────────────────────────── */
const statusSchema = z.object({
  fileId: z.string().uuid(),
  status: z.enum(FILE_STATUS_KEYS),
});

export async function updateFileStatus(
  input: z.infer<typeof statusSchema>,
): Promise<ActionResult<null>> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return fail("Estado inválido.");
  const { supabase, member, agency } = await requireAction();

  const { data: file, error } = await supabase
    .from("files")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.fileId)
    .select("id, code, contact_id")
    .single();
  if (error || !file) return fail("No se pudo cambiar el estado.");

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    contactId: file.contact_id,
    fileId: file.id,
    type: "etapa",
    body: `El file ${file.code} pasó a ${FILE_STATUSES[parsed.data.status].label}`,
    metadata: { status: parsed.data.status },
  });

  revalidateFile(parsed.data.fileId);
  return succeed(null);
}

/* ───────────────────────────────────────────
   Revisión de la venta.
   Las ventas que nacen del pipeline entran en "pendiente": los servicios y
   montos llegan del presupuesto y conviene que un admin los mire antes de
   darlos por buenos. Las cargadas a mano ya nacen revisadas.
   ─────────────────────────────────────────── */
const reviewSchema = z.object({
  fileId: z.string().uuid(),
  reviewed: z.boolean(),
});

export async function markFileReviewed(
  input: z.infer<typeof reviewSchema>,
): Promise<ActionResult<null>> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, member, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail("La revisión la cierra un admin.");

  const { reviewed } = parsed.data;

  const { data: file, error } = await supabase
    .from("files")
    .update({
      review_status: reviewed ? "revisado" : "pendiente",
      reviewed_at: reviewed ? new Date().toISOString() : null,
      reviewed_by: reviewed ? member.id : null,
    })
    .eq("id", parsed.data.fileId)
    .select("id, code, contact_id")
    .single();

  if (error || !file) return fail("No se pudo guardar la revisión. Probá de nuevo.");

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    contactId: file.contact_id,
    fileId: file.id,
    type: "sistema",
    // el historial ya muestra quién lo hizo: el cuerpo solo dice qué pasó
    body: reviewed
      ? `La venta ${file.code} quedó revisada`
      : `La venta ${file.code} volvió a revisión`,
    metadata: { review_status: reviewed ? "revisado" : "pendiente" },
  });

  revalidateFile(parsed.data.fileId);
  return succeed(null);
}

/* ───────────────────────────────────────────
   Esquema de comisión del vendedor sobre esta venta.
   · utilidad_pct → % sobre la utilidad del file (lo de siempre)
   · monto_fijo   → monto plano por venta (enlatados: "Grupal Europa, USD 100")
   Solo un admin de la agencia lo define.
   ─────────────────────────────────────────── */
const commissionSchema = z.object({
  fileId: z.string().uuid(),
  commissionType: z.enum(COMMISSION_TYPE_KEYS),
  commissionPct: z.number().min(0).max(100),
  commissionAmount: z.number().min(0).max(99_000_000),
  commissionLabel: z.string().trim().max(40).nullable().optional(),
});

export async function updateFileCommission(
  input: z.infer<typeof commissionSchema>,
): Promise<ActionResult<null>> {
  const parsed = commissionSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos. Revisá el porcentaje y el monto.");
  const { supabase, member, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail("Esto lo maneja un admin de la agencia.");

  const label = parsed.data.commissionLabel?.trim() || null;

  const { data: file, error } = await supabase
    .from("files")
    .update({
      commission_type: parsed.data.commissionType,
      commission_pct: parsed.data.commissionPct,
      commission_amount: parsed.data.commissionAmount,
      commission_label: label,
    })
    .eq("id", parsed.data.fileId)
    .select("id, code, currency, contact_id")
    .single();

  if (error || !file) return fail("No se pudo guardar la comisión.");

  const detalle =
    parsed.data.commissionType === "monto_fijo"
      ? `${file.currency} ${parsed.data.commissionAmount}${label ? ` (${label})` : ""}`
      : `${parsed.data.commissionPct}% de la utilidad`;

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    contactId: file.contact_id,
    fileId: file.id,
    type: "sistema",
    body: `Comisión del vendedor: ${COMMISSION_TYPES[parsed.data.commissionType].label} — ${detalle}`,
    metadata: {
      commission_type: parsed.data.commissionType,
      commission_pct: parsed.data.commissionPct,
      commission_amount: parsed.data.commissionAmount,
      commission_label: label,
    },
  });

  revalidateFile(parsed.data.fileId);
  revalidatePath("/caja");
  return succeed(null);
}

/* ───────────────────────────────────────────
   Servicios del file
   ─────────────────────────────────────────── */
const serviceFields = {
  type: z.enum(SERVICE_TYPE_KEYS),
  description: z.string().trim().min(1, "Falta la descripción").max(200),
  supplierId: z.string().uuid().nullable().optional(),
  reservationCode: z.string().trim().max(60).nullable().optional(),
  dateFrom: dateField,
  dateTo: dateField,
  /** hasta cuándo hay tiempo de pagarle al proveedor: si se pasa, se cae la reserva */
  deadlineDate: dateField,
  images: z.array(serviceImageSchema).max(6).optional(),
  cost: z.number().min(0).max(99_000_000),
  price: z.number().min(0).max(99_000_000),
};

const addServiceSchema = z.object({ fileId: z.string().uuid(), ...serviceFields });

export async function addService(
  input: z.infer<typeof addServiceSchema>,
): Promise<ActionResult<{ serviceId: string }>> {
  const parsed = addServiceSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos. Revisá la descripción y los montos.");
  const { supabase, agency } = await requireAction();

  const { data: last } = await supabase
    .from("file_services")
    .select("position")
    .eq("file_id", parsed.data.fileId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: created, error } = await supabase
    .from("file_services")
    .insert({
      agency_id: agency.id,
      file_id: parsed.data.fileId,
      type: parsed.data.type,
      description: parsed.data.description,
      supplier_id: parsed.data.supplierId ?? null,
      reservation_code: parsed.data.reservationCode || null,
      date_from: parsed.data.dateFrom ?? null,
      date_to: parsed.data.dateTo ?? null,
      deadline_date: parsed.data.deadlineDate ?? null,
      images: (parsed.data.images ?? []) as unknown as ImagesColumn,
      cost: parsed.data.cost,
      price: parsed.data.price,
      position: (last?.position ?? 0) + 1,
    })
    .select("id")
    .single();

  if (error || !created) return fail("No se pudo agregar el servicio.");

  revalidateFile(parsed.data.fileId);
  return succeed({ serviceId: created.id });
}

const updateServiceSchema = z.object({
  serviceId: z.string().uuid(),
  fileId: z.string().uuid(),
  ...serviceFields,
});

export async function updateService(
  input: z.infer<typeof updateServiceSchema>,
): Promise<ActionResult<null>> {
  const parsed = updateServiceSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos. Revisá la descripción y los montos.");
  const { supabase } = await requireAction();

  const patch: TablesUpdate<"file_services"> = {
    type: parsed.data.type,
    description: parsed.data.description,
    supplier_id: parsed.data.supplierId ?? null,
    reservation_code: parsed.data.reservationCode || null,
    date_from: parsed.data.dateFrom ?? null,
    date_to: parsed.data.dateTo ?? null,
    deadline_date: parsed.data.deadlineDate ?? null,
    cost: parsed.data.cost,
    price: parsed.data.price,
  };
  // si el caller no manda imágenes, no las tocamos (no las borra por omisión)
  if (parsed.data.images !== undefined) {
    patch.images = parsed.data.images as unknown as ImagesColumn;
  }

  const { error } = await supabase
    .from("file_services")
    .update(patch)
    .eq("id", parsed.data.serviceId);

  if (error) return fail("No se pudo guardar el servicio.");

  revalidateFile(parsed.data.fileId);
  return succeed(null);
}

const deleteServiceSchema = z.object({
  serviceId: z.string().uuid(),
  fileId: z.string().uuid(),
});

export async function deleteService(
  input: z.infer<typeof deleteServiceSchema>,
): Promise<ActionResult<null>> {
  const parsed = deleteServiceSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase } = await requireAction();

  const { error } = await supabase
    .from("file_services")
    .delete()
    .eq("id", parsed.data.serviceId);
  if (error) return fail("No se pudo eliminar el servicio.");

  revalidateFile(parsed.data.fileId);
  return succeed(null);
}

const togglePaidSchema = z.object({
  serviceId: z.string().uuid(),
  fileId: z.string().uuid(),
  paid: z.boolean(),
});

export async function toggleServicePaid(
  input: z.infer<typeof togglePaidSchema>,
): Promise<ActionResult<null>> {
  const parsed = togglePaidSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase } = await requireAction();

  const { error } = await supabase
    .from("file_services")
    .update({ paid_to_supplier: parsed.data.paid })
    .eq("id", parsed.data.serviceId);
  if (error) return fail("No se pudo actualizar el pago al proveedor.");

  revalidateFile(parsed.data.fileId);
  return succeed(null);
}

/* ───────────────────────────────────────────
   Pasajeros del file
   ─────────────────────────────────────────── */
const linkTravelerSchema = z.object({
  fileId: z.string().uuid(),
  travelerId: z.string().uuid(),
});

export async function linkTraveler(
  input: z.infer<typeof linkTravelerSchema>,
): Promise<ActionResult<null>> {
  const parsed = linkTravelerSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, agency } = await requireAction();

  const { error } = await supabase.from("file_travelers").upsert(
    {
      agency_id: agency.id,
      file_id: parsed.data.fileId,
      traveler_id: parsed.data.travelerId,
    },
    { onConflict: "file_id,traveler_id", ignoreDuplicates: true },
  );
  if (error) return fail("No se pudo agregar el pasajero.");

  revalidateFile(parsed.data.fileId);
  return succeed(null);
}

export async function unlinkTraveler(
  input: z.infer<typeof linkTravelerSchema>,
): Promise<ActionResult<null>> {
  const parsed = linkTravelerSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase } = await requireAction();

  const { error } = await supabase
    .from("file_travelers")
    .delete()
    .eq("file_id", parsed.data.fileId)
    .eq("traveler_id", parsed.data.travelerId);
  if (error) return fail("No se pudo quitar el pasajero.");

  revalidateFile(parsed.data.fileId);
  return succeed(null);
}

/** Crea un traveler del contacto del file y lo vincula al file en un paso. */
const createTravelerSchema = z.object({
  fileId: z.string().uuid(),
  fullName: z.string().trim().min(2, "Nombre muy corto").max(120),
  documentType: z.enum(DOCUMENT_TYPE_KEYS).nullable().optional(),
  documentNumber: z.string().trim().max(40).nullable().optional(),
  documentExpiry: dateField,
  birthDate: dateField,
});

export async function createTravelerForFile(
  input: z.infer<typeof createTravelerSchema>,
): Promise<ActionResult<{ travelerId: string }>> {
  const parsed = createTravelerSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos. Revisá el nombre y el documento.");
  const { supabase, agency } = await requireAction();

  const { data: file } = await supabase
    .from("files")
    .select("contact_id")
    .eq("id", parsed.data.fileId)
    .maybeSingle();
  if (!file) return fail("File no encontrado.");

  const { data: traveler, error } = await supabase
    .from("travelers")
    .insert({
      agency_id: agency.id,
      contact_id: file.contact_id,
      full_name: parsed.data.fullName,
      document_type: parsed.data.documentType ?? null,
      document_number: parsed.data.documentNumber || null,
      document_expiry: parsed.data.documentExpiry ?? null,
      birth_date: parsed.data.birthDate ?? null,
    })
    .select("id")
    .single();
  if (error || !traveler) return fail("No se pudo crear el pasajero.");

  const { error: linkError } = await supabase.from("file_travelers").insert({
    agency_id: agency.id,
    file_id: parsed.data.fileId,
    traveler_id: traveler.id,
  });
  if (linkError) return fail("Se creó el pasajero pero no se pudo vincular al file.");

  revalidateFile(parsed.data.fileId);
  return succeed({ travelerId: traveler.id });
}
