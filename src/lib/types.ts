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
export type MessageKind = Enums<"message_kind">;
export type ActivityType = Enums<"activity_type">;
export type DocumentType = Enums<"document_type">;
export type BroadcastStatus = Enums<"broadcast_status">;
export type BroadcastRecipientStatus = Enums<"broadcast_recipient_status">;
export type BroadcastIntent = Enums<"broadcast_intent">;

/**
 * Un botón de una plantilla de WhatsApp (`wa_templates.buttons`).
 *
 * El ORDEN del array es el índice con el que Meta identifica al botón, tanto al
 * enviar (`components[].index`) como al avisar del toque. Reordenarlos después
 * de que la plantilla está aprobada rompe la lectura de las respuestas viejas:
 * por eso el orden se congela en `broadcasts.buttons_snapshot`.
 *
 * `intent` es lo que convierte un toque en un lead calificado. Solo lo llevan
 * los de respuesta rápida: un botón que abre un link se va de WhatsApp y no
 * vuelve con nada que podamos leer.
 */
export type TemplateButton = {
  type: "quick_reply" | "url";
  /** lo que ve el cliente; Meta lo limita a 25 caracteres */
  text: string;
  /** solo en los de tipo url */
  url?: string | null;
  /** qué significa que lo toque — solo en quick_reply */
  intent?: BroadcastIntent | null;
};

/**
 * Los filtros con los que se armó la audiencia de una difusión
 * (`broadcasts.audience`). Es el mismo objeto que recibe la función de base
 * `public.broadcast_audience(agency, filters)`: si se agrega una clave acá,
 * va también en el SQL, o el contador de la pantalla miente.
 */
export type BroadcastAudience = {
  tags?: string[];
  tags_mode?: "any" | "all";
  stages?: LeadStage[];
  clients?: "todos" | "clientes" | "no_clientes";
  branch_id?: string | null;
  assigned_to?: string | null;
  destination?: string | null;
  created_from?: string | null;
  created_to?: string | null;
  birthday_month?: number | null;
  /** sin movimiento hace N días */
  quiet_days?: number | null;
  /** no repetirle a quien recibió una difusión hace menos de N días (default 7) */
  no_broadcast_days?: number;
  /** no interrumpir a los que están en presupuestado/negociación (default true) */
  skip_active?: boolean;
};

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

/**
 * Adjunto de un mensaje del chat (`messages.media`).
 *
 * Vive acá y no junto al código que lo guarda porque lo necesitan las dos
 * puntas: el webhook que lo baja (servidor) y la burbuja que lo muestra
 * (browser). `lib/media/store.ts` importa el cliente con service role, así que
 * un client component no puede importar de ahí ni el tipo.
 *
 * `path` es del bucket privado `attachments`, NUNCA una URL: las firmadas duran
 * una hora y se piden al mostrar.
 */
export type MessageMedia = {
  path: string;
  mime: string;
  /** nombre original — solo los documentos lo traen */
  name?: string | null;
  size?: number | null;
  /** segundos; audio y video */
  duration?: number | null;
  /** nota de voz grabada, no un archivo de audio adjunto */
  voice?: boolean;
  /** figurita: se muestra sin fondo de burbuja */
  sticker?: boolean;
  /** figurita animada (webp animado) */
  animated?: boolean;
};

/**
 * Lo que no entra en las columnas de `messages` y la burbuja igual quiere saber
 * (`messages.metadata`, jsonb). TODO es opcional: la mayoría de los mensajes
 * llevan `{}` y cada canal escribe solo lo que le corresponde.
 *
 * Las claves de WhatsApp las escribe el worker de Baileys (ver
 * `WorkerEvent.metadata` en `wa/worker-contract.ts`) y también el webhook de la
 * Cloud API cuando le llega lo mismo. Ubicación, contactos y encuestas no son
 * un `message_kind` a propósito: entran como texto legible (lo que va al
 * preview y al aviso del operador) y acá queda el dato crudo por si la burbuja
 * quiere pintarlos mejor.
 *
 * Las claves del final son las que la app ya venía guardando y sirven para
 * saber POR QUÉ existe un mensaje (respuesta automática, seguimiento,
 * difusión, plantilla).
 */
export type MessageMetadata = {
  /** tipo crudo con el que vino de WhatsApp (conversation, imageMessage, …) */
  wa_type?: string;
  /** vista previa del link que WhatsApp armó para un texto con URL */
  link_preview?: {
    url: string;
    title?: string | null;
    description?: string | null;
    /** data: URI de la miniatura (jpeg chico), si vino */
    thumbnail?: string | null;
  };
  location?: {
    latitude: number;
    longitude: number;
    name?: string | null;
    address?: string | null;
    /** link que mandó WhatsApp (maps), si vino */
    url?: string | null;
    /** ubicación en tiempo real, no un punto fijo */
    live?: boolean;
  };
  /** tarjetas de contacto compartidas (una o varias) */
  contacts?: {
    name: string;
    phones: string[];
    vcard?: string | null;
  }[];
  poll?: {
    name: string;
    options: string[];
    /** cuántas opciones se pueden elegir (null = las que quiera) */
    selectable?: number | null;
  };
  /** el mensaje al que responde: alcanza para pintar la cita sin ir a buscarlo */
  quoted?: {
    /** wa_message_id del citado */
    id: string;
    fromMe: boolean;
    text?: string | null;
  };
  forwarded?: boolean;
  /** foto/video para ver una sola vez: el adjunto no se guarda */
  view_once?: boolean;
  /** video que se reproduce en loop sin sonido */
  gif?: boolean;
  /** video redondo (nota de video) */
  video_note?: boolean;
  /** la persona lo borró para todos: el cuerpo ya no es el original */
  revoked?: boolean;
  /** ISO; la persona lo editó y `body` es la versión nueva */
  edited_at?: string;

  /* ── lo que ya escribía la app ── */
  /** respuesta automática del número madre / de Instagram */
  auto_reply?: boolean;
  /** el hilo de WhatsApp nació del DM de Instagram (puente) */
  from_instagram?: boolean;
  /** salió como plantilla desde el chat o desde un seguimiento por el madre */
  template_id?: string;
  followup_id?: string;
  broadcast_id?: string;
  /** botón o ice breaker de Instagram que tocó */
  instagram_boton?: string;
  /** lo que dijo Meta palabra por palabra cuando rechazó la plantilla */
  meta_error?: { code: number | null; raw: string };
};

/**
 * Reacción a un mensaje (`messages.reactions`). No son mensajes: se pegan a la
 * burbuja del mensaje reaccionado, como en WhatsApp. Hay como mucho una por
 * lado, así que la dirección alcanza como identidad.
 */
export type MessageReaction = {
  emoji: string;
  direction: MessageDirection;
  /** ISO */
  at: string;
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
