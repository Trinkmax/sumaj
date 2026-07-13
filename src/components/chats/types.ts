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
