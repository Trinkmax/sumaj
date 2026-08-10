-- ─────────────────────────────────────────────
-- DIFUSIONES: tres arreglos de fondo sobre la 0027
--
-- 1. El despachador podía mandarle DOS VECES a la misma persona.
-- 2. `broadcast_totals` multiplicaba TODOS los contadores si un lead tenía más
--    de un file.
-- 3. El freno de fatiga no veía a los destinatarios que todavía no salieron.
-- ─────────────────────────────────────────────

-- ─────────────────────────────────────────────
-- 1. EL RECLAMO DEL DESTINATARIO
--
-- El cron es `*/5` con `net.http_post`, que es fire-and-forget: no espera a que
-- la corrida anterior termine. Una tanda de 120 envíos secuenciales pasa los 5
-- minutos sin esfuerzo, así que la corrida siguiente leía los MISMOS
-- `pendiente` que la primera todavía estaba mandando: la misma persona recibía
-- la promo dos veces, se pagaba dos veces y contaba doble contra el tope diario.
--
-- El `unique (broadcast_id, contact_id)` impide filas duplicadas, no ENVÍOS
-- duplicados: entre el SELECT y el UPDATE la fila sigue diciendo `pendiente`
-- durante todo el POST al Graph.
--
-- `claimed_at` es el reclamo: el despachador se apropia del lote con un UPDATE
-- condicionado (`status = 'pendiente' and (claimed_at is null or claimed_at <
-- now() - 15 min)`) y manda SOLO lo que ese UPDATE le devolvió. Bajo READ
-- COMMITTED la segunda corrida vuelve a evaluar la condición sobre la fila ya
-- escrita y se queda sin nada: es el lock, sin lock.
--
-- El vencimiento existe porque un request que muere a mitad de lote (timeout de
-- la plataforma) dejaría el reclamo puesto para siempre y esa gente no recibiría
-- nunca el mensaje.
-- ─────────────────────────────────────────────

alter table broadcast_recipients
  add column if not exists claimed_at timestamptz;

comment on column broadcast_recipients.claimed_at is
  'Cuándo una corrida del despachador se apropió de esta fila para mandarla. Vence a los 15 minutos: sin eso, un request cortado a la mitad dejaría a esta persona sin su mensaje para siempre.';

-- El despachador: "dame los pendientes de esta difusión que nadie reclamó".
create index if not exists broadcast_recipients_claim_idx
  on broadcast_recipients(broadcast_id, claimed_at)
  where status = 'pendiente';

-- ─────────────────────────────────────────────
-- 2. LOS CONTADORES, SIN MULTIPLICAR
--
-- La versión de la 0027 hacía `count(*)` DESPUÉS de `left join files`: un lead
-- con dos files (segundo viaje, o una conversión repetida — nada impide que un
-- lead tenga más de un file) duplicaba su fila y con ella el total, los
-- enviados, los respondidos y los interesados. Una difusión de 300 pasaba a
-- decir 301, y el embudo podía mostrar más respondidos que gente que respondió.
--
-- Ahora la plata se calcula aparte, agregada por difusión, y se pega ya
-- resumida: los contadores cuentan destinatarios y nada más.
-- ─────────────────────────────────────────────

create or replace view broadcast_totals
with (security_invoker = true) as
with ventas_por_difusion as (
  -- Un file entra una sola vez aunque su lead cuelgue de varios destinatarios,
  -- y `file_totals` da una fila por file: el distinct es sobre el file.
  select
    r.broadcast_id,
    count(distinct f.id)::int                    as ventas,
    coalesce(sum(ft.total_sale), 0)::numeric     as venta_total
  from broadcast_recipients r
  join files f on f.lead_id = r.lead_id
  left join file_totals ft on ft.file_id = f.id
  group by r.broadcast_id
)
select
  r.broadcast_id,
  count(*)::int                                                            as total,
  count(*) filter (where r.status = 'pendiente')::int                      as pendientes,
  count(*) filter (where r.status = 'omitido')::int                        as omitidos,
  count(*) filter (where r.status = 'fallido')::int                        as fallidos,
  -- "salió" es acumulativo: entregado, leído y respondido también salieron.
  count(*) filter (where r.sent_at is not null)::int                       as enviados,
  count(*) filter (where r.delivered_at is not null)::int                  as entregados,
  count(*) filter (where r.read_at is not null)::int                       as leidos,
  count(*) filter (where r.replied_at is not null)::int                    as respondidos,
  count(*) filter (where r.intent = 'interesado')::int                     as interesados,
  count(*) filter (where r.intent = 'tal_vez')::int                        as tal_vez,
  count(*) filter (where r.intent = 'baja')::int                           as bajas,
  count(*) filter (where r.lead_id is not null)::int                       as leads,
  coalesce(max(v.ventas), 0)::int                                          as ventas,
  coalesce(max(v.venta_total), 0)::numeric                                 as venta_total
from broadcast_recipients r
left join ventas_por_difusion v on v.broadcast_id = r.broadcast_id
group by r.broadcast_id;

comment on view broadcast_totals is
  'Contadores en vivo de cada difusión, incluida la plata: sin esto una difusión se mide en "mensajes enviados", que no es lo que le importa a nadie. La plata se agrega aparte para que un lead con dos files no multiplique el resto de los contadores.';

-- ─────────────────────────────────────────────
-- 3. LA FATIGA TAMBIÉN MIRA LO QUE ESTÁ POR SALIR
--
-- `ultima_difusion` solo miraba `sent_at`, o sea lo que YA salió. Una difusión
-- de 500 personas tarda 45 minutos en salir entera: durante esos 45 minutos sus
-- pendientes eran invisibles y una segunda difusión lanzada a las 9:05 volvía a
-- alcanzarlos. Recibían dos promos con minutos de diferencia, justo lo que la
-- pantalla promete evitar.
--
-- Ahora cuenta también lo que está en la cola de una difusión viva (`enviando`
-- o `programada`), fechado con la hora en que va a salir.
-- ─────────────────────────────────────────────

create index if not exists broadcast_recipients_en_cola_idx
  on broadcast_recipients(agency_id, contact_id)
  where status = 'pendiente';

create or replace function public.broadcast_audience(
  p_agency uuid,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  contact_id uuid,
  full_name text,
  phone text,
  is_client boolean,
  last_lead_stage lead_stage,
  last_destination text,
  branch_id uuid,
  last_broadcast_at timestamptz
)
language sql
stable
set search_path to ''
as $$
  with params as (
    select
      -- etiquetas: cualquiera de estas (o todas, según tags_mode)
      coalesce(
        (select array_agg((value #>> '{}')::uuid)
         from jsonb_array_elements(coalesce(p_filters -> 'tags', '[]'::jsonb))),
        '{}'::uuid[]
      )                                                              as tags,
      coalesce(p_filters ->> 'tags_mode', 'any')                     as tags_mode,
      coalesce(
        (select array_agg((value #>> '{}')::public.lead_stage)
         from jsonb_array_elements(coalesce(p_filters -> 'stages', '[]'::jsonb))),
        '{}'::public.lead_stage[]
      )                                                              as stages,
      p_filters ->> 'clients'                                        as clients,
      nullif(p_filters ->> 'branch_id', '')::uuid                    as branch_id,
      nullif(p_filters ->> 'assigned_to', '')::uuid                  as assigned_to,
      nullif(trim(coalesce(p_filters ->> 'destination', '')), '')    as destination,
      nullif(p_filters ->> 'created_from', '')::date                 as created_from,
      nullif(p_filters ->> 'created_to', '')::date                   as created_to,
      nullif(p_filters ->> 'birthday_month', '')::int                as birthday_month,
      nullif(p_filters ->> 'quiet_days', '')::int                    as quiet_days,
      -- Fatiga: por default no se le vuelve a difundir a alguien en 7 días.
      coalesce(nullif(p_filters ->> 'no_broadcast_days', '')::int, 7) as no_broadcast_days,
      -- Por default NO se molesta a quien está en medio de una negociación:
      -- una promo genérica arriba de un presupuesto en curso es la forma más
      -- rápida de que el cliente sienta que hablás con una máquina.
      coalesce((p_filters ->> 'skip_active')::boolean, true)          as skip_active
  ),
  /* Último lead de cada contacto: lo que define su etapa, su destino y su
     sucursal a los ojos de la difusión. */
  ultimo_lead as (
    select distinct on (l.contact_id)
      l.contact_id, l.stage, l.destination, l.branch_id, l.assigned_to, l.updated_at
    from public.leads l
    where l.agency_id = p_agency
    order by l.contact_id, l.updated_at desc
  ),
  /* Última difusión que recibió cada persona — o que TIENE POR RECIBIR.
     Lo que está en la cola de una difusión viva cuenta igual que lo ya enviado:
     si no, dos difusiones lanzadas con minutos de diferencia le pegan a la
     misma gente. Una programada para el jueves se fecha el jueves, así que hoy
     todavía no frena nada. */
  ultima_difusion as (
    select r.contact_id,
           max(coalesce(r.sent_at, b.scheduled_at, b.started_at, r.created_at)) as sent_at
    from public.broadcast_recipients r
    join public.broadcasts b on b.id = r.broadcast_id
    where r.agency_id = p_agency
      and (
        r.sent_at is not null
        or (r.status = 'pendiente' and b.status in ('enviando', 'programada'))
      )
    group by r.contact_id
  )
  select
    c.id,
    c.full_name,
    c.phone,
    c.is_client,
    ul.stage,
    ul.destination,
    ul.branch_id,
    ud.sent_at
  from public.contacts c
  cross join params p
  left join ultimo_lead ul on ul.contact_id = c.id
  left join ultima_difusion ud on ud.contact_id = c.id
  where c.agency_id = p_agency
    -- Sin teléfono no hay difusión posible. No es un filtro: es la realidad.
    and c.phone is not null and length(regexp_replace(c.phone, '\D', '', 'g')) >= 8
    -- La baja manda sobre cualquier filtro.
    and c.wa_opt_out_at is null

    and (cardinality(p.tags) = 0 or (
      case when p.tags_mode = 'all' then
        (select count(distinct ct.tag_id) from public.contact_tags ct
          where ct.contact_id = c.id and ct.tag_id = any (p.tags)) = cardinality(p.tags)
      else
        exists (select 1 from public.contact_tags ct
          where ct.contact_id = c.id and ct.tag_id = any (p.tags))
      end
    ))

    and (cardinality(p.stages) = 0 or ul.stage = any (p.stages))
    and (p.clients is null or p.clients = 'todos'
         or (p.clients = 'clientes' and c.is_client)
         or (p.clients = 'no_clientes' and not c.is_client))
    and (p.branch_id is null or ul.branch_id = p.branch_id)
    and (p.assigned_to is null or ul.assigned_to = p.assigned_to)
    and (p.destination is null or ul.destination ilike '%' || p.destination || '%')
    and (p.created_from is null or c.created_at >= p.created_from)
    and (p.created_to is null or c.created_at < p.created_to + 1)
    and (p.birthday_month is null
         or (c.birth_date is not null and extract(month from c.birth_date) = p.birthday_month))

    -- "hace cuánto que no sabemos nada": silencio real, medido por actividad.
    and (p.quiet_days is null or coalesce(ul.updated_at, c.created_at) < now() - make_interval(days => p.quiet_days))

    -- fatiga
    and (ud.sent_at is null or ud.sent_at < now() - make_interval(days => p.no_broadcast_days))

    -- no interrumpir una venta en curso
    and (not p.skip_active or ul.stage is null
         or ul.stage not in ('presupuestado', 'negociacion'))

  order by c.full_name;
$$;

comment on function public.broadcast_audience(uuid, jsonb) is
  'A quiénes alcanza una difusión con estos filtros. SECURITY INVOKER: la RLS decide qué contactos ve cada rol. Excluye siempre a los sin teléfono, a los dados de baja, a los que ya recibieron —o están por recibir— una difusión hace poco y —salvo que se pida lo contrario— a los que están en medio de una negociación.';

revoke all on function public.broadcast_audience(uuid, jsonb) from public;
grant execute on function public.broadcast_audience(uuid, jsonb) to authenticated;
