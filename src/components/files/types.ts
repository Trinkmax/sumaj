import type { Enums } from "@/lib/types";

/** fila de la lista /files (files + file_totals + joins) */
export type FileListRow = {
  id: string;
  code: string;
  destination: string;
  status: Enums<"file_status">;
  currency: string;
  departure_date: string | null;
  return_date: string | null;
  created_at: string;
  seller_id: string | null;
  contact_id: string;
  contact_name: string;
  seller_name: string | null;
  total_sale: number;
  utility: number;
  paid_total: number;
  balance: number;
};

export type ContactOption = { id: string; full_name: string; phone: string | null };
export type MemberOption = { id: string; display_name: string };
export type SupplierOption = { id: string; name: string };

/** file completo para /files/[id] */
export type FileDetail = {
  id: string;
  code: string;
  destination: string;
  status: Enums<"file_status">;
  currency: string;
  departure_date: string | null;
  return_date: string | null;
  notes: string | null;
  commission_pct: number;
  created_at: string;
  /** navegación cruzada: lead y presupuesto de origen */
  lead_id: string | null;
  quote_id: string | null;
  contact: { id: string; full_name: string; phone: string | null } | null;
  seller: { id: string; display_name: string } | null;
  totals: {
    total_cost: number;
    total_sale: number;
    utility: number;
    paid_total: number;
    balance: number;
  };
};

export type ServiceRow = {
  id: string;
  type: Enums<"service_type">;
  description: string;
  supplier_id: string | null;
  supplier_name: string | null;
  reservation_code: string | null;
  date_from: string | null;
  date_to: string | null;
  cost: number;
  price: number;
  paid_to_supplier: boolean;
  position: number;
};

export type PaymentRow = {
  id: string;
  paid_at: string;
  method: Enums<"payment_method">;
  amount: number;
  currency: string;
  amount_in_file_currency: number;
  receipt_code: string | null;
  receipt_token: string;
  note: string | null;
};

export type TravelerRow = {
  id: string;
  full_name: string;
  document_type: Enums<"document_type"> | null;
  document_number: string | null;
  document_expiry: string | null;
  birth_date: string | null;
  /** si el pasajero tiene ficha propia de contacto → link "Ver ficha" */
  linked_contact_id: string | null;
};

export type ActivityRow = {
  id: string;
  type: Enums<"activity_type">;
  body: string;
  created_at: string;
  member_name: string | null;
};
