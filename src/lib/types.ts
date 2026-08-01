import type { Database } from "@/lib/database.types";

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T];

export type LeadStage = Enums<"lead_stage">;
export type LeadChannel = Enums<"lead_channel">;
export type TripType = Enums<"trip_type">;
export type ServiceType = Enums<"service_type">;
export type FileStatus = Enums<"file_status">;
export type QuoteStatus = Enums<"quote_status">;
export type PaymentMethod = Enums<"payment_method">;
export type PaymentDirection = Enums<"payment_direction">;
export type MemberRole = Enums<"member_role">;
export type MessageDirection = Enums<"message_direction">;
export type MessageStatus = Enums<"message_status">;
export type ActivityType = Enums<"activity_type">;
export type DocumentType = Enums<"document_type">;

/**
 * settings jsonb de agencies, tipado. Todas las claves son OPCIONALES a
 * propósito: el default de la columna solo trae quote_theme, quote_saved_notes,
 * whatsapp y usd_rate — los fees y el % del vendedor aparecen recién cuando
 * alguien los guarda en Configuración → Agencia. Al leerlas siempre hay que caer
 * en el default del dominio (DEFAULT_QUOTE_FEES, DEFAULT_SELLER_MARKUP_PCT, …).
 */
export type AgencySettings = {
  quote_theme?: QuoteTheme;
  quote_saved_notes?: string[];
  /** fees que el cotizador le suma al bruto para llegar al final */
  quote_fees?: { aereo_pct: number; terrestre_pct: number };
  /** % del markup que se lleva el vendedor (estimado en el presupuesto) */
  quote_seller_commission_pct?: number;
  whatsapp?: {
    phone_number_id: string | null;
    display_number: string | null;
    connected: boolean;
  };
  usd_rate?: number | null;
  /**
   * Datos registrales de la sociedad — los que piden Meta (verificación del
   * negocio), ARCA y los que van al pie de los comprobantes. Van acá y no en
   * columnas de `agencies` porque `name`/`address` son el nombre y la dirección
   * COMERCIALES (los que ve el cliente), que rara vez coinciden con los del
   * estatuto. Se publican en /empresa.
   */
  legal?: {
    /** razón social exacta del estatuto, con el tipo societario (S.A.S., S.R.L.) */
    legal_name?: string | null;
    cuit?: string | null;
    /** domicilio de la sede social, como figura en el instrumento constitutivo */
    address?: string | null;
    city?: string | null;
    province?: string | null;
    postal_code?: string | null;
    country?: string | null;
    /** teléfono que figura en los papeles (puede no ser el de WhatsApp) */
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    /** legajo EVyT: las agencias de viaje argentinas tienen que publicarlo */
    evyt?: string | null;
  };
};

/** imagen adjunta a un servicio del file (voucher, comprobante de reserva) */
export type ServiceImage = {
  /** path dentro del bucket privado `attachments` */
  path: string;
  name: string;
};

export type QuoteTheme = {
  color: string; // key de QUOTE_COLORS en domain.ts
  font: string; // "editorial" | "moderna" | "clasica"
};
