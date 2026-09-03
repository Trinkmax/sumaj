import { Globe, Store } from "lucide-react";
import { InstagramIcon, type BrandIconProps } from "@/components/ui/brand-icons";
import type { Enums, Tables } from "@/lib/types";

/**
 * Select compartido: conversación + contacto + asignado + por qué número entra
 * (canal y sucursal) — lo usan las pages, el realtime y el header del hilo.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(id, full_name, phone, email, city, is_client), assignee:members!conversations_assigned_to_fkey(id, display_name, avatar_url), channel_ref:wa_channels(id, label, kind, is_mother, status), branch:branches(id, name, color)";

export type ContactLite = Pick<
  Tables<"contacts">,
  "id" | "full_name" | "phone" | "email" | "city" | "is_client"
>;

export type MemberLite = Pick<Tables<"members">, "id" | "display_name" | "avatar_url">;

/** Número por el que entra/sale la conversación (madre o sucursal). */
export type ChannelLite = Pick<
  Tables<"wa_channels">,
  "id" | "label" | "kind" | "is_mother" | "status"
>;

export type BranchLite = Pick<Tables<"branches">, "id" | "name" | "color">;

export type ConversationRow = Tables<"conversations"> & {
  contact: ContactLite | null;
  assignee: MemberLite | null;
  channel_ref: ChannelLite | null;
  branch: BranchLite | null;
};

/** Sucursal + su número de WhatsApp: filtro de la lista y diálogo de derivar. */
export type BranchOption = {
  id: string;
  name: string;
  /** key de TAG_COLORS */
  color: string;
  /** canal Baileys de la sucursal (null si todavía no se creó) */
  channel: {
    id: string;
    status: Enums<"wa_channel_status">;
    phone: string | null;
  } | null;
};

export type ConversationOrigin = {
  kind: "instagram" | "madre" | "sucursal" | "otro";
  /** valor del filtro de la bandeja */
  key: string;
  label: string;
  /** los de lucide entran acá igual: la firma es la que ellos ya cumplen */
  icon: React.ComponentType<BrandIconProps>;
};

/** Clave del filtro "por dónde entra" cuando la conversación es de Instagram. */
export const INSTAGRAM_ORIGIN_KEY = "instagram";

/**
 * De dónde viene la conversación, resuelto igual en la lista y en el hilo.
 *
 * Instagram se pregunta PRIMERO: su canal no es madre y no tiene sucursal
 * propia, pero la conversación sí queda etiquetada con la sucursal a la que se
 * derivó — sin este orden, un DM derivado se mostraría como si hubiera entrado
 * por el WhatsApp de esa sucursal, que es exactamente lo contrario de lo que
 * pasó.
 */
export function conversationOrigin(c: {
  channel_ref: ChannelLite | null;
  branch: BranchLite | null;
}): ConversationOrigin | null {
  if (c.channel_ref?.kind === "instagram") {
    return {
      kind: "instagram",
      key: INSTAGRAM_ORIGIN_KEY,
      label: c.channel_ref.label,
      icon: InstagramIcon,
    };
  }
  if (c.channel_ref?.is_mother) {
    return { kind: "madre", key: "madre", label: c.channel_ref.label, icon: Globe };
  }
  if (c.branch) {
    return { kind: "sucursal", key: c.branch.id, label: c.branch.name, icon: Store };
  }
  if (c.channel_ref) {
    return { kind: "otro", key: c.channel_ref.id, label: c.channel_ref.label, icon: Globe };
  }
  return null;
}

/**
 * Un chat de sucursal que WhatsApp entregó por LID (Linked ID) y todavía sin
 * número nace con `wa_id = "lid:<lid>"` (`handleInboundMessage`, lib/wa/inbound);
 * el teléfono, cuando WhatsApp lo comparte, va a `contacts.phone` y el LID
 * queda en `contacts.wa_lid`. Por la SUCURSAL se le escribe igual: el worker
 * manda al JID `<lid>@lid` (`BaileysSendRequest.toLid`). Por el número madre
 * no: la Cloud API solo conoce teléfonos. El header no lo pinta como número.
 */
export function isLidWaId(waId: string | null | undefined): boolean {
  return typeof waId === "string" && waId.startsWith("lid:");
}

export type MessageRow = Tables<"messages">;

export type TemplateRow = Tables<"wa_templates">;

export type ActiveLead = Pick<
  Tables<"leads">,
  "id" | "destination" | "stage" | "next_action" | "next_action_at"
>;

export type QuoteLite = Pick<
  Tables<"quotes">,
  | "id"
  | "code"
  | "destination"
  | "status"
  | "total_price"
  | "currency"
  | "public_token"
  | "valid_until"
  | "created_at"
>;

/* ── aditivos v2 (panel de herramientas del chat) ── */

/** Lead con lo que necesita el panel de herramientas (stepper, seguimiento, file). */
export type PanelLead = Pick<
  Tables<"leads">,
  | "id"
  | "destination"
  | "stage"
  | "next_action"
  | "next_action_at"
  | "followups_paused"
  | "won_file_id"
>;

export type TagLite = Pick<Tables<"tags">, "id" | "name" | "color">;

export type FileLite = Pick<Tables<"files">, "id" | "code" | "destination" | "status">;
