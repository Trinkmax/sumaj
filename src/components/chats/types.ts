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

/**
 * De dónde viene la conversación, resuelto igual en la lista y en el hilo:
 * el número madre manda sobre la sucursal (al derivar, el hilo del madre
 * también queda marcado con la sucursal destino).
 */
export function conversationOrigin(c: {
  channel_ref: ChannelLite | null;
  branch: BranchLite | null;
}): { kind: "madre" | "sucursal" | "otro"; key: string; label: string } | null {
  if (c.channel_ref?.is_mother) {
    return { kind: "madre", key: "madre", label: c.channel_ref.label };
  }
  if (c.branch) {
    return { kind: "sucursal", key: c.branch.id, label: c.branch.name };
  }
  if (c.channel_ref) {
    return { kind: "otro", key: c.channel_ref.id, label: c.channel_ref.label };
  }
  return null;
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
