import { fmtMoney } from "@/lib/format";

/** días enteros hasta una fecha YYYY-MM-DD (0 = hoy, negativo = pasado) */
export function daysUntil(date: string | null | undefined): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/** "✈️ hoy" / "✈️ mañana" / "✈️ en 12 días" — solo si falta menos de `max` días */
export function departureBadge(date: string | null | undefined, max = 30): string | null {
  const days = daysUntil(date);
  if (days == null || days < 0 || days >= max) return null;
  if (days === 0) return "✈️ sale hoy";
  if (days === 1) return "✈️ mañana";
  return `✈️ en ${days} días`;
}

/** true si la fecha ya pasó o cae antes del regreso del viaje */
export function docExpiresBeforeTrip(
  expiry: string | null | undefined,
  returnDate: string | null | undefined,
): boolean {
  if (!expiry) return false;
  const days = daysUntil(expiry);
  if (days == null) return false;
  if (days < 0) return true;
  if (returnDate) {
    const ret = daysUntil(returnDate);
    if (ret != null && days <= ret) return true;
  }
  return false;
}

/** hoy en YYYY-MM-DD (hora local) */
export function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** parsea un monto tipeado es-AR: "1.234,56" → 1234.56 (tolera "1234.56" de teclado iOS) */
export function parseAmount(s: string): number {
  const t = s.trim();
  if (!t.includes(",") && /^\d+\.\d{1,2}$/.test(t)) {
    const n = parseFloat(t);
    return isNaN(n) ? 0 : n;
  }
  const n = parseFloat(t.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

/** número → string editable es-AR (sin separador de miles): 1234.5 → "1234,5" */
export function numToInput(n: number | null | undefined): string {
  if (n == null || n === 0) return "";
  return String(n).replace(".", ",");
}

/** suma montos agrupados por moneda: { USD: 1200, ARS: 350000 } */
export type MoneyByCurrency = Record<string, number>;

export function addMoney(acc: MoneyByCurrency, currency: string, amount: number) {
  if (!amount) return;
  acc[currency] = (acc[currency] ?? 0) + amount;
}

/** líneas formateadas de un MoneyByCurrency, USD primero. ["USD 12.400", "$ 350.000"] */
export function moneyLines(m: MoneyByCurrency): string[] {
  const keys = Object.keys(m).sort((a, b) =>
    a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b),
  );
  if (keys.length === 0) return [fmtMoney(0, "USD")];
  return keys.map((k) => fmtMoney(m[k], k));
}

/** base para links públicos (recibos) */
export function appUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== "undefined" ? window.location.origin : "")
  );
}
