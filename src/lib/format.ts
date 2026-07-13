/** Formateo es-AR: moneda, fechas, teléfonos. Una sola fuente de verdad. */

const nfUSD = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const nfUSDdec = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "USD 1.386" / "$ 1.450.000" — sin decimales salvo que hagan falta */
export function fmtMoney(amount: number | null | undefined, currency = "USD"): string {
  if (amount == null || isNaN(amount)) amount = 0;
  const hasDecimals = Math.abs(amount % 1) > 0.004;
  const n = hasDecimals ? nfUSDdec.format(amount) : nfUSD.format(amount);
  return currency === "ARS" ? `$ ${n}` : `${currency} ${n}`;
}

/** Solo el número formateado, sin símbolo */
export function fmtNumber(amount: number | null | undefined, decimals = 0): string {
  if (amount == null || isNaN(amount)) amount = 0;
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

/** "12 jul" / "12 jul 2025" (agrega año si difiere del actual) */
export function fmtDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? parseDate(date) : date;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("es-AR", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** "12/07/2026" */
export function fmtDateFull(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? parseDate(date) : date;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** "12 de julio de 2026" — para presupuestos y recibos */
export function fmtDateLong(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? parseDate(date) : date;
  return d.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
}

/** "14:32" */
export function fmtTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** fechas YYYY-MM-DD sin zona horaria (evita corrimiento de día) */
function parseDate(s: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(s);
}

/** "hace 5 min", "hace 2 h", "ayer", "hace 3 días", o fecha corta */
export function fmtRelative(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  return fmtDate(d);
}

/** "en 2 h", "hoy", "mañana", "vencido hace 3 días" — para seguimientos */
export function fmtDue(date: string | Date): { label: string; overdue: boolean; today: boolean } {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = d.getTime() - Date.now();
  const mins = Math.round(diffMs / 60000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  if (mins < 0) {
    const h = Math.abs(Math.round(mins / 60));
    if (h < 1) return { label: "hace un rato", overdue: true, today: sameDay };
    if (h < 24) return { label: `venció hace ${h} h`, overdue: true, today: sameDay };
    return { label: `venció hace ${Math.round(h / 24)} d`, overdue: true, today: false };
  }
  if (mins < 60) return { label: `en ${mins} min`, overdue: false, today: true };
  if (sameDay) return { label: `hoy ${fmtTime(d)}`, overdue: false, today: true };
  if (d.toDateString() === tomorrow.toDateString())
    return { label: "mañana", overdue: false, today: false };
  return { label: fmtDate(d), overdue: false, today: false };
}

/** "+54 9 351 555-0118" desde "5493515550118" */
export function fmtPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const p = phone.replace(/\D/g, "");
  if (p.startsWith("549") && p.length === 13) {
    return `+54 9 ${p.slice(3, 6)} ${p.slice(6, 9)}-${p.slice(9)}`;
  }
  if (p.startsWith("54") && p.length >= 12) {
    return `+54 ${p.slice(2, 5)} ${p.slice(5, 9)}-${p.slice(9)}`;
  }
  return `+${p}`;
}

/** iniciales para avatares: "Gabriela Suárez" → "GS" */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** color estable a partir de un nombre (para avatares) — tokens tone-*, theme-aware */
const AVATAR_COLORS = [
  "bg-brand-tint-strong text-brand-text",
  "bg-tone-sky-soft text-tone-sky-text",
  "bg-tone-violet-soft text-tone-violet-text",
  "bg-tone-emerald-soft text-tone-emerald-text",
  "bg-tone-rose-soft text-tone-rose-text",
  "bg-tone-amber-soft text-tone-amber-text",
  "bg-tone-cyan-soft text-tone-cyan-text",
];
export function avatarColor(name: string | null | undefined): string {
  if (!name) return AVATAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** "7 noches" a partir de dos fechas */
export function nightsBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const d1 = parseDate(from);
  const d2 = parseDate(to);
  const n = Math.round((d2.getTime() - d1.getTime()) / 86400000);
  return n > 0 ? n : null;
}

/** normaliza teléfono a dígitos E.164 sin '+': "0351 15-555-0118" → "5493515550118" */
export function normalizePhone(input: string): string {
  let p = input.replace(/\D/g, "");
  if (p.startsWith("00")) p = p.slice(2);
  if (p.startsWith("54")) return p; // ya tiene código de país argentino
  // formato local argentino: sacar el 0 inicial y el "15" de celular después del área
  if (p.startsWith("0")) p = p.slice(1).replace(/^(\d{2,4})15/, "$1");
  // área + número local (10 dígitos) → celular argentino
  if (p.length === 10) return "549" + p;
  if (p.length === 11 && p.startsWith("9")) return "54" + p;
  // internacional u otro formato: se deja como está
  return p;
}
