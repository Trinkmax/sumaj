-- viajerOS — Bootstrap de agencia nueva.
--
-- Hoy el único camino de alta de tenant es `createAgency` (onboarding): inserta
-- `agencies` + `members` y nada más. Las filas de infraestructura que Sumaj sí
-- tiene vinieron del backfill ONE-SHOT del 0014 y del seed demo — o sea que la
-- segunda agencia que se registre arranca sin nada de esto y falla en silencio:
--
--   · sin sucursal por defecto → routeToBranch() (src/lib/wa/inbound.ts) devuelve
--     null y los leads entran sin sucursal, sin avisar a nadie.
--   · sin número madre → el webhook de Meta no resuelve canal y descarta la
--     consulta; /config/whatsapp queda en un callejón sin salida.
--   · sin reglas de seguimiento → app.enqueue_followups() hace INNER JOIN contra
--     followup_rules: con 0 filas no encola nunca nada.
--
-- Va como TRIGGER y no como inserts desde el cliente por dos razones: (1) en el
-- momento del insert de `agencies` el creador todavía NO es member, así que
-- app.my_admin_agency_ids() está vacío y las policies branches_write /
-- wa_channels_write / followup_rules_insert rechazarían todo; (2) así el tenant
-- queda completo pase lo que pase con el resto del onboarding (si el insert de
-- `members` falla y el usuario recarga, la infraestructura ya está).

-- ─────────────────────────────────────────────
-- El trabajo real, idempotente: se puede llamar cuantas veces se quiera y solo
-- crea lo que falta. `security definer` para saltear las policies de admin
-- (arriba el por qué) + search_path vacío y todo calificado, como el resto de
-- las funciones del schema app.
-- ─────────────────────────────────────────────
create or replace function app.bootstrap_agency(a uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sucursal_id uuid;
  sucursal_nombre text;
begin
  -- 1. Sucursal por defecto: es el fallback de la derivación del número madre.
  --    `on conflict do nothing` cubre los dos únicos parciales que la protegen
  --    (branches_agency_id_name_key y branches_one_default_idx).
  insert into public.branches (agency_id, name, is_default, is_active, position)
  values (a, 'Casa central', true, true, 0)
  on conflict do nothing;

  -- la sucursal que va a llevar el canal: la de por defecto si hay alguna
  select b.id, b.name into sucursal_id, sucursal_nombre
  from public.branches b
  where b.agency_id = a
  order by b.is_default desc, b.position, b.created_at
  limit 1;

  -- 2. Número madre (Cloud API): por acá entran TODAS las consultas nuevas.
  --    Nace desconectado y sin phone_number_id — los completa el admin en
  --    /config/whatsapp. El texto es el mismo que dejó el backfill del 0014.
  insert into public.wa_channels (
    agency_id, branch_id, kind, is_mother, label, status,
    auto_reply_enabled, auto_reply_text
  )
  select
    a,
    null,
    'cloud_api'::public.wa_channel_kind,
    true,
    'Número madre',
    'desconectado'::public.wa_channel_status,
    true,
    '¡Hola! Gracias por escribirnos. En un ratito te contacta uno de nuestros asesores para armarte el viaje. Contanos destino y fechas mientras tanto y vamos adelantando.'
  where not exists (
    select 1 from public.wa_channels w
    where w.agency_id = a and w.is_mother
  );

  -- 3. Canal Baileys de la sucursal, todavía sin vincular: mismo shape que arma
  --    upsertBranch() cuando el admin crea una sucursal a mano.
  insert into public.wa_channels (agency_id, branch_id, kind, is_mother, label, status)
  select
    a,
    sucursal_id,
    'baileys'::public.wa_channel_kind,
    false,
    'Sucursal ' || sucursal_nombre,
    'desconectado'::public.wa_channel_status
  where sucursal_id is not null
    and not exists (
      select 1 from public.wa_channels w
      where w.branch_id = sucursal_id
    );

  -- 4. Reglas de seguimiento (48 hs / día 7 / día 21). Sin estas filas el
  --    seguimiento automático no existe para la agencia.
  insert into public.followup_rules (agency_id, touch_number, hours_after_silence, applies_to_stages)
  values
    (a, 1, 48,  array['contactado', 'presupuestado', 'negociacion']::public.lead_stage[]),
    (a, 2, 168, array['contactado', 'presupuestado', 'negociacion']::public.lead_stage[]),
    (a, 3, 504, array['presupuestado', 'negociacion']::public.lead_stage[])
  on conflict (agency_id, touch_number) do nothing;
end;
$$;

comment on function app.bootstrap_agency(uuid) is
  'Crea lo que le falta a una agencia para operar: sucursal por defecto, número madre, canal de la sucursal y las 3 reglas de seguimiento. Idempotente.';

-- ─────────────────────────────────────────────
-- El trigger es solo la mecha.
-- ─────────────────────────────────────────────
create or replace function app.bootstrap_agency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.bootstrap_agency(new.id);
  return new;
end;
$$;

drop trigger if exists bootstrap_agency on public.agencies;
create trigger bootstrap_agency after insert on public.agencies
for each row execute function app.bootstrap_agency();

-- nada nuevo expuesto: el schema app no se llama desde la Data API
revoke execute on function app.bootstrap_agency(uuid) from public, anon, authenticated;
revoke execute on function app.bootstrap_agency() from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- BACKFILL de las agencias que ya existen. Todo el bootstrap pregunta antes de
-- insertar, así que para Sumaj (que ya tiene sus filas del 0014) es un no-op.
-- ─────────────────────────────────────────────
do $$
declare a uuid;
begin
  for a in select id from public.agencies loop
    perform app.bootstrap_agency(a);
  end loop;
end $$;

-- red de seguridad para agencias con varias sucursales: el bootstrap se ocupa
-- de la sucursal por defecto, y acá cubrimos cualquier otra que se haya quedado
-- sin su número (mismo criterio que el backfill del 0014).
insert into public.wa_channels (agency_id, branch_id, kind, is_mother, label, status)
select
  b.agency_id,
  b.id,
  'baileys'::public.wa_channel_kind,
  false,
  'Sucursal ' || b.name,
  'desconectado'::public.wa_channel_status
from public.branches b
where not exists (
  select 1 from public.wa_channels w where w.branch_id = b.id
);
