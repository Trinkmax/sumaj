import type { Tables, DocumentType } from "@/lib/types";

/** Contacto con sus etiquetas ya aplanadas + última actividad */
export type ContactRow = Tables<"contacts"> & {
  tags: Tables<"tags">[];
  /** timestamp de la última actividad registrada (fallback: created_at) */
  last_activity_at?: string | null;
};

export type TravelerRow = Tables<"travelers">;

/** Grupo del que este contacto participa como pasajero (navegación inversa) */
export type TravelsWithRow = {
  travelerId: string;
  relationship: string | null;
  owner: { id: string; full_name: string };
};

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
  /** ficha a la que linkea: la propia del pasajero si existe, sino la del titular */
  contactId: string;
  contactName: string;
  documentType: DocumentType | null;
  expiry: string;
};

export const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  dni: "DNI",
  pasaporte: "Pasaporte",
  visa: "Visa",
  otro: "Otro",
};

export const DOC_TYPE_KEYS = Object.keys(DOC_TYPE_LABELS) as DocumentType[];

/** días hasta el vencimiento (negativo = ya venció) */
export function daysUntil(expiry: string): number {
  const [y, m, d] = expiry.slice(0, 10).split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/** ¿vence dentro de los próximos `days` días (o ya venció)? */
export function expiresSoon(expiry: string | null | undefined, days = 90): boolean {
  if (!expiry) return false;
  return daysUntil(expiry) <= days;
}

/** ¿ya venció? */
export function isExpired(expiry: string | null | undefined): boolean {
  if (!expiry) return false;
  return daysUntil(expiry) < 0;
}

/** "venció hace 12 días" / "vence en 45 días" — countdown humano */
export function expiryCountdown(expiry: string): string {
  const days = daysUntil(expiry);
  if (days < -1) return `venció hace ${Math.abs(days)} días`;
  if (days === -1) return "venció ayer";
  if (days === 0) return "vence hoy";
  if (days === 1) return "vence mañana";
  if (days <= 60) return `vence en ${days} días`;
  return `vence en ${Math.round(days / 30)} meses`;
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
