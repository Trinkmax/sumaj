-- viajerOS — Sucursales + canales de WhatsApp (número madre por Cloud API,
-- sucursales por Baileys) + revisión de files.
--
-- La dinámica que modela esta migración:
--   1. TODA consulta nueva entra por el NÚMERO MADRE (Cloud API oficial).
--      Contesta solo ("ya te contacta un operador"), crea el lead y lo deriva
--      a una sucursal según reglas (o a mano, si no matchea ninguna).
--   2. Cada SUCURSAL tiene su propio número vinculado con Baileys. El operador
--      contacta al lead desde ahí: sin ventana de 24 hs y sin costo por
--      plantilla, así el seguimiento no se paga.
--   3. Al derivar, los operadores de la sucursal reciben una alerta.

-- ─────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────
do $$ begin
  create type wa_channel_kind as enum ('cloud_api', 'baileys');
exception when duplicate_object then null; end $$;

do $$ begin
  create type wa_channel_status as enum ('desconectado', 'vinculando', 'conectado', 'error');
exception when duplicate_object then null; end $$;

do $$ begin
  create type file_review_status as enum ('pendiente', 'revisado');
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────
-- SUCURSALES
-- ─────────────────────────────────────────────
create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  name text not null,                    -- "Centro", "Nueva Córdoba"
  address text,
  phone text,                            -- teléfono visible (informativo)
  color text not null default 'sky',     -- key de TAG_COLORS para el chip
  is_default boolean not null default false,  -- adonde caen los leads sin regla
  is_active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, name)
);

create index if not exists branches_agency_idx on branches(agency_id);

-- una sola sucursal por defecto por agencia
create unique index if not exists branches_one_default_idx
  on branches(agency_id) where is_default;

-- el vendedor pertenece a una sucursal; null = trabaja en todas (admins)
alter table members
  add column if not exists branch_id uuid references branches(id) on delete set null;

-- ─────────────────────────────────────────────
-- CANALES DE WHATSAPP (números)
--   branch_id null + is_mother = el número madre de la agencia
-- ─────────────────────────────────────────────
create table if not exists wa_channels (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  branch_id uuid references branches(id) on delete cascade,
  kind wa_channel_kind not null default 'baileys',
  is_mother boolean not null default false,
  label text not null,                    -- "Número madre", "Sucursal Centro"
  phone text,                             -- E.164 sin '+' del número propio
  status wa_channel_status not null default 'desconectado',
  -- Cloud API (número madre)
  phone_number_id text,
  -- Baileys (sucursales): el worker guarda acá el QR vigente y el estado
  qr text,
  qr_expires_at timestamptz,
  last_connected_at timestamptz,
  last_error text,
  -- respuesta automática (la del número madre es la que deriva al operador)
  auto_reply_enabled boolean not null default true,
  auto_reply_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wa_channels_agency_idx on wa_channels(agency_id);
create index if not exists wa_channels_branch_idx on wa_channels(branch_id);

-- un solo número madre por agencia · un solo canal por sucursal
create unique index if not exists wa_channels_one_mother_idx
  on wa_channels(agency_id) where is_mother;
create unique index if not exists wa_channels_one_per_branch_idx
  on wa_channels(branch_id) where branch_id is not null;

-- ─────────────────────────────────────────────
-- ESTADO DE SESIÓN DE BAILEYS
-- Credenciales del número vinculado: NO las toca ningún usuario.
-- RLS activo SIN policies → solo el service role (el worker) entra.
-- ─────────────────────────────────────────────
create table if not exists wa_session_state (
  channel_id uuid not null references wa_channels(id) on delete cascade,
  key text not null,                     -- 'creds' | 'app-state-sync-key-…' | …
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (channel_id, key)
);

-- ─────────────────────────────────────────────
-- REGLAS DE DERIVACIÓN del número madre → sucursal
-- Se evalúan por `position`; la primera que matchea gana.
-- ─────────────────────────────────────────────
create table if not exists routing_rules (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  -- palabra: el texto del primer mensaje contiene `pattern`
  -- campana: la campaña/anuncio de origen contiene `pattern`
  match_type text not null default 'palabra' check (match_type in ('palabra', 'campana')),
  pattern text not null,
  is_active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists routing_rules_agency_idx on routing_rules(agency_id, position);

-- ─────────────────────────────────────────────
-- CONVERSACIONES: por qué número entró / salió
-- ─────────────────────────────────────────────
alter table conversations
  add column if not exists channel_id uuid references wa_channels(id) on delete set null,
  add column if not exists branch_id uuid references branches(id) on delete set null,
  -- si esta conversación nació de una derivación, de qué hilo del madre viene
  add column if not exists origin_conversation_id uuid references conversations(id) on delete set null;

create index if not exists conversations_channel_idx on conversations(channel_id);
create index if not exists conversations_branch_idx on conversations(branch_id);

-- un contacto puede tener hilo en el madre Y en su sucursal: la unicidad
-- pasa a incluir el canal (coalesce para tratar null como "sin canal")
alter table conversations drop constraint if exists conversations_agency_id_contact_id_channel_key;
create unique index if not exists conversations_contact_channel_uidx
  on conversations (
    agency_id,
    contact_id,
    channel,
    (coalesce(channel_id, '00000000-0000-0000-0000-000000000000'::uuid))
  );

-- ─────────────────────────────────────────────
-- LEADS y FILES por sucursal · revisión de la venta
-- ─────────────────────────────────────────────
alter table leads
  add column if not exists branch_id uuid references branches(id) on delete set null;

create index if not exists leads_branch_idx on leads(branch_id);

alter table files
  add column if not exists branch_id uuid references branches(id) on delete set null,
  -- las ventas que nacen del pipeline entran "pendiente": un admin revisa
  -- los números y recién ahí queda "revisado".
  add column if not exists review_status file_review_status not null default 'revisado',
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references members(id) on delete set null;

create index if not exists files_review_idx on files(agency_id) where review_status = 'pendiente';

-- ─────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────
alter table branches enable row level security;
alter table wa_channels enable row level security;
alter table wa_session_state enable row level security;  -- sin policies a propósito
alter table routing_rules enable row level security;

-- sucursales: las ve todo el equipo, las administra el admin
drop policy if exists branches_select on branches;
create policy branches_select on branches for select to authenticated
  using (agency_id in (select app.my_agency_ids()));

drop policy if exists branches_write on branches;
create policy branches_write on branches for all to authenticated
  using (agency_id in (select app.my_admin_agency_ids()))
  with check (agency_id in (select app.my_admin_agency_ids()));

-- canales: los ve el staff (para saber por qué número está hablando),
-- los administra el admin. El worker entra con service role.
drop policy if exists wa_channels_select on wa_channels;
create policy wa_channels_select on wa_channels for select to authenticated
  using (agency_id in (select app.my_agency_ids()));

drop policy if exists wa_channels_write on wa_channels;
create policy wa_channels_write on wa_channels for all to authenticated
  using (agency_id in (select app.my_admin_agency_ids()))
  with check (agency_id in (select app.my_admin_agency_ids()));

drop policy if exists routing_rules_select on routing_rules;
create policy routing_rules_select on routing_rules for select to authenticated
  using (agency_id in (select app.my_agency_ids()));

drop policy if exists routing_rules_write on routing_rules;
create policy routing_rules_write on routing_rules for all to authenticated
  using (agency_id in (select app.my_admin_agency_ids()))
  with check (agency_id in (select app.my_admin_agency_ids()));

-- ─────────────────────────────────────────────
-- BACKFILL: cada agencia arranca con una sucursal y su número madre.
-- ─────────────────────────────────────────────
insert into branches (agency_id, name, is_default, position)
select a.id, 'Casa central', true, 0
from agencies a
where not exists (select 1 from branches b where b.agency_id = a.id);

-- todos los miembros existentes quedan en la sucursal por defecto
update members m
set branch_id = b.id
from branches b
where b.agency_id = m.agency_id and b.is_default and m.branch_id is null;

-- número madre por agencia, tomando lo que ya estaba en settings.whatsapp
insert into wa_channels (
  agency_id, branch_id, kind, is_mother, label, phone, phone_number_id, status,
  auto_reply_enabled, auto_reply_text
)
select
  a.id,
  null,
  'cloud_api',
  true,
  'Número madre',
  nullif(regexp_replace(coalesce(a.settings #>> '{whatsapp,display_number}', ''), '\D', '', 'g'), ''),
  a.settings #>> '{whatsapp,phone_number_id}',
  case when coalesce((a.settings #>> '{whatsapp,connected}')::boolean, false)
       then 'conectado'::wa_channel_status
       else 'desconectado'::wa_channel_status end,
  true,
  '¡Hola! Gracias por escribirnos. En un ratito te contacta uno de nuestros asesores para armarte el viaje. Contanos destino y fechas mientras tanto y vamos adelantando.'
from agencies a
where not exists (select 1 from wa_channels w where w.agency_id = a.id and w.is_mother);

-- canal (todavía sin vincular) para cada sucursal existente
insert into wa_channels (agency_id, branch_id, kind, is_mother, label, status)
select b.agency_id, b.id, 'baileys', false, 'Sucursal ' || b.name, 'desconectado'
from branches b
where not exists (select 1 from wa_channels w where w.branch_id = b.id);

-- las conversaciones que ya existían entraron por el número madre
update conversations c
set channel_id = w.id
from wa_channels w
where w.agency_id = c.agency_id and w.is_mother and c.channel_id is null;

-- leads y files existentes quedan en la sucursal por defecto
update leads l
set branch_id = b.id
from branches b
where b.agency_id = l.agency_id and b.is_default and l.branch_id is null;

update files f
set branch_id = b.id
from branches b
where b.agency_id = f.agency_id and b.is_default and f.branch_id is null;
