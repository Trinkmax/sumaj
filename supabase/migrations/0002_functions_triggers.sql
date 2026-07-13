-- Funciones auxiliares (schema privado, no expuesto por la Data API) + triggers

create schema if not exists app;

-- Agencias a las que pertenece el usuario actual (para RLS)
create or replace function app.my_agency_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select agency_id from public.members
  where user_id = (select auth.uid()) and is_active
$$;

-- member_id del usuario actual en una agencia
create or replace function app.my_member_id(a uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.members
  where agency_id = a and user_id = (select auth.uid()) and is_active
$$;

-- ¿el usuario actual es admin de la agencia?
create or replace function app.is_admin(a uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members
    where agency_id = a and user_id = (select auth.uid())
      and role = 'admin' and is_active
  )
$$;

-- ¿es admin o vendedor (no freelance)?
create or replace function app.is_staff(a uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members
    where agency_id = a and user_id = (select auth.uid())
      and role in ('admin', 'vendedor') and is_active
  )
$$;

-- Versiones sin argumentos → Postgres las evalúa UNA vez por query (initplan),
-- clave para performance de RLS. Usarlas siempre en políticas de SELECT.
create or replace function app.my_staff_agency_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select agency_id from public.members
  where user_id = (select auth.uid())
    and role in ('admin', 'vendedor') and is_active
$$;

create or replace function app.my_admin_agency_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select agency_id from public.members
  where user_id = (select auth.uid())
    and role = 'admin' and is_active
$$;

create or replace function app.my_member_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.members
  where user_id = (select auth.uid()) and is_active
$$;

-- ─────────────────────────────────────────────
-- updated_at automático
-- ─────────────────────────────────────────────
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'agencies','members','contacts','travelers','leads','conversations',
    'quotes','files','file_services'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I
       for each row execute function app.set_updated_at()', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────
-- Numeración por agencia: files F-0001, quotes P-0001, recibos R-0001
-- ─────────────────────────────────────────────
create or replace function app.assign_file_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  update public.agencies set file_seq = file_seq + 1
  where id = new.agency_id
  returning file_seq into n;
  new.number := n;
  new.code := 'F-' || lpad(n::text, 4, '0');
  return new;
end;
$$;

create trigger assign_file_number before insert on files
for each row execute function app.assign_file_number();

create or replace function app.assign_quote_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  update public.agencies set quote_seq = quote_seq + 1
  where id = new.agency_id
  returning quote_seq into n;
  new.number := n;
  new.code := 'P-' || lpad(n::text, 4, '0');
  return new;
end;
$$;

create trigger assign_quote_number before insert on quotes
for each row execute function app.assign_quote_number();

create or replace function app.assign_receipt_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  if new.direction = 'cobro' then
    update public.agencies set receipt_seq = receipt_seq + 1
    where id = new.agency_id
    returning receipt_seq into n;
    new.receipt_number := n;
    new.receipt_code := 'R-' || lpad(n::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger assign_receipt_number before insert on payments
for each row execute function app.assign_receipt_number();

-- ─────────────────────────────────────────────
-- Mantener conversación al día con cada mensaje
-- ─────────────────────────────────────────────
create or replace function app.on_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations set
    last_message_at = new.created_at,
    last_message_preview = left(coalesce(new.body, '[' || new.kind::text || ']'), 120),
    last_inbound_at = case when new.direction = 'in' then new.created_at else last_inbound_at end,
    unread_count = case when new.direction = 'in' then unread_count + 1 else unread_count end,
    status = 'abierta',
    updated_at = now()
  where id = new.conversation_id;

  -- un mensaje entrante cancela seguimientos pendientes y resetea el contador de toques
  if new.direction = 'in' then
    update public.followups set status = 'cancelado'
    where conversation_id = new.conversation_id and status = 'pendiente';
  end if;

  return new;
end;
$$;

create trigger on_message_insert after insert on messages
for each row execute function app.on_message_insert();

-- ─────────────────────────────────────────────
-- Permisos del schema app: solo authenticated puede ejecutar
-- ─────────────────────────────────────────────
revoke all on all functions in schema app from public, anon;
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
alter default privileges in schema app revoke execute on functions from public;

-- ─────────────────────────────────────────────
-- Vista de totales por file (security invoker → respeta RLS)
-- ─────────────────────────────────────────────
create view file_totals
with (security_invoker = true) as
select
  f.id as file_id,
  f.agency_id,
  coalesce(s.total_cost, 0)::numeric(12,2) as total_cost,
  coalesce(s.total_sale, 0)::numeric(12,2) as total_sale,
  (coalesce(s.total_sale, 0) - coalesce(s.total_cost, 0))::numeric(12,2) as utility,
  coalesce(p.paid, 0)::numeric(12,2) as paid_total,
  (coalesce(s.total_sale, 0) - coalesce(p.paid, 0))::numeric(12,2) as balance
from files f
left join lateral (
  select sum(cost) as total_cost, sum(price) as total_sale
  from file_services fs where fs.file_id = f.id
) s on true
left join lateral (
  select sum(amount_in_file_currency) as paid
  from payments p where p.file_id = f.id and p.direction = 'cobro'
) p on true;
