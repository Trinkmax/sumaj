-- ═══════════════════════════════════════════════════════════════════════════
-- INSTAGRAM DIRECT: la segunda puerta de entrada
--
-- La agencia vende por Instagram tanto como por WhatsApp, y hasta hoy esas
-- consultas vivían en el celular de alguien. Esta migración las mete en el mismo
-- CRM: mismo contacto, mismo lead, misma bandeja, mismas herramientas.
--
-- Tres piezas:
--
--   1. `contacts.ig_id` — la identidad de la persona en Instagram (IGSID). Es lo
--      que hace que el segundo DM caiga en el contacto que ya existe y no cree
--      uno nuevo. El @usuario va en `contacts.instagram`, que ya estaba: sirve
--      para buscarlo y para reconocerlo, pero NO como identidad — se puede
--      cambiar cuando uno quiera.
--
--   2. `ig_accounts` — la cuenta profesional conectada, una por agencia. Mismo
--      diseño que `wa_cloud_credentials` (migración 0018): los secretos van al
--      Vault y acá queda solo el uuid, las funciones que los descifran son
--      SECURITY DEFINER con EXECUTE únicamente para `service_role`, y la fila
--      nace por trigger junto con el canal. Guarda además la configuración del
--      PUENTE A WHATSAPP, que es la razón de ser de todo esto (ver abajo).
--
--   3. `ig_bridge_links` — el hilo que cose los dos canales.
--
-- ─────────────────────────────────────────────────────────────
-- EL PUENTE A WHATSAPP (leer antes de tocar nada de bridge_*)
--
-- Instagram sirve para que la consulta entre; WhatsApp es donde la agencia
-- realmente vende (ahí está el teléfono, el seguimiento sin ventana de 24 hs y
-- el número de la sucursal). El puente va en las dos direcciones:
--
--   · DEL CLIENTE HACIA NOSOTROS: la respuesta automática del DM incluye un link
--     wa.me al número de la agencia con un texto ya escrito. El cliente toca y
--     aparece en WhatsApp. El problema obvio de eso es que del otro lado llega
--     como un desconocido y el CRM termina con dos contactos y dos leads de la
--     misma persona. Por eso el texto prellenado lleva una REFERENCIA corta
--     (`ig_bridge_links.code`): cuando ese WhatsApp entra, el webhook la
--     reconoce y sigue la charla en el MISMO contacto y el MISMO lead. Sin
--     referencia (el cliente borró el texto) todo funciona como antes: se crea
--     un contacto nuevo. Degradar, nunca romper.
--
--   · DE NOSOTROS HACIA EL CLIENTE: si el cliente deja su teléfono escrito en el
--     DM ("mi whats es 381…"), el sistema puede escribirle PRIMERO por WhatsApp
--     desde el número de la sucursal, sin esperar a que nadie mire la bandeja.
--     Es `auto_wa_enabled`, y viene APAGADO: que un negocio te escriba solo a un
--     número que soltaste al pasar es una decisión del dueño, no un default.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. IDENTIDAD DE INSTAGRAM EN EL CONTACTO
-- ─────────────────────────────────────────────

alter table contacts add column if not exists ig_id text;

comment on column contacts.ig_id is
  'IGSID: el id de esta persona en Instagram, tal como lo ve NUESTRA app. Es la identidad estable del contacto en el canal (el @usuario cambia).';

-- Dos contactos de la misma agencia no pueden ser la misma cuenta de Instagram:
-- es lo que garantiza que el segundo DM caiga en el contacto que ya existe.
create unique index if not exists contacts_ig_id_uidx
  on contacts(agency_id, ig_id) where ig_id is not null;

-- Buscar por @usuario (normalizado) para poder enganchar un DM con el contacto
-- que ya estaba cargado a mano con su Instagram.
create index if not exists contacts_instagram_idx
  on contacts(agency_id, lower(instagram)) where instagram is not null;

-- ─────────────────────────────────────────────
-- 2. EL CANAL
-- ─────────────────────────────────────────────

-- Una sola cuenta de Instagram por agencia, igual que hay un solo número madre.
-- Sin esto, dos filas dejan al webhook eligiendo cuál usar con un maybeSingle().
create unique index if not exists wa_channels_one_instagram_idx
  on wa_channels(agency_id) where kind = 'instagram';

comment on table wa_channels is
  'Canales de mensajería de la agencia: número madre (cloud_api), número de cada sucursal (baileys) y cuenta de Instagram (instagram). El nombre wa_ quedó de cuando era solo WhatsApp.';

-- ─────────────────────────────────────────────
-- 3. LA CUENTA DE INSTAGRAM CONECTADA
-- ─────────────────────────────────────────────

create table if not exists ig_accounts (
  channel_id uuid primary key references wa_channels(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,

  -- Cómo se conectó. Meta ofrece dos caminos y no son intercambiables: cambia el
  -- host del Graph, a qué id se le postea y con qué secreto se firma el webhook.
  --   instagram_login → graph.instagram.com, se postea al ig_user_id, firma con
  --                     el Instagram App Secret. No necesita Página de Facebook.
  --   facebook_login  → graph.facebook.com, se postea al page_id, firma con el
  --                     App Secret de la app de Meta. Necesita la Página linkeada.
  auth_mode text not null default 'instagram_login'
    check (auth_mode in ('instagram_login', 'facebook_login')),

  -- Identificadores públicos (los mismos que ve el admin en el panel de Meta)
  app_id text,
  ig_user_id text,                    -- id de la cuenta profesional
  page_id text,                       -- solo en facebook_login
  username text,                      -- @sumajviajes
  account_name text,
  profile_picture_url text,
  followers_count integer,

  -- Secretos: solo el uuid del Vault. El valor nunca vuelve al navegador.
  token_secret_id uuid,
  app_secret_id uuid,
  verify_secret_id uuid,

  -- URL propia del webhook de esta agencia. Mismo motivo que en WhatsApp: el GET
  -- de verificación de Meta manda solo hub.mode / hub.verify_token /
  -- hub.challenge, así que el tenant tiene que venir en la ruta. 128 bits opacos.
  webhook_slug text not null unique
    default replace(gen_random_uuid()::text, '-', ''),

  -- Huellas del token para la pantalla (nunca el token)
  token_tail text,
  token_expires_at timestamptz,       -- los long-lived de Instagram duran 60 días
  token_scopes text[],

  -- Foto del último diagnóstico contra Meta
  checked_at timestamptz,
  check_ok boolean,
  checks jsonb not null default '[]'::jsonb,
  webhook_subscribed boolean not null default false,
  webhook_callback_url text,

  -- ── PUENTE A WHATSAPP ──
  -- Del cliente hacia nosotros: link wa.me en la respuesta automática.
  bridge_enabled boolean not null default true,
  bridge_phone text,                  -- E.164 sin '+'; null = el número madre
  bridge_label text not null default 'Escribinos por WhatsApp',
  bridge_text text not null default '¡Hola! Les escribo desde Instagram.',

  -- De nosotros hacia el cliente: si deja el teléfono en el DM, le escribimos.
  auto_wa_enabled boolean not null default false,
  auto_wa_text text not null default
    '¡Hola {{nombre}}! Te escribo por tu consulta de Instagram. Contame destino y fechas y te armo una propuesta.',
  -- Con qué código de país se completa un teléfono que el cliente escribió
  -- suelto ("381 555 4433"). Sin esto no hay forma de saber a qué país llamar.
  phone_country_code text not null default '54',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ig_accounts_agency_idx on ig_accounts(agency_id);

-- El webhook resuelve el tenant por el id de la cuenta que viene en el payload:
-- sin unicidad, dos agencias con el mismo id (un copy/paste, una prueba) rompen
-- el webhook de las dos.
create unique index if not exists ig_accounts_ig_user_id_key
  on ig_accounts(ig_user_id) where ig_user_id is not null;

comment on table ig_accounts is
  'Cuenta de Instagram conectada por agencia + configuración del puente a WhatsApp. Los secretos viven en el Vault; acá queda el uuid. RLS sin policies: solo service role.';
comment on column ig_accounts.webhook_slug is
  'Parte opaca de la URL del webhook: /api/ig/webhook/{slug}. Es lo único que identifica al tenant en el GET de verificación de Meta.';
comment on column ig_accounts.auto_wa_enabled is
  'Si el cliente deja su teléfono en el DM, el sistema le escribe primero por WhatsApp desde el número de la sucursal. Apagado por default a propósito.';

alter table ig_accounts enable row level security;
revoke all on public.ig_accounts from anon, authenticated;

-- ─────────────────────────────────────────────
-- 4. EL PUENTE: referencia que cose el DM con el WhatsApp
--
-- El código viaja en el texto prellenado del link wa.me. Cuando ese WhatsApp
-- entra, el webhook lo encuentra en el mensaje y sabe que esa persona es la
-- misma que venía hablando por Instagram.
-- ─────────────────────────────────────────────

create table if not exists ig_bridge_links (
  -- 8 hex en mayúscula: corto para que no ensucie el mensaje del cliente y
  -- suficientemente opaco para que no se adivine el de otro.
  code text primary key
    default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  agency_id uuid not null references agencies(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  -- el hilo de Instagram del que salió
  conversation_id uuid references conversations(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  -- el hilo de WhatsApp donde terminó (se completa al canjearlo)
  wa_conversation_id uuid references conversations(id) on delete set null,
  used_at timestamptz,
  -- Un código viejo que aparece en un mensaje de otra persona no puede fusionar
  -- contactos para siempre: a los 30 días deja de valer.
  expires_at timestamptz not null default now() + interval '30 days',
  created_at timestamptz not null default now()
);

create index if not exists ig_bridge_links_contact_idx on ig_bridge_links(contact_id);
create index if not exists ig_bridge_links_agency_idx on ig_bridge_links(agency_id, created_at desc);

comment on table ig_bridge_links is
  'Referencia corta que viaja en el texto del link wa.me de Instagram. Al entrar el WhatsApp, el webhook la reconoce y sigue en el mismo contacto y el mismo lead. RLS sin policies: solo service role.';

alter table ig_bridge_links enable row level security;
revoke all on public.ig_bridge_links from anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ACCESO AL VAULT — mismas reglas que wa_cloud_* (0018 y 0019)
--
-- vault.decrypted_secrets no lo lee ni service_role, y el esquema vault no está
-- expuesto por PostgREST. Estas funciones son la única puerta: SECURITY DEFINER,
-- search_path vacío y EXECUTE solo para service_role. El revoke va primero
-- porque Postgres le da EXECUTE a `public` (o sea, también a anon y
-- authenticated) a toda función nueva del esquema public.
-- ═══════════════════════════════════════════════════════════════════════════

/** Guarda (o pisa) uno de los tres secretos de la cuenta en el Vault. */
create or replace function public.ig_secret_set(
  p_channel_id uuid,
  p_slot text,          -- 'token' | 'app_secret' | 'verify_token'
  p_value text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_name text;
  v_id uuid;
begin
  if p_slot not in ('token', 'app_secret', 'verify_token') then
    raise exception 'slot inválido: %', p_slot;
  end if;
  if p_value is null or length(trim(p_value)) = 0 then
    raise exception 'el secreto no puede venir vacío';
  end if;

  select case p_slot
           when 'token'        then a.token_secret_id
           when 'app_secret'   then a.app_secret_id
           else                     a.verify_secret_id
         end
    into v_existing
    from public.ig_accounts a
   where a.channel_id = p_channel_id;

  if not found then
    raise exception 'el canal % no tiene cuenta de Instagram', p_channel_id;
  end if;

  v_name := 'ig/' || p_channel_id::text || '/' || p_slot;

  -- Si la fila perdió el uuid pero el secreto quedó en el Vault (el nombre es
  -- único), lo reusamos en vez de chocar contra el índice.
  if v_existing is null then
    select s.id into v_existing from vault.secrets s where s.name = v_name;
  end if;

  if v_existing is null then
    v_id := vault.create_secret(p_value, v_name, 'Credencial de Instagram Direct');
  else
    perform vault.update_secret(v_existing, p_value);
    v_id := v_existing;
  end if;

  update public.ig_accounts
     set token_secret_id  = case when p_slot = 'token'        then v_id else token_secret_id end,
         app_secret_id    = case when p_slot = 'app_secret'   then v_id else app_secret_id end,
         verify_secret_id = case when p_slot = 'verify_token' then v_id else verify_secret_id end,
         updated_at       = now()
   where channel_id = p_channel_id;
end;
$$;

/** Borra del Vault los secretos del canal (desconectar la cuenta). */
create or replace function public.ig_secret_clear(p_channel_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select array_remove(
           array[a.token_secret_id, a.app_secret_id, a.verify_secret_id],
           null
         )
    into v_ids
    from public.ig_accounts a
   where a.channel_id = p_channel_id;

  if v_ids is not null and array_length(v_ids, 1) > 0 then
    delete from vault.secrets s where s.id = any(v_ids);
  end if;

  update public.ig_accounts
     set token_secret_id = null,
         app_secret_id = null,
         verify_secret_id = null,
         token_tail = null,
         token_expires_at = null,
         token_scopes = null,
         webhook_subscribed = false,
         check_ok = null,
         checks = '[]'::jsonb,
         updated_at = now()
   where channel_id = p_channel_id;
end;
$$;

/**
 * Config completa de la cuenta, con los secretos descifrados y la configuración
 * del puente. La usan el envío, el webhook y el asistente de conexión — todos
 * con service role. NUNCA se serializa hacia el navegador.
 *
 * Trae el puente adentro a propósito: el webhook necesita las dos cosas en el
 * mismo golpe y así no paga un segundo viaje por cada DM que entra.
 */
create or replace function public.ig_config(p_channel_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'channel_id',          a.channel_id,
    'agency_id',           a.agency_id,
    'auth_mode',           a.auth_mode,
    'app_id',              a.app_id,
    'ig_user_id',          a.ig_user_id,
    'page_id',             a.page_id,
    'username',            a.username,
    'webhook_slug',        a.webhook_slug,
    'token',        (select s.decrypted_secret from vault.decrypted_secrets s where s.id = a.token_secret_id),
    'app_secret',   (select s.decrypted_secret from vault.decrypted_secrets s where s.id = a.app_secret_id),
    'verify_token', (select s.decrypted_secret from vault.decrypted_secrets s where s.id = a.verify_secret_id),
    'bridge_enabled',      a.bridge_enabled,
    'bridge_phone',        a.bridge_phone,
    'bridge_label',        a.bridge_label,
    'bridge_text',         a.bridge_text,
    'auto_wa_enabled',     a.auto_wa_enabled,
    'auto_wa_text',        a.auto_wa_text,
    'phone_country_code',  a.phone_country_code
  )
  from public.ig_accounts a
  where a.channel_id = p_channel_id;
$$;

/** Igual, entrando por el slug de la URL del webhook (el camino normal). */
create or replace function public.ig_config_by_slug(p_slug text)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select public.ig_config(a.channel_id)
  from public.ig_accounts a
  where a.webhook_slug = p_slug
  limit 1;
$$;

/** Igual, entrando por el id de la cuenta de Instagram que viene en el payload. */
create or replace function public.ig_config_by_ig_user_id(p_ig_user_id text)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select public.ig_config(a.channel_id)
  from public.ig_accounts a
  where a.ig_user_id = p_ig_user_id
  limit 1;
$$;

/**
 * ¿Alguna agencia tiene ESE verify token? Solo para el handshake de una URL sin
 * slug. La comparación se hace acá adentro para no sacar los tokens de la base.
 */
create or replace function public.ig_verify_token_matches(p_token text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.ig_accounts a
    join vault.decrypted_secrets s on s.id = a.verify_secret_id
    where s.decrypted_secret = p_token
  );
$$;

revoke all on function public.ig_secret_set(uuid, text, text) from public;
revoke all on function public.ig_secret_clear(uuid) from public;
revoke all on function public.ig_config(uuid) from public;
revoke all on function public.ig_config_by_slug(text) from public;
revoke all on function public.ig_config_by_ig_user_id(text) from public;
revoke all on function public.ig_verify_token_matches(text) from public;

grant execute on function public.ig_secret_set(uuid, text, text) to service_role;
grant execute on function public.ig_secret_clear(uuid) to service_role;
grant execute on function public.ig_config(uuid) to service_role;
grant execute on function public.ig_config_by_slug(text) to service_role;
grant execute on function public.ig_config_by_ig_user_id(text) to service_role;
grant execute on function public.ig_verify_token_matches(text) to service_role;

-- ─────────────────────────────────────────────
-- 5. Todo canal de Instagram nace con su fila (y con su slug de webhook)
--
-- Por trigger y no en el alta, por lo mismo que en la 0018: el canal se puede
-- crear desde más de un lado y una agencia sin fila deja la pantalla sin URL de
-- webhook que mostrar.
-- ─────────────────────────────────────────────

create or replace function public.ig_accounts_bootstrap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'instagram' then
    insert into public.ig_accounts (channel_id, agency_id)
    values (new.id, new.agency_id)
    on conflict (channel_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists ig_accounts_bootstrap on wa_channels;
create trigger ig_accounts_bootstrap
  after insert on wa_channels
  for each row execute function public.ig_accounts_bootstrap();

-- Backfill por si ya existiera algún canal de Instagram creado a mano.
insert into ig_accounts (channel_id, agency_id)
select w.id, w.agency_id
from wa_channels w
where w.kind = 'instagram'
  and not exists (select 1 from ig_accounts a where a.channel_id = w.id);
