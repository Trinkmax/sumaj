-- ═══════════════════════════════════════════════════════════════════════════
-- 0030 — El freelance ve ÚNICAMENTE lo suyo
--
-- Hasta acá la RLS le daba al freelance "lo suyo o sin asignar" (0003). El pool
-- de "sin asignar" era una comodidad para que la bandeja no arrancara vacía, y
-- terminó siendo una fuga: cinco leads de Tomás tenían su conversación SIN
-- asignar (cualquier freelance la abría con todo el historial), un lead de
-- Claudio tenía la conversación asignada a Tomás (Claudio no veía el chat de su
-- propio lead) y las 65 conversaciones que abrió la difusión —sin lead, sin
-- dueño— eran visibles para todos, teléfono incluido. Y la base entera de
-- clientes (87 contactos con documento, notas y dirección) era de cualquiera.
--
-- El modelo nuevo, en una frase: **el dueño de un contacto es el vendedor de su
-- lead, y todo lo demás lo hereda.**
--
--   · leads:          assigned_to = yo. Sin pool. Un lead sin vendedor lo ve y
--                     lo reparte un admin (reassignLead), que es lo que avisa.
--                     En una sucursal sin staff, el lead se asigna solo al
--                     freelance de la sucursal (app.pick_branch_operator).
--   · conversations:  el dueño del lead. `conversations.assigned_to` deja de ser
--                     una columna que se edita a mano: la deriva un trigger de
--                     `app.contact_owner()` al insertar y al cambiar el lead.
--                     Además, mientras tenga un lead ABIERTO de ese contacto, el
--                     chat es mío aunque la columna diga otra cosa (dos leads
--                     abiertos del mismo contacto con dos vendedores = los dos lo
--                     ven; ninguno se queda sin poder contestar).
--   · messages:       siguen a la conversación.
--   · contacts:       los de mis leads (cualquier etapa), mis chats, mis ventas,
--                     mis presupuestos, o cargados por mí (`contacts.created_by`,
--                     nuevo, lo estampa un trigger). La base entera de clientes
--                     ya no es de todos: es del staff.
--   · el resto:       activities / travelers / contact_tags / attachments /
--                     followups / file_travelers / broadcast_recipients / quotes
--                     siguen a la entidad de la que cuelgan.
--
-- Los helpers `app.my_*_ids()` son SECURITY DEFINER sin argumentos, igual que
-- `app.my_agency_ids()`: Postgres los evalúa UNA vez por query (initplan) y,
-- como el dueño de las tablas es `postgres`, adentro no aplica la RLS — es lo
-- que permite que la policy de `conversations` lea `leads` sin recursión.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. QUIÉN CARGÓ EL CONTACTO
--
-- Sin esto, un freelance que crea un contacto desde /clientes no lo vería
-- nunca (todavía no tiene lead ni chat) y el `insert().select()` del action
-- fallaría en el RETURNING con "new row violates row-level security policy".
-- Lo estampa un trigger y no el action: el contacto se crea desde cuatro lados
-- (createLead, createContact, promoteTravelerToContact, el puente de Instagram)
-- y con service role queda null, que es lo correcto.
-- ─────────────────────────────────────────────

alter table contacts
  add column if not exists created_by uuid references members(id) on delete set null;

comment on column contacts.created_by is
  'Miembro que cargó el contacto. Lo estampa app.stamp_contact_creator(); null si entró por webhook o migración. Le da visibilidad al freelance sobre lo que cargó él.';

create index if not exists contacts_created_by_idx
  on contacts(created_by) where created_by is not null;

create or replace function app.stamp_contact_creator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- sin JWT (service_role, webhooks, migraciones) no hay a quién atribuirlo
  if new.created_by is null and (select auth.uid()) is not null then
    new.created_by := app.my_member_id(new.agency_id);
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_contact_creator on contacts;
create trigger stamp_contact_creator
  before insert on contacts
  for each row execute function app.stamp_contact_creator();

-- Backfill best-effort: createContact deja "Contacto creado por X" en el
-- historial con el member_id. Lo que no tenga rastro queda null (el staff lo
-- ve igual; el freelance solo lo que le asignen).
update public.contacts c
set created_by = a.member_id
from (
  select distinct on (x.contact_id) x.contact_id, x.member_id
  from public.activities x
  where x.contact_id is not null
    and x.member_id is not null
    and x.type = 'sistema'
    and x.body like 'Contacto creado por %'
  order by x.contact_id, x.created_at
) a
where a.contact_id = c.id
  and c.created_by is null;

-- ─────────────────────────────────────────────
-- 2. HELPERS DE VISIBILIDAD (uno por entidad, sin argumentos → initplan)
-- ─────────────────────────────────────────────

/** Mis leads: los asignados a mí, en cualquier etapa. */
create or replace function app.my_lead_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id from public.leads l
  where l.assigned_to in (select app.my_member_ids())
$$;

/** Contactos de mis leads ABIERTOS: mientras lo esté trabajando, su chat es mío. */
create or replace function app.my_open_lead_contact_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.contact_id from public.leads l
  where l.assigned_to in (select app.my_member_ids())
    and l.stage in ('nuevo', 'contactado', 'presupuestado', 'negociacion')
$$;

/** Mis conversaciones: asignadas a mí, o del contacto de un lead abierto mío. */
create or replace function app.my_conversation_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.conversations c
  where c.assigned_to in (select app.my_member_ids())
     or c.contact_id in (select app.my_open_lead_contact_ids())
$$;

/** Mis ventas: las que tienen a mí como vendedor. */
create or replace function app.my_file_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select f.id from public.files f
  where f.seller_id in (select app.my_member_ids())
$$;

/** Mis presupuestos: los que armé yo, o los de un lead mío (aunque los haya armado un admin). */
create or replace function app.my_quote_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select q.id from public.quotes q
  where q.created_by in (select app.my_member_ids())
     or q.lead_id in (select app.my_lead_ids())
$$;

/**
 * Mis contactos: la persona detrás de cualquier cosa que sea mía, más los que
 * cargué yo. Es la lista de /clientes de un freelance.
 */
create or replace function app.my_contact_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.contact_id from public.leads l
  where l.assigned_to in (select app.my_member_ids())
  union
  select c.contact_id from public.conversations c
  where c.id in (select app.my_conversation_ids())
  union
  select f.contact_id from public.files f
  where f.seller_id in (select app.my_member_ids())
  union
  select q.contact_id from public.quotes q
  where q.contact_id is not null
    and q.id in (select app.my_quote_ids())
  union
  select c.id from public.contacts c
  where c.created_by in (select app.my_member_ids())
$$;

-- Los helpers se llaman desde las policies con la sesión del usuario: EXECUTE
-- explícito para authenticated y nada para anon/public (los default privileges
-- de la 0002 no alcanzan a las funciones que se crean desde el MCP).
revoke all on function app.my_lead_ids() from public, anon;
revoke all on function app.my_open_lead_contact_ids() from public, anon;
revoke all on function app.my_conversation_ids() from public, anon;
revoke all on function app.my_file_ids() from public, anon;
revoke all on function app.my_quote_ids() from public, anon;
revoke all on function app.my_contact_ids() from public, anon;
grant execute on function app.my_lead_ids() to authenticated;
grant execute on function app.my_open_lead_contact_ids() to authenticated;
grant execute on function app.my_conversation_ids() to authenticated;
grant execute on function app.my_file_ids() to authenticated;
grant execute on function app.my_quote_ids() to authenticated;
grant execute on function app.my_contact_ids() to authenticated;

-- ─────────────────────────────────────────────
-- 3. EL DUEÑO DE UN CONTACTO Y LA SINCRONÍA leads → conversations
--
-- `leads.assigned_to` es la única fuente de verdad. El dueño de un contacto es
-- el vendedor de su lead abierto más reciente; si no tiene ninguno abierto, el
-- del último lead cerrado (el que ganó sigue hablando con su cliente después
-- de la venta). Sin ningún lead con vendedor → null (los hilos de una difusión
-- no tienen dueño hasta que alguien contesta y un admin reparte).
-- ─────────────────────────────────────────────

create or replace function app.contact_owner(p_agency uuid, p_contact uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.assigned_to
  from public.leads l
  where l.agency_id = p_agency
    and l.contact_id = p_contact
    and l.assigned_to is not null
  order by (l.stage in ('nuevo', 'contactado', 'presupuestado', 'negociacion')) desc,
           l.updated_at desc
  limit 1
$$;

comment on function app.contact_owner(uuid, uuid) is
  'Vendedor dueño de un contacto: el del lead abierto más reciente, o del último cerrado. Es lo que hereda conversations.assigned_to.';

revoke all on function app.contact_owner(uuid, uuid) from public, anon;
grant execute on function app.contact_owner(uuid, uuid) to authenticated;

/**
 * Cambió el vendedor o la etapa de un lead → TODAS las conversaciones de ese
 * contacto (número madre, sucursal, Instagram) pasan al dueño nuevo.
 * SECURITY DEFINER a propósito: el freelance que mueve su lead de etapa no
 * tiene por qué poder escribir conversations, y el trigger sí.
 */
create or replace function app.sync_conversation_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  owner_id uuid;
begin
  if tg_op = 'DELETE' then
    r := old;
  else
    r := new;
    -- UPDATE OF dispara aunque el valor no cambie (updateLeadStage siempre
    -- setea stage): si no se movió nada, no hay nada que sincronizar
    if tg_op = 'UPDATE'
       and new.assigned_to is not distinct from old.assigned_to
       and new.stage = old.stage then
      return null;
    end if;
  end if;

  owner_id := app.contact_owner(r.agency_id, r.contact_id);

  update public.conversations c
     set assigned_to = owner_id
   where c.agency_id = r.agency_id
     and c.contact_id = r.contact_id
     and c.assigned_to is distinct from owner_id;

  return null;
end;
$$;

drop trigger if exists sync_conversation_owner on leads;
create trigger sync_conversation_owner
  after insert or delete or update of assigned_to, stage on leads
  for each row execute function app.sync_conversation_owner();

/**
 * La conversación hereda el dueño: al nacer (el webhook y deriveToBranch la
 * crean sin vendedor) y cada vez que alguien intenta cambiarle el vendedor a
 * mano. Si el contacto tiene dueño, gana el dueño; si no, vale lo que venga y,
 * en última instancia, quien la está abriendo (ensureConversation). Con service
 * role y sin lead queda null, que es lo correcto para los hilos de una difusión.
 */
create or replace function app.conversation_inherit_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.assigned_to := coalesce(
    app.contact_owner(new.agency_id, new.contact_id),
    new.assigned_to,
    case when tg_op = 'INSERT' then app.my_member_id(new.agency_id) end
  );
  return new;
end;
$$;

drop trigger if exists conversation_inherit_owner on conversations;
create trigger conversation_inherit_owner
  before insert or update of assigned_to on conversations
  for each row execute function app.conversation_inherit_owner();

-- ─────────────────────────────────────────────
-- 4. QUIÉN ATIENDE EN UNA SUCURSAL SIN STAFF
--
-- Calamuchita y La Carlota no tienen admin ni vendedor: son freelances. Si un
-- lead cae ahí sin vendedor, con el modelo nuevo no lo ve NADIE de la sucursal
-- hasta que un admin lo reparta a mano. Esta función elige al vendedor o
-- freelance activo de la sucursal con menos leads abiertos (empate: el más
-- antiguo). Si la sucursal tiene staff, devuelve null: el staff ve el pool y
-- reparte como siempre. La usan el webhook (lead nuevo) y deriveToBranch.
-- ─────────────────────────────────────────────

create or replace function app.pick_branch_operator(p_agency uuid, p_branch uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.members m
  where m.agency_id = p_agency
    and m.branch_id = p_branch
    and m.is_active
    and m.role in ('vendedor', 'freelance')
    -- si hay staff en la sucursal, no se auto-asigna: el staff reparte
    and not exists (
      select 1 from public.members s
      where s.agency_id = p_agency and s.branch_id = p_branch
        and s.is_active and s.role in ('admin', 'vendedor')
    )
  order by (
      select count(*) from public.leads l
      where l.assigned_to = m.id
        and l.stage in ('nuevo', 'contactado', 'presupuestado', 'negociacion')
    ) asc,
    m.created_at asc
  limit 1
$$;

comment on function app.pick_branch_operator(uuid, uuid) is
  'Freelance de la sucursal con menos leads abiertos, solo si la sucursal no tiene admin ni vendedor. Null = que reparta el staff.';

revoke all on function app.pick_branch_operator(uuid, uuid) from public, anon;
grant execute on function app.pick_branch_operator(uuid, uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────
-- 5. BACKFILL: las conversaciones que hoy no coinciden con su lead
--
-- Sin ids: se recalcula el dueño de cada conversación con la misma función
-- que va a usar el trigger. Hoy son 6 (5 hilos de leads de Tomás sin asignar
-- y el hilo del lead de Claudio asignado a Tomás); mañana serán las que sean.
-- Los hilos sin lead con vendedor (difusiones) no se tocan.
-- ─────────────────────────────────────────────

update public.conversations c
set assigned_to = o.owner_id
from (
  select c2.id, app.contact_owner(c2.agency_id, c2.contact_id) as owner_id
  from public.conversations c2
) o
where o.id = c.id
  and o.owner_id is not null
  and c.assigned_to is distinct from o.owner_id;

-- ─────────────────────────────────────────────
-- 6. DEDUPE POR TELÉFONO SIN VER LA BASE ENTERA
--
-- createLead y el diálogo de contacto nuevo buscan el teléfono con la sesión
-- del usuario. Con contacts restringido, el freelance no encontraría al
-- cliente de otro vendedor y crearía un DUPLICADO. Esta función mira la agencia
-- completa y devuelve lo mínimo (id + nombre) del teléfono que el usuario ya
-- escribió: no es una fuga, es la confirmación de que esa persona ya existe.
-- ─────────────────────────────────────────────

create or replace function public.find_contact_by_phone(p_phone text)
returns table (id uuid, full_name text, phone text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.full_name, c.phone
  from public.contacts c
  where c.agency_id in (select app.my_agency_ids())
    and c.phone = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
    and length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 8
  order by c.created_at
  limit 1
$$;

comment on function public.find_contact_by_phone(text) is
  'Dedupe de contacto por teléfono (ya normalizado con normalizePhone) sobre toda la agencia, para que un freelance no cree un duplicado del cliente de otro. Devuelve solo id y nombre.';

revoke all on function public.find_contact_by_phone(text) from public, anon;
grant execute on function public.find_contact_by_phone(text) to authenticated;

-- ─────────────────────────────────────────────
-- 7. POLICIES
--    staff (admin | vendedor) → todo lo de su agencia, como siempre
--    freelance               → lo suyo, definido por los helpers de arriba
-- ─────────────────────────────────────────────

-- LEADS ──────────────────────────────────────
drop policy if exists leads_select on leads;
create policy leads_select on leads for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or assigned_to in (select app.my_member_ids())
  );

-- El freelance solo puede crear leads para sí mismo (createLead ya lo hace;
-- ahora también lo dice la base) y no puede sacarse un lead de encima ni
-- pasárselo a otro: repartir es de admin.
drop policy if exists leads_insert on leads;
create policy leads_insert on leads for insert to authenticated
  with check (
    agency_id in (select app.my_agency_ids())
    and (
      agency_id in (select app.my_staff_agency_ids())
      or assigned_to in (select app.my_member_ids())
    )
  );

drop policy if exists leads_update on leads;
create policy leads_update on leads for update to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or assigned_to in (select app.my_member_ids())
  )
  with check (
    agency_id in (select app.my_agency_ids())
    and (
      agency_id in (select app.my_staff_agency_ids())
      or assigned_to in (select app.my_member_ids())
    )
  );

-- CONVERSATIONS ──────────────────────────────
drop policy if exists conversations_select on conversations;
create policy conversations_select on conversations for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or id in (select app.my_conversation_ids())
  );

-- El trigger conversation_inherit_owner corre ANTES del check: la fila nueva
-- ya trae el dueño del lead (o al que la abre), así que el freelance que abre
-- el chat de su lead pasa, y el que intenta abrir el de otro, no.
drop policy if exists conversations_insert on conversations;
create policy conversations_insert on conversations for insert to authenticated
  with check (
    agency_id in (select app.my_agency_ids())
    and (
      agency_id in (select app.my_staff_agency_ids())
      or assigned_to in (select app.my_member_ids())
      or contact_id in (select app.my_open_lead_contact_ids())
    )
  );

drop policy if exists conversations_update on conversations;
create policy conversations_update on conversations for update to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or id in (select app.my_conversation_ids())
  )
  with check (
    agency_id in (select app.my_agency_ids())
    and (
      agency_id in (select app.my_staff_agency_ids())
      or assigned_to in (select app.my_member_ids())
      or contact_id in (select app.my_open_lead_contact_ids())
    )
  );

-- MESSAGES ───────────────────────────────────
drop policy if exists messages_select on messages;
create policy messages_select on messages for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or conversation_id in (select app.my_conversation_ids())
  );

drop policy if exists messages_insert on messages;
create policy messages_insert on messages for insert to authenticated
  with check (
    agency_id in (select app.my_agency_ids())
    and (
      agency_id in (select app.my_staff_agency_ids())
      or conversation_id in (select app.my_conversation_ids())
    )
  );

drop policy if exists messages_update on messages;
create policy messages_update on messages for update to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or conversation_id in (select app.my_conversation_ids())
  )
  with check (
    agency_id in (select app.my_agency_ids())
    and (
      agency_id in (select app.my_staff_agency_ids())
      or conversation_id in (select app.my_conversation_ids())
    )
  );

-- CONTACTS + relacionados ────────────────────
drop policy if exists contacts_select on contacts;
create policy contacts_select on contacts for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or id in (select app.my_contact_ids())
  );

-- INSERT queda por agencia: el trigger stamp_contact_creator pone created_by
-- antes del check de SELECT del RETURNING, así el que lo cargó lo ve.
drop policy if exists contacts_insert on contacts;
create policy contacts_insert on contacts for insert to authenticated
  with check (agency_id in (select app.my_agency_ids()));

drop policy if exists contacts_update on contacts;
create policy contacts_update on contacts for update to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or id in (select app.my_contact_ids())
  )
  with check (agency_id in (select app.my_agency_ids()));

drop policy if exists contact_tags_select on contact_tags;
create policy contact_tags_select on contact_tags for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or contact_id in (select app.my_contact_ids())
  );
drop policy if exists contact_tags_insert on contact_tags;
create policy contact_tags_insert on contact_tags for insert to authenticated
  with check (
    agency_id in (select app.my_agency_ids())
    and (
      agency_id in (select app.my_staff_agency_ids())
      or contact_id in (select app.my_contact_ids())
    )
  );
drop policy if exists contact_tags_delete on contact_tags;
create policy contact_tags_delete on contact_tags for delete to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or contact_id in (select app.my_contact_ids())
  );

drop policy if exists travelers_select on travelers;
create policy travelers_select on travelers for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or contact_id in (select app.my_contact_ids())
    or linked_contact_id in (select app.my_contact_ids())
  );
drop policy if exists travelers_insert on travelers;
create policy travelers_insert on travelers for insert to authenticated
  with check (
    agency_id in (select app.my_agency_ids())
    and (
      agency_id in (select app.my_staff_agency_ids())
      or contact_id in (select app.my_contact_ids())
    )
  );
drop policy if exists travelers_update on travelers;
create policy travelers_update on travelers for update to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or contact_id in (select app.my_contact_ids())
  )
  with check (agency_id in (select app.my_agency_ids()));
drop policy if exists travelers_delete on travelers;
create policy travelers_delete on travelers for delete to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or contact_id in (select app.my_contact_ids())
  );

-- attachments: la app todavía no la usa; queda coherente igual
drop policy if exists attachments_select on attachments;
create policy attachments_select on attachments for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or uploaded_by in (select app.my_member_ids())
  );
drop policy if exists attachments_insert on attachments;
create policy attachments_insert on attachments for insert to authenticated
  with check (
    agency_id in (select app.my_agency_ids())
    and (
      agency_id in (select app.my_staff_agency_ids())
      or uploaded_by in (select app.my_member_ids())
    )
  );
drop policy if exists attachments_delete on attachments;
create policy attachments_delete on attachments for delete to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or uploaded_by in (select app.my_member_ids())
  );

-- ACTIVITIES ─────────────────────────────────
-- Lo que hice yo, lo de mis leads y lo de mis ventas. Las notas de OTRO
-- vendedor sobre el mismo contacto (lead_id null) no: son de él.
drop policy if exists activities_select on activities;
create policy activities_select on activities for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or member_id in (select app.my_member_ids())
    or lead_id in (select app.my_lead_ids())
    or file_id in (select app.my_file_ids())
  );

drop policy if exists activities_insert on activities;
create policy activities_insert on activities for insert to authenticated
  with check (
    agency_id in (select app.my_agency_ids())
    and (
      agency_id in (select app.my_staff_agency_ids())
      or member_id in (select app.my_member_ids())
    )
  );

-- FOLLOWUPS ──────────────────────────────────
drop policy if exists followups_select on followups;
create policy followups_select on followups for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or lead_id in (select app.my_lead_ids())
  );
drop policy if exists followups_insert on followups;
create policy followups_insert on followups for insert to authenticated
  with check (
    agency_id in (select app.my_agency_ids())
    and (
      agency_id in (select app.my_staff_agency_ids())
      or lead_id in (select app.my_lead_ids())
    )
  );
drop policy if exists followups_update on followups;
create policy followups_update on followups for update to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or lead_id in (select app.my_lead_ids())
  )
  with check (agency_id in (select app.my_agency_ids()));
drop policy if exists followups_delete on followups;
create policy followups_delete on followups for delete to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or lead_id in (select app.my_lead_ids())
  );

-- QUOTES: los míos o los de un lead mío (P-0001 lo armó Tomás para el lead de
-- Claudio y Claudio no lo veía) ─────────────
drop policy if exists quotes_select on quotes;
create policy quotes_select on quotes for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or id in (select app.my_quote_ids())
  );
drop policy if exists quotes_update on quotes;
create policy quotes_update on quotes for update to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or id in (select app.my_quote_ids())
  )
  with check (agency_id in (select app.my_agency_ids()));

drop policy if exists quote_items_select on quote_items;
create policy quote_items_select on quote_items for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or quote_id in (select app.my_quote_ids())
  );

drop policy if exists quote_options_select on quote_options;
create policy quote_options_select on quote_options for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or quote_id in (select app.my_quote_ids())
  );

-- FILE_TRAVELERS: seguían a la agencia, ahora al file ─────
drop policy if exists file_travelers_select on file_travelers;
create policy file_travelers_select on file_travelers for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or file_id in (select app.my_file_ids())
  );
drop policy if exists file_travelers_insert on file_travelers;
create policy file_travelers_insert on file_travelers for insert to authenticated
  with check (
    agency_id in (select app.my_agency_ids())
    and (
      agency_id in (select app.my_staff_agency_ids())
      or file_id in (select app.my_file_ids())
    )
  );
drop policy if exists file_travelers_delete on file_travelers;
create policy file_travelers_delete on file_travelers for delete to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or file_id in (select app.my_file_ids())
  );

-- BROADCAST_RECIPIENTS: traen teléfono. La difusión en sí (texto, botones,
-- totales) la sigue viendo todo el equipo; la lista de personas, solo el staff
-- y, para el freelance, las que son suyas ─────
drop policy if exists broadcast_recipients_select on broadcast_recipients;
create policy broadcast_recipients_select on broadcast_recipients for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or contact_id in (select app.my_contact_ids())
  );
