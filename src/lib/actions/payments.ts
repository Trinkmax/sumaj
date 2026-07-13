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
import { round2 } from "@/lib/domain";
import { fmtMoney } from "@/lib/format";

const PAYMENT_METHOD_KEYS = [
  "efectivo",
  "transferencia",
  "tarjeta",
  "mercado_pago",
  "deposito",
  "otro",
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ───────────────────────────────────────────
   Registrar un cobro (dirección: cobro)
   ─────────────────────────────────────────── */
const registerPaymentSchema = z.object({
  fileId: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.string().min(2).max(5),
  exchangeRate: z.number().positive().nullable().optional(),
  method: z.enum(PAYMENT_METHOD_KEYS),
  note: z.string().max(500).optional(),
  paidAt: z.string().regex(DATE_RE),
});

export async function registerPayment(
  input: z.infer<typeof registerPaymentSchema>,
): Promise<
  ActionResult<{
    paymentId: string;
    receiptCode: string;
    receiptToken: string;
    newBalance: number;
  }>
> {
  const parsed = registerPaymentSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos. Revisá el monto y la fecha.");
  const { fileId, amount, currency, exchangeRate, method, note, paidAt } = parsed.data;

  const { supabase, member, agency } = await requireAction();

  const { data: file } = await supabase
    .from("files")
    .select("id, code, currency, contact_id, status")
    .eq("id", fileId)
    .maybeSingle();
  if (!file) return fail("No encontramos el file.");

  let amountInFileCurrency = amount;
  let rate: number | null = null;
  if (currency !== file.currency) {
    if (!exchangeRate) return fail("Falta la cotización para convertir el monto.");
    rate = exchangeRate;
    amountInFileCurrency = round2(amount / exchangeRate);
  }

  const { data: payment, error } = await supabase
    .from("payments")
    .insert({
      agency_id: agency.id,
      file_id: file.id,
      contact_id: file.contact_id,
      direction: "cobro",
      amount: round2(amount),
      currency,
      exchange_rate: rate,
      amount_in_file_currency: amountInFileCurrency,
      method,
      note: note?.trim() || null,
      paid_at: paidAt,
      received_by: member.id,
    })
    .select("id, receipt_code, receipt_token")
    .single();

  if (error || !payment) return fail("No se pudo registrar el cobro. Probá de nuevo.");

  const { data: totals } = await supabase
    .from("file_totals")
    .select("balance")
    .eq("file_id", file.id)
    .maybeSingle();
  const newBalance = round2(Number(totals?.balance ?? 0));

  if (newBalance <= 0 && file.status === "vendido") {
    await supabase.from("files").update({ status: "pagado" }).eq("id", file.id);
  }

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    contactId: file.contact_id,
    fileId: file.id,
    type: "sistema",
    body: `Cobro registrado: ${fmtMoney(amount, currency)} — recibo ${payment.receipt_code}`,
  });

  revalidatePath("/caja");
  revalidatePath("/files");
  revalidatePath(`/files/${file.id}`);

  return succeed({
    paymentId: payment.id,
    receiptCode: payment.receipt_code ?? "",
    receiptToken: payment.receipt_token,
    newBalance,
  });
}

/* ───────────────────────────────────────────
   Registrar un pago a proveedor
   (siempre en la moneda del file: no requiere cotización)
   ─────────────────────────────────────────── */
const registerSupplierPaymentSchema = z.object({
  supplierId: z.string().uuid(),
  fileId: z.string().uuid(),
  amount: z.number().positive(),
  method: z.enum(PAYMENT_METHOD_KEYS),
  note: z.string().max(500).optional(),
  paidAt: z.string().regex(DATE_RE),
});

export async function registerSupplierPayment(
  input: z.infer<typeof registerSupplierPaymentSchema>,
): Promise<ActionResult<{ paymentId: string }>> {
  const parsed = registerSupplierPaymentSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos. Revisá el monto y la fecha.");
  const { supplierId, fileId, amount, method, note, paidAt } = parsed.data;

  const { supabase, member, agency } = await requireAction();

  const [{ data: file }, { data: supplier }] = await Promise.all([
    supabase.from("files").select("id, code, currency").eq("id", fileId).maybeSingle(),
    supabase.from("suppliers").select("id, name").eq("id", supplierId).maybeSingle(),
  ]);
  if (!file) return fail("No encontramos el file.");
  if (!supplier) return fail("No encontramos el proveedor.");

  const { data: payment, error } = await supabase
    .from("payments")
    .insert({
      agency_id: agency.id,
      file_id: file.id,
      supplier_id: supplier.id,
      direction: "pago_proveedor",
      amount: round2(amount),
      currency: file.currency,
      amount_in_file_currency: round2(amount),
      method,
      note: note?.trim() || null,
      paid_at: paidAt,
      received_by: member.id,
    })
    .select("id")
    .single();

  if (error || !payment) return fail("No se pudo registrar el pago. Probá de nuevo.");

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    fileId: file.id,
    type: "sistema",
    body: `Pago a proveedor ${supplier.name}: ${fmtMoney(amount, file.currency)} — file ${file.code}`,
  });

  revalidatePath("/caja");
  revalidatePath(`/files/${file.id}`);

  return succeed({ paymentId: payment.id });
}

/* ───────────────────────────────────────────
   Eliminar un movimiento (solo admin)
   ─────────────────────────────────────────── */
const deletePaymentSchema = z.object({ paymentId: z.string().uuid() });

export async function deletePayment(
  input: z.infer<typeof deletePaymentSchema>,
): Promise<ActionResult<null>> {
  const parsed = deletePaymentSchema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");

  const { supabase, member, agency, isAdmin } = await requireAction();
  if (!isAdmin) return fail("Solo un admin puede eliminar movimientos.");

  const { data: payment } = await supabase
    .from("payments")
    .select("id, file_id, direction, amount, currency, receipt_code, file:files(id, code, status)")
    .eq("id", parsed.data.paymentId)
    .maybeSingle();
  if (!payment) return fail("No encontramos el movimiento.");

  const { error } = await supabase.from("payments").delete().eq("id", payment.id);
  if (error) return fail("No se pudo eliminar el movimiento.");

  // si el file estaba "pagado" y volvió a tener saldo, lo devolvemos a "vendido"
  if (payment.direction === "cobro" && payment.file?.status === "pagado") {
    const { data: totals } = await supabase
      .from("file_totals")
      .select("balance")
      .eq("file_id", payment.file_id)
      .maybeSingle();
    if (Number(totals?.balance ?? 0) > 0) {
      await supabase.from("files").update({ status: "vendido" }).eq("id", payment.file_id);
    }
  }

  await logActivity({
    agencyId: agency.id,
    memberId: member.id,
    fileId: payment.file_id,
    type: "sistema",
    body: `Movimiento eliminado: ${fmtMoney(Number(payment.amount), payment.currency)}${
      payment.receipt_code ? ` (recibo ${payment.receipt_code})` : ""
    }`,
  });

  revalidatePath("/caja");
  revalidatePath(`/files/${payment.file_id}`);

  return succeed(null);
}
