import type { LeadChannel, LeadStage, QuoteStatus, TripType, ActivityType } from "@/lib/types";

/** Conversación de WhatsApp del contacto (para la línea de último mensaje). */
export type LeadConversation = {
  id: string;
  last_message_preview: string | null;
  last_message_at: string | null;
  last_inbound_at: string | null;
  unread_count: number;
};

/** Tarjeta del kanban: lo mínimo para pintar el tablero. */
export type BoardLead = {
  id: string;
  stage: LeadStage;
  position: number;
  destination: string | null;
  origin_channel: LeadChannel;
  origin_campaign: string | null;
  next_action_at: string | null;
  created_at: string;
  pax_adults: number;
  pax_children: number;
  assigned_to: string | null;
  won_file_id: string | null;
  contact: { id: string; full_name: string; phone: string | null };
  assignee: { id: string; display_name: string } | null;
  conversation: LeadConversation | null;
  /** opcionales (aditivo): suma de presupuesto por columna en el kanban */
  budget_estimate?: number | null;
  budget_currency?: string | null;
  /** true si llegó por realtime (para animate-pop) */
  _new?: boolean;
};

export type MemberOption = {
  id: string;
  display_name: string;
  role: string;
};

export type TagOption = {
  id: string;
  name: string;
  color: string;
  category: string;
};

/** Detalle del lead (pantalla /crm/[id]) */
export type DetailLead = {
  id: string;
  stage: LeadStage;
  destination: string | null;
  trip_date_from: string | null;
  trip_date_to: string | null;
  pax_adults: number;
  pax_children: number;
  trip_type: TripType | null;
  budget_estimate: number | null;
  budget_currency: string;
  next_action: string | null;
  next_action_at: string | null;
  origin_channel: LeadChannel;
  origin_campaign: string | null;
  initial_message: string | null;
  lost_reason: string | null;
  assigned_to: string | null;
  created_at: string;
  won_file_id: string | null;
  contact: { id: string; full_name: string; phone: string | null; email: string | null };
  tags: TagOption[];
  wonFile: { id: string; code: string } | null;
};

export type LeadQuote = {
  id: string;
  code: string;
  total_price: number;
  currency: string;
  status: QuoteStatus;
  created_at: string;
};

export type LeadActivity = {
  id: string;
  type: ActivityType;
  body: string;
  created_at: string;
  author: string | null;
};
