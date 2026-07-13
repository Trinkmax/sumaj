import type { Tables } from "@/lib/types";

/** Select compartido: conversación + contacto + asignado (lo usan las pages y el realtime). */
export const CONVERSATION_SELECT =
  "*, contact:contacts(id, full_name, phone, email, city, is_client), assignee:members!conversations_assigned_to_fkey(id, display_name, avatar_url)";

export type ContactLite = Pick<
  Tables<"contacts">,
  "id" | "full_name" | "phone" | "email" | "city" | "is_client"
>;

export type MemberLite = Pick<Tables<"members">, "id" | "display_name" | "avatar_url">;

export type ConversationRow = Tables<"conversations"> & {
  contact: ContactLite | null;
  assignee: MemberLite | null;
};

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
