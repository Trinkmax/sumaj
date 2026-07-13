import type { Tables, DocumentType } from "@/lib/types";

/** Contacto con sus etiquetas ya aplanadas */
export type ContactRow = Tables<"contacts"> & { tags: Tables<"tags">[] };

export type TravelerRow = Tables<"travelers">;

export type LeadSummary = Pick<
  Tables<"leads">,
  "id" | "stage" | "destination" | "created_at" | "won_file_id"
>;

export type FileSummary = Pick<
  Tables<"files">,
  "id" | "code" | "destination" | "status" | "currency" | "created_at"
> & { total_sale: number };

export type QuoteSummary = Pick<
  Tables<"quotes">,
  "id" | "code" | "status" | "total_price" | "currency" | "destination" | "created_at"
>;

export type ActivityRow = Tables<"activities"> & {
  member: { display_name: string } | null;
};

/** Pasajero con documento por vencer (para el banner de la lista) */
export type ExpiringDoc = {
  travelerId: string;
  travelerName: string;
  contactId: string;
  contactName: string;
  expiry: string;
};

export const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  dni: "DNI",
  pasaporte: "Pasaporte",
  visa: "Visa",
  otro: "Otro",
};

export const DOC_TYPE_KEYS = Object.keys(DOC_TYPE_LABELS) as DocumentType[];

/** ¿vence dentro de los próximos `days` días (o ya venció)? */
export function expiresSoon(expiry: string | null | undefined, days = 90): boolean {
  if (!expiry) return false;
  const limit = new Date();
  limit.setDate(limit.getDate() + days);
  const [y, m, d] = expiry.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d) <= limit;
}

/** ¿ya venció? */
export function isExpired(expiry: string | null | undefined): boolean {
  if (!expiry) return false;
  const [y, m, d] = expiry.slice(0, 10).split("-").map(Number);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(y, m - 1, d) < today;
}

/** ¿cumple años este mes? */
export function birthdayThisMonth(birthDate: string | null | undefined): boolean {
  if (!birthDate) return false;
  const month = Number(birthDate.slice(5, 7));
  return month === new Date().getMonth() + 1;
}

/** Suma montos agrupados por moneda → [["USD", 5200], ["ARS", 300000]] */
export function sumByCurrency(rows: { currency: string; amount: number }[]): [string, number][] {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.currency, (map.get(r.currency) ?? 0) + r.amount);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}
