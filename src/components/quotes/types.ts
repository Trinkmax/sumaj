/**
 * Tipos compartidos del cotizador embebido.
 * Viven acá (y no en lib/actions/quotes.ts) porque los archivos "use server"
 * solo pueden exportar funciones async — la action los importa con `import type`.
 */
import type {
  BuilderContact,
  BuilderLead,
  BuilderSupplier,
} from "@/components/quotes/quote-builder";

/** Todo lo que necesita QuoteBuilder para armarse client-side (popup). */
export type QuoteBuilderData = {
  /** Si vino leadId — misma shape que arma /presupuestos/nuevo */
  lead: BuilderLead | null;
  /** Últimos 30 (+ el del contactId si no estaba) */
  contacts: BuilderContact[];
  suppliers: BuilderSupplier[];
  savedNotes: string[];
  defaultTheme: { color: string; font: string };
  agency: { name: string; logoUrl: string | null; phone: string | null };
  sellerName: string;
  /** la comisión solo la ve el admin; el vendedor ve el estimado sobre el markup */
  isAdmin: boolean;
  /** % que se le suma al bruto para llegar al final */
  fees: { aereo_pct: number; terrestre_pct: number };
  /** % del markup que se lleva el vendedor */
  sellerCommissionPct: number;
};
