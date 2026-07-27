-- viajerOS — Presupuestos v2 + operativa de files y comisiones
--
--  1. quotes: pasajeros desglosados (adultos / menores con edad / infantes)
--  2. quote_options: comparar dos alternativas en un mismo presupuesto
--     ("con este hotel vale 10, con este otro 15")
--  3. file_services: fecha de caída de la reserva + imágenes (vouchers)
--  4. files: esquema de comisión del vendedor (% de utilidad o monto fijo)
--  5. payments: pago de comisiones (member_id, file_id opcional)
--  6. quote_public: expone el desglose de pasajeros y las opciones

-- ─────────────────────────────────────────────
-- 1. QUOTES — pasajeros desglosados
--    El infante paga el 30% (70% menos) → factor en la app (domain.ts).
-- ─────────────────────────────────────────────
alter table quotes
  add column if not exists pax_adults smallint not null default 2,
  add column if not exists pax_children smallint not null default 0,
  add column if not exists pax_infants smallint not null default 0,
  -- edades de los menores, en el mismo orden en que se cargaron: [8, 11]
  add column if not exists children_ages jsonb not null default '[]'::jsonb;

-- los presupuestos existentes tenían un único número de pasajeros: son adultos
update quotes set pax_adults = greatest(coalesce(pax, 1), 1);

-- ─────────────────────────────────────────────
-- 2. QUOTE_OPTIONS — alternativas comparables dentro de un presupuesto
--    Los ítems con option_id nulo son comunes a todas las opciones
--    (típicamente el aéreo); los que tienen option_id pertenecen a esa alternativa.
-- ─────────────────────────────────────────────
create table if not exists quote_options (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  quote_id uuid not null references quotes(id) on delete cascade,
  name text not null,                     -- "Hotel Riu Palace 5★"
  subtitle text,                          -- "All inclusive, vista al mar"
  is_recommended boolean not null default false,
  position integer not null default 0,
  -- totales denormalizados (los calcula la app con computeQuoteTotals)
  total_cost numeric(12,2) not null default 0,
  total_price numeric(12,2) not null default 0,
  per_person numeric(12,2) not null default 0, -- precio por adulto
  created_at timestamptz not null default now()
);

create index if not exists quote_options_quote_idx on quote_options(quote_id);
create index if not exists quote_options_agency_idx on quote_options(agency_id);

alter table quotes
  add column if not exists accepted_option_id uuid references quote_options(id) on delete set null;

alter table quote_items
  add column if not exists option_id uuid references quote_options(id) on delete cascade;

create index if not exists quote_items_option_idx on quote_items(option_id);

alter table quote_options enable row level security;

drop policy if exists quote_options_select on quote_options;
create policy quote_options_select on quote_options for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or exists (
      select 1 from quotes q
      where q.id = quote_options.quote_id
        and q.created_by in (select app.my_member_ids())
    )
  );

drop policy if exists quote_options_insert on quote_options;
create policy quote_options_insert on quote_options for insert to authenticated
  with check (agency_id in (select app.my_agency_ids()));

drop policy if exists quote_options_update on quote_options;
create policy quote_options_update on quote_options for update to authenticated
  using (agency_id in (select app.my_agency_ids()))
  with check (agency_id in (select app.my_agency_ids()));

drop policy if exists quote_options_delete on quote_options;
create policy quote_options_delete on quote_options for delete to authenticated
  using (agency_id in (select app.my_agency_ids()));

-- ─────────────────────────────────────────────
-- 3. FILE_SERVICES — fecha de caída de la reserva + imágenes
--    deadline_date: hasta cuándo hay tiempo de pagarle al proveedor.
--    images: [{ "path": "agency_id/files/...", "name": "voucher.jpg" }]
-- ─────────────────────────────────────────────
alter table file_services
  add column if not exists deadline_date date,
  add column if not exists images jsonb not null default '[]'::jsonb;

create index if not exists file_services_deadline_idx
  on file_services(deadline_date)
  where deadline_date is not null and paid_to_supplier = false;

-- ─────────────────────────────────────────────
-- 4. FILES — esquema de comisión del vendedor
--    utilidad_pct: % sobre la utilidad del file (lo de siempre)
--    monto_fijo:   monto plano por venta (ej: enlatados grupales, USD 100)
-- ─────────────────────────────────────────────
alter table files
  add column if not exists commission_type text not null default 'utilidad_pct',
  add column if not exists commission_amount numeric(12,2) not null default 0,
  add column if not exists commission_label text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'files_commission_type_check'
  ) then
    alter table files add constraint files_commission_type_check
      check (commission_type in ('utilidad_pct', 'monto_fijo'));
  end if;
end $$;

-- ─────────────────────────────────────────────
-- 5. PAYMENTS — pago de comisiones a vendedores
--    El movimiento puede no tener file (liquidación del mes) → file_id opcional.
-- ─────────────────────────────────────────────
alter table payments alter column file_id drop not null;
alter table payments
  add column if not exists member_id uuid references members(id) on delete set null;

create index if not exists payments_member_idx on payments(member_id);

-- el vendedor ve sus propios pagos de comisión aunque no sea staff
drop policy if exists payments_select on payments;
create policy payments_select on payments for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or member_id in (select app.my_member_ids())
    or exists (
      select 1 from files f
      where f.id = payments.file_id
        and f.seller_id in (select app.my_member_ids())
    )
  );

-- ─────────────────────────────────────────────
-- 6. quote_public — el presupuesto de cara al cliente
--    Nunca costos ni comisiones. Ahora con desglose de pasajeros y opciones.
-- ─────────────────────────────────────────────
create or replace function public.quote_public(token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'code', q.code,
    'title', q.title,
    'destination', q.destination,
    'currency', q.currency,
    'pax', q.pax,
    'pax_adults', q.pax_adults,
    'pax_children', q.pax_children,
    'pax_infants', q.pax_infants,
    'children_ages', q.children_ages,
    'nights', q.nights,
    'trip_date_from', q.trip_date_from,
    'trip_date_to', q.trip_date_to,
    'valid_until', q.valid_until,
    'status', q.status,
    'total_price', q.total_price,
    'per_person', case
      when (q.pax_adults + q.pax_children + q.pax_infants * 0.3) > 0
        then round(q.total_price / (q.pax_adults + q.pax_children + q.pax_infants * 0.3), 2)
      else q.total_price
    end,
    'discount', q.discount,
    'notes', q.notes,
    'theme', q.theme,
    'created_at', q.created_at,
    'contact_name', c.full_name,
    'contact_phone', c.phone,
    'agency', jsonb_build_object(
      'name', a.name,
      'logo_url', a.logo_url,
      'phone', a.phone,
      'email', a.email
    ),
    'seller_name', m.display_name,
    -- servicios comunes a todas las opciones
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', qi.type,
        'description', qi.description
      ) order by qi.position)
      from public.quote_items qi
      where qi.quote_id = q.id and qi.show_in_client_quote and qi.option_id is null
    ), '[]'::jsonb),
    -- alternativas comparables, cada una con su precio
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', qo.id,
        'name', qo.name,
        'subtitle', qo.subtitle,
        'is_recommended', qo.is_recommended,
        'total_price', qo.total_price,
        'per_person', qo.per_person,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'type', qi.type,
            'description', qi.description
          ) order by qi.position)
          from public.quote_items qi
          where qi.option_id = qo.id and qi.show_in_client_quote
        ), '[]'::jsonb)
      ) order by qo.position)
      from public.quote_options qo
      where qo.quote_id = q.id
    ), '[]'::jsonb)
  )
  from public.quotes q
  join public.agencies a on a.id = q.agency_id
  left join public.contacts c on c.id = q.contact_id
  left join public.members m on m.id = q.created_by
  where q.public_token = token
$$;

revoke all on function public.quote_public(uuid) from public;
grant execute on function public.quote_public(uuid) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 7. Settings de agencia: fees automáticos del cotizador y comisión del vendedor
--    sobre el markup (estimado que ve el vendedor en el presupuesto).
-- ─────────────────────────────────────────────
alter table agencies alter column settings set default '{
  "quote_theme": {"color": "sand", "font": "editorial"},
  "quote_saved_notes": [],
  "quote_fees": {"aereo_pct": 2, "terrestre_pct": 4},
  "quote_seller_commission_pct": 30,
  "whatsapp": {"phone_number_id": null, "display_number": null, "connected": false},
  "usd_rate": null
}'::jsonb;

update agencies
set settings = settings
  || jsonb_build_object('quote_fees', coalesce(settings -> 'quote_fees', '{"aereo_pct": 2, "terrestre_pct": 4}'::jsonb))
  || jsonb_build_object('quote_seller_commission_pct', coalesce(settings -> 'quote_seller_commission_pct', '30'::jsonb));
