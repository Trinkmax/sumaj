-- ═══════════════════════════════════════════════════════════════════════════
-- DIFUSIONES DESDE EL NÚMERO MADRE
--
-- Hasta acá el sistema solo sabía CONTESTAR: la consulta entraba por el número
-- madre y todo el resto era reacción. Esto es la primera vez que la agencia
-- ARRANCA la conversación con muchos a la vez — y es también la primera vez que
-- puede quemar el número si se hace mal. Por eso la migración no es solo tres
-- tablas: es el andamio que hace que difundir sea seguro.
--
-- ─────────────────────────────────────────────────────────────
-- POR QUÉ SOLO POR EL NÚMERO MADRE
--
-- Fuera de la ventana de 24 hs, WhatsApp solo deja escribir con una PLANTILLA
-- APROBADA, y las plantillas solo existen en la Cloud API. El número de una
-- sucursal (Baileys) podría mandar el mismo texto gratis, pero difundir desde un
-- número no oficial es la forma más rápida conocida de perderlo: WhatsApp lo
-- lee como spam y lo baja, y con él se va el historial de la sucursal entera.
-- Difundir se paga por el canal oficial; el SEGUIMIENTO de quien contesta sigue
-- siendo gratis por la sucursal, que es toda la arquitectura de este sistema.
--
-- ─────────────────────────────────────────────────────────────
-- EL LEAD CALIFICADO ES EL BOTÓN
--
-- Una difusión de texto plano devuelve respuestas que alguien tiene que leer y
-- clasificar a mano. Una difusión con BOTONES devuelve intención: el que toca
-- "Quiero info" abre la ventana de 24 hs, se convierte en lead con su nivel de
-- interés ya puesto y cae en la sucursal que corresponda. El que toca "No me
-- interesa" se da de baja solo, y esa baja PROTEGE el número (menos bloqueos =
-- mejor calidad = más límite de envío). Los botones los define la agencia
-- (`wa_templates.buttons`) y cada uno declara qué intención significa.
--
-- ─────────────────────────────────────────────────────────────
-- LO QUE SE GUARDA CONGELADO (y por qué)
--
-- `broadcasts` guarda una FOTO del texto y de los botones con los que salió.
-- Una plantilla se edita, se pausa o Meta la baja; el resultado de una difusión
-- que ya salió tiene que seguir contando la verdad de lo que recibió la gente,
-- seis meses después. Lo mismo con `broadcast_recipients.phone`: el contacto
-- puede cambiar de número.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. ESTADOS
-- ─────────────────────────────────────────────

do $$ begin
  create type broadcast_status as enum
    ('borrador', 'programada', 'enviando', 'enviada', 'cancelada');
exception when duplicate_object then null; end $$;

do $$ begin
  -- 'omitido' es distinto de 'fallido' a propósito: omitido lo decidimos
  -- nosotros (se dio de baja, no tiene teléfono, ya recibió una difusión hace
  -- dos días) y no es un problema que haya que arreglar. Fallido lo rechazó
  -- Meta y sí hay que mirarlo.
  create type broadcast_recipient_status as enum
    ('pendiente', 'enviado', 'entregado', 'leido', 'respondido', 'fallido', 'omitido');
exception when duplicate_object then null; end $$;

do $$ begin
  create type broadcast_intent as enum ('interesado', 'tal_vez', 'baja');
exception when duplicate_object then null; end $$;

comment on type broadcast_intent is
  'Qué significa el botón que tocó la persona. Es la calificación del lead, puesta por el cliente y no por el vendedor.';

-- ─────────────────────────────────────────────
-- 2. LA PLANTILLA, AHORA CON VIDA PROPIA EN META
--
-- `wa_templates` era una libreta de textos con un `is_approved` que el admin
-- tildaba a mano después de crear la plantilla en el panel de Meta. Eso convertía
-- cada difusión en un trámite en otra herramienta, y peor: el tilde podía mentir
-- (marcada como aprobada cuando Meta la había rechazado) y el envío fallaba sin
-- que nadie entendiera por qué. Ahora la plantilla se crea desde acá, viaja a
-- Meta y el estado LO DICE META.
-- ─────────────────────────────────────────────

alter table wa_templates
  add column if not exists category text not null default 'marketing',
  add column if not exists meta_id text,
  add column if not exists meta_status text not null default 'local',
  add column if not exists header_text text,
  add column if not exists footer_text text,
  add column if not exists buttons jsonb not null default '[]'::jsonb,
  add column if not exists variables text[] not null default '{}'::text[],
  add column if not exists rejected_reason text,
  add column if not exists quality_score text,
  add column if not exists synced_at timestamptz;

do $$ begin
  alter table wa_templates add constraint wa_templates_category_chk
    check (category in ('marketing', 'utility', 'authentication'));
exception when duplicate_object then null; end $$;

do $$ begin
  -- 'local' = todavía no viajó a Meta (o es de las viejas, cargadas a mano).
  -- El resto son los estados tal como los devuelve el Graph, en mayúscula.
  alter table wa_templates add constraint wa_templates_meta_status_chk
    check (meta_status in
      ('local', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'PENDING_DELETION'));
exception when duplicate_object then null; end $$;

comment on column wa_templates.category is
  'Categoría de Meta. Difundir es marketing (se paga y admite baja); avisar de algo que el cliente pidió es utility.';
comment on column wa_templates.buttons is
  'Botones de la plantilla: [{ "type": "quick_reply"|"url", "text": "...", "url": "...", "intent": "interesado"|"tal_vez"|"baja" }]. El orden ES el índice que Meta usa al enviar y al avisar del toque.';
comment on column wa_templates.variables is
  'Nombres de las variables del cuerpo, en orden de aparición ({{nombre}} → "nombre"). Meta las pide declaradas con un ejemplo al crear la plantilla.';
comment on column wa_templates.meta_status is
  'Lo que dice Meta, no lo que cree la agencia. "local" = nunca se mandó a aprobar.';

-- Dos plantillas de la misma agencia no pueden llamarse igual en Meta: el envío
-- las busca por nombre y una ambigüedad manda el mensaje equivocado.
create unique index if not exists wa_templates_meta_name_uidx
  on wa_templates(agency_id, meta_name);

/**
 * `is_approved` sigue existiendo porque de ella depende el seguimiento
 * automático (app.enqueue_followups la usa para elegir plantilla). Ahora es
 * DERIVADA: la manda Meta. Las plantillas viejas (meta_status = 'local')
 * conservan el tilde manual, que es lo único que tienen.
 */
create or replace function app.sync_template_approved()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.meta_status = 'APPROVED' then
    new.is_approved := true;
  elsif new.meta_status <> 'local' then
    new.is_approved := false;
  end if;
  return new;
end;
$$;

drop trigger if exists wa_templates_sync_approved on wa_templates;
create trigger wa_templates_sync_approved
  before insert or update of meta_status on wa_templates
  for each row execute function app.sync_template_approved();

-- ─────────────────────────────────────────────
-- 3. LA BAJA DEL CLIENTE
--
-- Una baja no es un dato administrativo: es la señal más barata que existe para
-- no perder el número. Meta mide bloqueos y reportes de spam, y con la calidad
-- cae el límite de envío diario. Respetar la baja es la política de crecimiento.
-- ─────────────────────────────────────────────

alter table contacts
  add column if not exists wa_opt_out_at timestamptz,
  add column if not exists wa_opt_out_reason text;

comment on column contacts.wa_opt_out_at is
  'Pidió no recibir más difusiones. NO frena los mensajes de una conversación en curso: frena las difusiones.';

create index if not exists contacts_opt_out_idx
  on contacts(agency_id) where wa_opt_out_at is not null;

-- El barrido de audiencia filtra por teléfono presente miles de veces: que el
-- índice ya venga ordenado por agencia evita el seq scan en agencias grandes.
create index if not exists contacts_agency_phone_idx
  on contacts(agency_id) where phone is not null;

-- ─────────────────────────────────────────────
-- 4. LA DIFUSIÓN
-- ─────────────────────────────────────────────

create table if not exists broadcasts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  name text not null,

  -- La plantilla con la que se armó. Puede desaparecer; la difusión no.
  template_id uuid references wa_templates(id) on delete set null,
  channel_id uuid references wa_channels(id) on delete set null,

  /* LA FOTO: con esto se pinta el resultado aunque la plantilla ya no exista.
     Sin esto, abrir una difusión de marzo mostraría el texto de hoy. */
  body_snapshot text not null,
  header_snapshot text,
  footer_snapshot text,
  buttons_snapshot jsonb not null default '[]'::jsonb,
  template_name_snapshot text,
  language_snapshot text not null default 'es_AR',

  status broadcast_status not null default 'borrador',

  /* Los filtros con los que se armó la audiencia. Se guardan para poder
     repetir la difusión y para explicar a quién se le mandó. */
  audience jsonb not null default '{}'::jsonb,

  /* A qué sucursal caen los que contestan. null = las reglas de derivación de
     siempre (routing_rules). Ponerlo a mano sirve para las difusiones de una
     sucursal puntual ("promo Tucumán"). */
  branch_id uuid references branches(id) on delete set null,

  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,

  /* Cuántos se mandan por corrida del despachador (cada 5 minutos). Es el
     freno de mano: 60 por corrida son ~720 por hora, muy por debajo del límite
     técnico de Meta y por arriba de cualquier tier real. Bajarlo hace la
     difusión más lenta y más segura. */
  throttle_per_run smallint not null default 60,

  total_recipients integer not null default 0,
  created_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint broadcasts_throttle_chk check (throttle_per_run between 1 and 500)
);

comment on table broadcasts is
  'Un envío masivo desde el número madre. Guarda una foto del mensaje: el resultado tiene que seguir siendo legible aunque la plantilla cambie.';

create index if not exists broadcasts_agency_idx
  on broadcasts(agency_id, created_at desc);

-- El despachador busca exactamente esto cada 5 minutos: que el índice sea
-- parcial lo deja en unas pocas filas aunque haya mil difusiones viejas.
create index if not exists broadcasts_pendientes_idx
  on broadcasts(scheduled_at) where status in ('programada', 'enviando');

drop trigger if exists broadcasts_updated_at on broadcasts;
create trigger broadcasts_updated_at
  before update on broadcasts
  for each row execute function app.set_updated_at();

-- ─────────────────────────────────────────────
-- 5. CADA PERSONA DE LA DIFUSIÓN
--
-- La fila se crea al armar la difusión, no al enviar: así el envío es
-- reanudable (se corta el deploy, vuelve y sigue donde iba) y nunca le manda
-- dos veces a la misma persona.
-- ─────────────────────────────────────────────

create table if not exists broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agencies(id) on delete cascade,
  broadcast_id uuid not null references broadcasts(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,

  /* El teléfono con el que SALIÓ. El contacto puede cambiarlo mañana y el
     historial tiene que seguir diciendo a qué número se mandó. */
  phone text not null,
  /* El nombre con el que se interpoló {{nombre}}, por el mismo motivo. */
  vars jsonb not null default '{}'::jsonb,

  status broadcast_recipient_status not null default 'pendiente',

  /* wamid de Meta. Es la llave con la que el webhook engancha el "entregado",
     el "leído" y —lo importante— la respuesta: cuando alguien toca un botón,
     Meta manda `context.id` con este mismo valor. */
  wa_message_id text,
  message_id uuid references messages(id) on delete set null,
  conversation_id uuid references conversations(id) on delete set null,

  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,

  /* La calificación: qué botón tocó y qué significa. */
  intent broadcast_intent,
  button_label text,
  reply_text text,

  /* El lead que generó esta respuesta. Es la métrica que importa. */
  lead_id uuid references leads(id) on delete set null,

  error_detail text,
  attempts smallint not null default 0,
  created_at timestamptz not null default now(),

  -- A una persona se le manda UNA vez por difusión. La restricción es del
  -- modelo y no del código: un reintento del despachador no puede duplicar.
  unique (broadcast_id, contact_id)
);

comment on table broadcast_recipients is
  'Una fila por persona y por difusión. Se crea al armar (no al enviar) para que el envío sea reanudable y nunca duplique.';

-- El despachador: "dame los pendientes de esta difusión".
create index if not exists broadcast_recipients_pendientes_idx
  on broadcast_recipients(broadcast_id) where status = 'pendiente';

-- El webhook: "de quién es este wamid". Único porque un wamid es de un solo
-- mensaje: sin la restricción, un estado de entrega podría pisar dos filas.
create unique index if not exists broadcast_recipients_wamid_uidx
  on broadcast_recipients(wa_message_id) where wa_message_id is not null;

-- El filtro de fatiga: "¿a esta persona le difundimos hace poco?".
create index if not exists broadcast_recipients_fatiga_idx
  on broadcast_recipients(agency_id, contact_id, sent_at desc) where sent_at is not null;

create index if not exists broadcast_recipients_broadcast_idx
  on broadcast_recipients(broadcast_id, status);

-- ─────────────────────────────────────────────
-- 6. LOS NÚMEROS DE UNA DIFUSIÓN
--
-- Vista y no columnas contadoras: el estado de cada persona cambia por tres
-- caminos distintos (el despachador, el webhook de entrega, el webhook de
-- respuesta) y mantener contadores sincronizados entre los tres es la clase de
-- cosa que se desincroniza en producción y nadie se entera. Mismo criterio que
-- `file_totals`.
-- ─────────────────────────────────────────────

create or replace view broadcast_totals
with (security_invoker = true) as
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
  count(distinct f.id)::int                                                as ventas,
  coalesce(sum(ft.total_sale) filter (where f.id is not null), 0)::numeric as venta_total
from broadcast_recipients r
-- La venta que salió de esta difusión: el file del lead que generó la respuesta.
left join files f on f.lead_id = r.lead_id
left join file_totals ft on ft.file_id = f.id
group by r.broadcast_id;

comment on view broadcast_totals is
  'Contadores en vivo de cada difusión, incluida la plata: sin esto una difusión se mide en "mensajes enviados", que no es lo que le importa a nadie.';

-- ─────────────────────────────────────────────
-- 7. LA AUDIENCIA
--
-- Elegir a quién se le manda es LA decisión de una difusión, y se toma
-- probando: "clientes de Brasil" → 84, "…que no compraron en 6 meses" → 31.
-- Por eso vive en SQL y no en TypeScript: el contador tiene que volver en
-- milisegundos con miles de contactos, y traerse las filas al servidor de Next
-- para contarlas ahí no escala ni permite que la pantalla se sienta viva.
--
-- SECURITY INVOKER (el default): la RLS de contacts y leads sigue mandando, así
-- que un freelance nunca puede difundirle a la cartera de otro.
-- ─────────────────────────────────────────────

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
  /* Última difusión que recibió cada persona (para el filtro de fatiga). */
  ultima_difusion as (
    select r.contact_id, max(r.sent_at) as sent_at
    from public.broadcast_recipients r
    where r.agency_id = p_agency and r.sent_at is not null
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
  'A quiénes alcanza una difusión con estos filtros. SECURITY INVOKER: la RLS decide qué contactos ve cada rol. Excluye siempre a los sin teléfono, a los dados de baja, a los que ya recibieron una difusión hace poco y —salvo que se pida lo contrario— a los que están en medio de una negociación.';

revoke all on function public.broadcast_audience(uuid, jsonb) from public;
grant execute on function public.broadcast_audience(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────
-- 8. RLS
--
-- Difundir es una acción del negocio, no de un vendedor: la crea y la dispara
-- un admin. Verla la ve todo el staff (el vendedor tiene que entender de dónde
-- salió el lead que le cayó).
-- ─────────────────────────────────────────────

alter table broadcasts enable row level security;
alter table broadcast_recipients enable row level security;

drop policy if exists broadcasts_select on broadcasts;
create policy broadcasts_select on broadcasts for select to authenticated
  using (agency_id in (select app.my_agency_ids()));

drop policy if exists broadcasts_write on broadcasts;
create policy broadcasts_write on broadcasts for all to authenticated
  using (agency_id in (select app.my_admin_agency_ids()))
  with check (agency_id in (select app.my_admin_agency_ids()));

drop policy if exists broadcast_recipients_select on broadcast_recipients;
create policy broadcast_recipients_select on broadcast_recipients for select to authenticated
  using (agency_id in (select app.my_agency_ids()));

drop policy if exists broadcast_recipients_write on broadcast_recipients;
create policy broadcast_recipients_write on broadcast_recipients for all to authenticated
  using (agency_id in (select app.my_admin_agency_ids()))
  with check (agency_id in (select app.my_admin_agency_ids()));

-- ─────────────────────────────────────────────
-- 9. EL DESPACHADOR
--
-- Mismo patrón que los seguimientos (migración 0015): el cron de Postgres
-- golpea la app y la app hace el trabajo, porque las credenciales de Meta viven
-- en el Vault y solo el service role las descifra.
--
-- Cada 5 minutos y no cada hora: una difusión de 500 personas con el freno en
-- 60 por corrida tarda 45 minutos. Con el cron horario tardaría nueve horas y
-- la mitad llegaría de madrugada.
-- ─────────────────────────────────────────────

create or replace function app.dispatch_broadcasts()
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  target text;
  secret text;
begin
  select value into target from public.app_config where key = 'broadcasts_url';
  select value into secret from public.app_config where key = 'followups_secret';

  if coalesce(target, '') = '' or coalesce(secret, '') = '' then
    return;  -- todavía no está configurado: nada que hacer
  end if;

  perform net.http_post(
    url := target,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', secret
    ),
    body := '{}'::jsonb
  );
end;
$$;

comment on function app.dispatch_broadcasts() is
  'Golpea /api/wa/broadcasts/run con el secreto del cron. El mismo secreto que los seguimientos (WA_CRON_SECRET): es el mismo deploy.';

-- La URL sale de la que ya está configurada para los seguimientos: es el mismo
-- deploy y así no hay un segundo lugar donde equivocarse al mudar de dominio.
insert into public.app_config (key, value)
select 'broadcasts_url', replace(value, '/api/wa/followups/run', '/api/wa/broadcasts/run')
from public.app_config
where key = 'followups_url' and value <> ''
on conflict (key) do nothing;

-- El cron: cada 5 minutos. Ya aplicado al proyecto remoto (jobid 5).
--   select cron.schedule('dispatch-broadcasts', '*/5 * * * *',
--                        'select app.dispatch_broadcasts()');
