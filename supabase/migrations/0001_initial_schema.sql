-- Sumaj — Sistema de gestión para agencias de viaje
-- Migración inicial: schema multi-tenant completo
-- Convención: toda tabla tiene agency_id → aislamiento por RLS

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────
create type member_role as enum ('admin', 'vendedor', 'freelance');
create type lead_stage as enum ('nuevo', 'contactado', 'presupuestado', 'negociacion', 'ganado', 'perdido');
create type lead_channel as enum ('whatsapp', 'instagram', 'messenger', 'lead_form', 'web', 'referido', 'manual');
create type trip_type as enum ('familiar', 'pareja', 'grupal', 'corporativo', 'solo');
create type activity_type as enum ('nota', 'llamada', 'whatsapp', 'email', 'etapa', 'presupuesto', 'sistema');
create type conversation_status as enum ('abierta', 'cerrada', 'spam');
create type message_direction as enum ('in', 'out');
create type message_status as enum ('pendiente', 'enviado', 'entregado', 'leido', 'fallido');
create type message_kind as enum ('texto', 'plantilla', 'imagen', 'documento', 'audio', 'video', 'nota_interna');
create type quote_status as enum ('borrador', 'enviado', 'aceptado', 'rechazado', 'vencido');
create type service_type as enum ('aereo', 'hotel', 'paquete', 'excursion', 'traslado', 'asistencia', 'circuito', 'crucero', 'otro');
create type file_status as enum ('vendido', 'pagado', 'en_curso', 'finalizado', 'cancelado');
create type payment_method as enum ('efectivo', 'transferencia', 'tarjeta', 'mercado_pago', 'deposito', 'otro');
create type payment_direction as enum ('cobro', 'pago_proveedor', 'reembolso');
create type followup_status as enum ('pendiente', 'enviado', 'cancelado', 'fallido');
create type document_type as enum ('dni', 'pasaporte', 'visa', 'otro');

-- ─────────────────────────────────────────────
-- AGENCIES (tenant raíz)
-- ─────────────────────────────────────────────
create table agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  logo_url text,
  phone text,
  email text,
  address text,
  created_by uuid not null references auth.users(id),
  -- settings: branding de presupuestos, config whatsapp, notas guardadas, etc.
  settings jsonb not null default '{
    "quote_theme": {"color": "sand", "font": "editorial"},
    "quote_saved_notes": [],
    "whatsapp": {"phone_number_id": null, "display_number": null, "connected": false},
    "usd_rate": null
  }'::jsonb,
  file_seq integer not null default 0,
  quote_seq integer not null default 0,
  receipt_seq integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- MEMBERS (usuarios de la agencia)
-- ─────────────────────────────────────────────
create table members (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null default 'vendedor',
  display_name text not null,
  avatar_url text,
  phone text,
  email text,
  commission_pct numeric(5,2) not null default 0, -- % sobre utilidad del file
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, user_id)
);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  email text not null,
  role member_role not null default 'vendedor',
  display_name text,
  commission_pct numeric(5,2) not null default 0,
  invited_by uuid references members(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (agency_id, email)
);

-- ─────────────────────────────────────────────
-- TAGS (etiquetado y segmentación)
-- ─────────────────────────────────────────────
create table tags (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  name text not null,
  category text not null default 'otro', -- destino | presupuesto | tipo_viaje | temporada | origen | otro
  color text not null default 'gray',
  created_at timestamptz not null default now(),
  unique (agency_id, name)
);

-- ─────────────────────────────────────────────
-- CONTACTS (la persona; un lead ganado ya es cliente)
-- ─────────────────────────────────────────────
create table contacts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  full_name text not null,
  phone text, -- E.164 sin '+', ej: 5493511234567
  email text,
  instagram text,
  document_type document_type,
  document_number text,
  birth_date date,
  address text,
  city text,
  notes text,
  is_client boolean not null default false, -- true cuando ganó al menos un file
  source lead_channel not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table contact_tags (
  contact_id uuid not null references contacts(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id)
);

-- Pasajeros relacionados (grupo familiar) + documentos de viaje
create table travelers (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  full_name text not null,
  relationship text, -- pareja, hijo/a, madre, amigo/a...
  birth_date date,
  document_type document_type,
  document_number text,
  document_expiry date, -- vencimiento pasaporte/visa → aviso automático
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  entity_type text not null, -- contact | traveler | lead | file | quote
  entity_id uuid not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  uploaded_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- SUPPLIERS (mayoristas: Tucano Tours, etc.)
-- ─────────────────────────────────────────────
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  name text not null,
  website text,
  phone text,
  email text,
  default_commission_pct numeric(5,2) not null default 0, -- comisión mayorista sobre tarifa bruta
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (agency_id, name)
);

-- ─────────────────────────────────────────────
-- LEADS (la oportunidad en el pipeline)
-- ─────────────────────────────────────────────
create table leads (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  stage lead_stage not null default 'nuevo',
  position numeric not null default 0, -- orden dentro de la columna kanban
  destination text,
  origin_channel lead_channel not null default 'manual',
  origin_campaign text, -- nombre del anuncio/campaña de Meta
  origin_ad_id text,
  assigned_to uuid references members(id) on delete set null,
  trip_date_from date,
  trip_date_to date,
  pax_adults smallint not null default 2,
  pax_children smallint not null default 0,
  trip_type trip_type,
  budget_estimate numeric(12,2),
  budget_currency text not null default 'USD',
  next_action text, -- "llamar para cerrar", "mandar cotización de hotel x"
  next_action_at timestamptz, -- fecha de seguimiento con recordatorio
  followups_paused boolean not null default false,
  lost_reason text,
  won_file_id uuid, -- FK diferida a files (se agrega luego)
  initial_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

-- Historial / timeline de cada lead y contacto
create table activities (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,
  contact_id uuid references contacts(id) on delete cascade,
  file_id uuid, -- FK diferida
  member_id uuid references members(id) on delete set null,
  type activity_type not null default 'nota',
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- CONVERSACIONES + MENSAJES (WhatsApp embebido)
-- ─────────────────────────────────────────────
create table conversations (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  channel lead_channel not null default 'whatsapp',
  wa_id text, -- número E.164 del cliente en WhatsApp
  status conversation_status not null default 'abierta',
  assigned_to uuid references members(id) on delete set null,
  last_message_at timestamptz,
  last_message_preview text,
  last_inbound_at timestamptz, -- para ventana de 24h y cadencia de reenganche
  unread_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, contact_id, channel)
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  direction message_direction not null,
  kind message_kind not null default 'texto',
  body text,
  media_url text,
  template_name text,
  wa_message_id text unique,
  status message_status not null default 'pendiente',
  error_detail text,
  sent_by uuid references members(id) on delete set null, -- null si es automático o entrante
  is_automated boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Plantillas pre-aprobadas por Meta (reenganche por etapa)
create table wa_templates (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  name text not null, -- nombre interno legible
  meta_name text not null, -- nombre técnico en Meta
  language text not null default 'es_AR',
  body text not null, -- con {{nombre}}, {{vendedor}}, {{destino}}, {{fecha}}
  stage lead_stage, -- a qué etapa aplica para reenganche (null = genérica)
  is_approved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (agency_id, meta_name)
);

-- Reglas de cadencia de reenganche (48h / día 7 / día 21)
create table followup_rules (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  touch_number smallint not null, -- 1, 2, 3
  hours_after_silence integer not null, -- 48, 168, 504
  applies_to_stages lead_stage[] not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (agency_id, touch_number)
);

-- Cola de seguimientos programados
create table followups (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  rule_id uuid references followup_rules(id) on delete set null,
  touch_number smallint not null default 1,
  scheduled_at timestamptz not null,
  status followup_status not null default 'pendiente',
  template_id uuid references wa_templates(id) on delete set null,
  sent_message_id uuid references messages(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- QUOTES (cotizador estilo planilla + presupuesto lindo para el cliente)
-- ─────────────────────────────────────────────
create table quotes (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  number integer not null default 0,
  code text not null default '', -- P-0001
  lead_id uuid references leads(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  created_by uuid references members(id) on delete set null,
  title text, -- "Cancún — Familia Suárez"
  destination text not null,
  currency text not null default 'USD',
  pax smallint not null default 2,
  nights smallint,
  trip_date_from date,
  trip_date_to date,
  valid_until date,
  status quote_status not null default 'borrador',
  -- markup: en monto fijo (como la planilla) o porcentaje
  markup_type text not null default 'monto' check (markup_type in ('monto', 'porcentaje')),
  markup_value numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  -- totales denormalizados (calculados por la app al guardar)
  total_cost numeric(12,2) not null default 0,      -- Σ final (Total Paquete)
  total_price numeric(12,2) not null default 0,     -- total_cost + markup - descuento (Precio Cliente)
  commission_total numeric(12,2) not null default 0,-- Σ comisión mayorista + markup (Total Comisión)
  notes text, -- notas visibles en el presupuesto del cliente
  internal_notes text,
  theme jsonb not null default '{"color": "sand", "font": "editorial"}'::jsonb,
  public_token uuid not null default gen_random_uuid() unique,
  file_id uuid, -- FK diferida: cuando se convierte en venta
  sent_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table quote_items (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  quote_id uuid not null references quotes(id) on delete cascade,
  type service_type not null,
  description text not null, -- "Hotel Riu Palace 7 noches all inclusive"
  supplier_id uuid references suppliers(id) on delete set null,
  cost numeric(12,2) not null default 0,   -- FINAL: lo que se paga al proveedor
  gross numeric(12,2),                     -- BRUTO: tarifa comisionable del mayorista
  commission_pct numeric(5,2) not null default 0, -- % comisión mayorista sobre bruto
  show_in_client_quote boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- FILES (ventas — la unidad que ordena la agencia)
-- ─────────────────────────────────────────────
create table files (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  number integer not null default 0,
  code text not null default '', -- SMJ-0001
  contact_id uuid not null references contacts(id) on delete restrict,
  lead_id uuid references leads(id) on delete set null,
  quote_id uuid references quotes(id) on delete set null,
  seller_id uuid references members(id) on delete set null,
  destination text not null,
  departure_date date,
  return_date date,
  status file_status not null default 'vendido',
  currency text not null default 'USD',
  commission_pct numeric(5,2) not null default 0, -- snapshot de comisión del vendedor
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table file_travelers (
  file_id uuid not null references files(id) on delete cascade,
  traveler_id uuid not null references travelers(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,
  primary key (file_id, traveler_id)
);

create table file_services (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  file_id uuid not null references files(id) on delete cascade,
  type service_type not null,
  description text not null,
  supplier_id uuid references suppliers(id) on delete set null,
  reservation_code text,
  date_from date,
  date_to date,
  cost numeric(12,2) not null default 0,  -- costo (lo que pagamos)
  price numeric(12,2) not null default 0, -- precio de venta al cliente
  paid_to_supplier boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- PAYMENTS (cobros y caja, multimoneda)
-- ─────────────────────────────────────────────
create table payments (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  file_id uuid not null references files(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  direction payment_direction not null default 'cobro',
  method payment_method not null default 'efectivo',
  currency text not null default 'USD',
  amount numeric(12,2) not null,
  exchange_rate numeric(12,2), -- ARS por USD si currency=ARS y el file es USD
  amount_in_file_currency numeric(12,2) not null, -- normalizado a la moneda del file
  supplier_id uuid references suppliers(id) on delete set null, -- para pago_proveedor
  receipt_number integer,
  receipt_code text, -- R-0001
  receipt_token uuid not null default gen_random_uuid() unique,
  note text,
  received_by uuid references members(id) on delete set null,
  paid_at date not null default current_date,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- NOTIFICATIONS (avisos in-app)
-- ─────────────────────────────────────────────
create table notifications (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  type text not null default 'general', -- seguimiento | documento | salida | cumpleanos | lead_nuevo | pago
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- FKs diferidas
alter table leads add constraint leads_won_file_fk
  foreign key (won_file_id) references files(id) on delete set null;
alter table activities add constraint activities_file_fk
  foreign key (file_id) references files(id) on delete cascade;
alter table quotes add constraint quotes_file_fk
  foreign key (file_id) references files(id) on delete set null;

-- ─────────────────────────────────────────────
-- ÍNDICES
-- ─────────────────────────────────────────────
create index idx_members_agency on members (agency_id);
create index idx_members_user on members (user_id);
create index idx_invitations_email on invitations (lower(email));
create index idx_tags_agency on tags (agency_id);
create index idx_contacts_agency on contacts (agency_id, created_at desc);
create index idx_contacts_phone on contacts (agency_id, phone);
create index idx_contact_tags_tag on contact_tags (tag_id);
create index idx_contact_tags_agency on contact_tags (agency_id);
create index idx_travelers_contact on travelers (contact_id);
create index idx_travelers_agency_expiry on travelers (agency_id, document_expiry) where document_expiry is not null;
create index idx_attachments_entity on attachments (agency_id, entity_type, entity_id);
create index idx_attachments_uploaded_by on attachments (uploaded_by);
create index idx_suppliers_agency on suppliers (agency_id);
create index idx_leads_agency_stage on leads (agency_id, stage, position);
create index idx_leads_contact on leads (contact_id);
create index idx_leads_assigned on leads (assigned_to) where assigned_to is not null;
create index idx_leads_next_action on leads (agency_id, next_action_at) where next_action_at is not null;
create index idx_activities_lead on activities (lead_id, created_at desc);
create index idx_activities_contact on activities (contact_id, created_at desc);
create index idx_activities_file on activities (file_id, created_at desc);
create index idx_activities_agency on activities (agency_id, created_at desc);
create index idx_activities_member on activities (member_id);
create index idx_conversations_agency_last on conversations (agency_id, last_message_at desc nulls last);
create index idx_conversations_contact on conversations (contact_id);
create index idx_conversations_assigned on conversations (assigned_to) where assigned_to is not null;
create index idx_conversations_wa on conversations (agency_id, wa_id);
create index idx_messages_conversation on messages (conversation_id, created_at);
create index idx_messages_agency on messages (agency_id, created_at desc);
create index idx_messages_sent_by on messages (sent_by);
create index idx_wa_templates_agency on wa_templates (agency_id);
create index idx_followup_rules_agency on followup_rules (agency_id);
create index idx_followups_pending on followups (agency_id, scheduled_at) where status = 'pendiente';
create index idx_followups_lead on followups (lead_id);
create index idx_followups_conversation on followups (conversation_id);
create index idx_followups_rule on followups (rule_id);
create index idx_followups_template on followups (template_id);
create index idx_followups_sent_message on followups (sent_message_id);
create index idx_quotes_agency on quotes (agency_id, created_at desc);
create index idx_quotes_lead on quotes (lead_id);
create index idx_quotes_contact on quotes (contact_id);
create index idx_quotes_created_by on quotes (created_by);
create index idx_quotes_file on quotes (file_id);
create index idx_quote_items_quote on quote_items (quote_id, position);
create index idx_quote_items_agency on quote_items (agency_id);
create index idx_quote_items_supplier on quote_items (supplier_id);
create index idx_files_agency on files (agency_id, created_at desc);
create index idx_files_contact on files (contact_id);
create index idx_files_lead on files (lead_id);
create index idx_files_quote on files (quote_id);
create index idx_files_seller on files (seller_id);
create index idx_files_status on files (agency_id, status);
create index idx_files_departure on files (agency_id, departure_date);
create index idx_file_travelers_traveler on file_travelers (traveler_id);
create index idx_file_travelers_agency on file_travelers (agency_id);
create index idx_file_services_file on file_services (file_id, position);
create index idx_file_services_agency on file_services (agency_id);
create index idx_file_services_supplier on file_services (supplier_id);
create index idx_payments_file on payments (file_id);
create index idx_payments_agency_date on payments (agency_id, paid_at desc);
create index idx_payments_contact on payments (contact_id);
create index idx_payments_supplier on payments (supplier_id);
create index idx_payments_received_by on payments (received_by);
create index idx_notifications_member on notifications (member_id, created_at desc) where read_at is null;
create index idx_notifications_agency on notifications (agency_id);
create index idx_leads_won_file on leads (won_file_id);
create index idx_invitations_agency on invitations (agency_id);
create index idx_invitations_invited_by on invitations (invited_by);
create index idx_agencies_created_by on agencies (created_by);
