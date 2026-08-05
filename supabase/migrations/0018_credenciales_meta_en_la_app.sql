-- ═══════════════════════════════════════════════════════════════════════════
-- CREDENCIALES DE LA CLOUD API DE META, CARGADAS DESDE LA APP
--
-- Antes vivían en variables de entorno del servidor (WA_CLOUD_TOKEN,
-- WA_CLOUD_VERIFY_TOKEN, WA_CLOUD_APP_SECRET): una sola cuenta de Meta por
-- deploy, y cambiar un token era un redeploy. Ahora las carga el admin desde
-- /config/whatsapp y viven acá, por agencia — que es lo que pide un sistema
-- multi-tenant: cada agencia trae su app de Meta, su WABA y su número.
--
-- Los TRES SECRETOS no se guardan en esta tabla: van al Vault de Supabase
-- (vault.create_secret) y acá queda solo el uuid del secreto. Así ni un dump de
-- la base ni un backup los entrega en claro, y la llave de cifrado no está en el
-- repo ni en las envs — la maneja la plataforma.
--
-- Lo NO secreto (App ID, WABA ID, estado del último chequeo) sí queda en
-- columnas: es lo que la pantalla necesita mostrar y es lo mismo que el admin ve
-- en el panel de Meta.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists wa_cloud_credentials (
  channel_id uuid primary key references wa_channels(id) on delete cascade,
  agency_id uuid not null references agencies(id) on delete cascade,

  -- Identificadores públicos de Meta (los ve cualquiera que entre al panel)
  app_id text,
  waba_id text,
  business_id text,

  -- Secretos: solo el uuid del Vault. El valor nunca vuelve al navegador.
  token_secret_id uuid,
  app_secret_id uuid,
  verify_secret_id uuid,

  -- Ruta propia del webhook de esta agencia. El GET de verificación de Meta no
  -- manda NADA que identifique al tenant (solo hub.mode / hub.verify_token /
  -- hub.challenge), así que la agencia tiene que venir en la URL. Es un valor
  -- opaco de 128 bits: no expone el uuid del canal y no se puede adivinar.
  webhook_slug text not null unique
    default replace(gen_random_uuid()::text, '-', ''),

  -- Huellas del token para la UI (nunca el token)
  token_tail text,                    -- últimos 4 caracteres, para reconocerlo
  token_expires_at timestamptz,       -- null = permanente (System User)
  token_scopes text[],
  token_app_id text,                  -- app que reporta debug_token: si no
                                      -- coincide con app_id, el token es de otra app

  -- Foto del último diagnóstico contra Meta (para pintar la pantalla sin
  -- volver a llamar al Graph en cada render)
  checked_at timestamptz,
  check_ok boolean,
  checks jsonb not null default '[]'::jsonb,

  -- Datos que devuelve Meta y que le sirven al admin
  waba_name text,
  business_verification_status text,  -- VERIFIED | PENDING | NOT_VERIFIED | …
  account_review_status text,         -- APPROVED | PENDING | REJECTED | DEFERRED
  webhook_subscribed boolean not null default false,
  webhook_callback_url text,          -- la que quedó configurada en Meta

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wa_cloud_credentials_agency_idx
  on wa_cloud_credentials(agency_id);

comment on table wa_cloud_credentials is
  'Credenciales de la Cloud API de Meta por agencia. Los secretos viven en el Vault; acá queda el uuid. RLS sin policies: solo service role.';
comment on column wa_cloud_credentials.webhook_slug is
  'Parte opaca de la URL del webhook: /api/wa/cloud/webhook/{slug}. Es lo único que identifica al tenant en el GET de verificación de Meta.';

-- El webhook resuelve la agencia con .eq(phone_number_id, …).maybeSingle(): sin
-- unicidad, dos agencias con el mismo ID (un copy/paste, una prueba) rompen el
-- webhook de las dos. Con credenciales por agencia eso pasa de bug raro a vector.
create unique index if not exists wa_channels_phone_number_id_key
  on wa_channels(phone_number_id) where phone_number_id is not null;

-- ─────────────────────────────────────────────
-- RLS: sin policies. Ni el admin de la agencia lee esta tabla desde el browser;
-- todo pasa por server actions con service role.
-- ─────────────────────────────────────────────
alter table wa_cloud_credentials enable row level security;

revoke all on public.wa_cloud_credentials from anon, authenticated;

-- wa_channels ya tiene RLS `to authenticated`, pero `anon` conserva los grants
-- de tabla que vienen por defecto: una sola capa (la policy) separando a un
-- visitante sin sesión de la fila donde vive el número madre. Se cierra la
-- segunda puerta también.
revoke all on public.wa_channels from anon;
revoke all on public.wa_session_state from anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- ACCESO AL VAULT
--
-- vault.decrypted_secrets no es legible por service_role ni por authenticated,
-- y el esquema vault no está expuesto por PostgREST. Estas funciones son la
-- única puerta: SECURITY DEFINER (corren como postgres, que sí tiene acceso),
-- search_path vacío, y EXECUTE solo para service_role.
-- ═══════════════════════════════════════════════════════════════════════════

/** Guarda (o pisa) uno de los tres secretos de la agencia en el Vault. */
create or replace function public.wa_cloud_secret_set(
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
           when 'token'        then c.token_secret_id
           when 'app_secret'   then c.app_secret_id
           else                     c.verify_secret_id
         end
    into v_existing
    from public.wa_cloud_credentials c
   where c.channel_id = p_channel_id;

  if not found then
    raise exception 'el canal % no tiene fila de credenciales', p_channel_id;
  end if;

  v_name := 'wa_cloud/' || p_channel_id::text || '/' || p_slot;

  -- Si la fila perdió el uuid pero el secreto quedó en el Vault (el nombre es
  -- único), lo reusamos en vez de chocar contra el índice.
  if v_existing is null then
    select s.id into v_existing from vault.secrets s where s.name = v_name;
  end if;

  if v_existing is null then
    v_id := vault.create_secret(p_value, v_name, 'Credencial de la Cloud API de Meta');
  else
    perform vault.update_secret(v_existing, p_value);
    v_id := v_existing;
  end if;

  update public.wa_cloud_credentials
     set token_secret_id  = case when p_slot = 'token'        then v_id else token_secret_id end,
         app_secret_id    = case when p_slot = 'app_secret'   then v_id else app_secret_id end,
         verify_secret_id = case when p_slot = 'verify_token' then v_id else verify_secret_id end,
         updated_at       = now()
   where channel_id = p_channel_id;
end;
$$;

/** Borra del Vault los secretos de un canal (desconectar la cuenta de Meta). */
create or replace function public.wa_cloud_secret_clear(p_channel_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select array_remove(
           array[c.token_secret_id, c.app_secret_id, c.verify_secret_id],
           null
         )
    into v_ids
    from public.wa_cloud_credentials c
   where c.channel_id = p_channel_id;

  if v_ids is not null and array_length(v_ids, 1) > 0 then
    delete from vault.secrets s where s.id = any(v_ids);
  end if;

  update public.wa_cloud_credentials
     set token_secret_id = null,
         app_secret_id = null,
         verify_secret_id = null,
         token_tail = null,
         token_expires_at = null,
         token_scopes = null,
         token_app_id = null,
         webhook_subscribed = false,
         check_ok = null,
         checks = '[]'::jsonb,
         updated_at = now()
   where channel_id = p_channel_id;
end;
$$;

/**
 * Config completa de un canal, con los secretos descifrados.
 * La usan el envío, el webhook y el asistente de conexión — todos con service
 * role y del lado del servidor. NUNCA se serializa hacia el navegador.
 */
create or replace function public.wa_cloud_config(p_channel_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'channel_id',      c.channel_id,
    'agency_id',       c.agency_id,
    'app_id',          c.app_id,
    'waba_id',         c.waba_id,
    'business_id',     c.business_id,
    'webhook_slug',    c.webhook_slug,
    'phone_number_id', ch.phone_number_id,
    'token',        (select s.decrypted_secret from vault.decrypted_secrets s where s.id = c.token_secret_id),
    'app_secret',   (select s.decrypted_secret from vault.decrypted_secrets s where s.id = c.app_secret_id),
    'verify_token', (select s.decrypted_secret from vault.decrypted_secrets s where s.id = c.verify_secret_id)
  )
  from public.wa_cloud_credentials c
  join public.wa_channels ch on ch.id = c.channel_id
  where c.channel_id = p_channel_id;
$$;

/** Igual que wa_cloud_config pero entrando por el phone number ID (webhook viejo). */
create or replace function public.wa_cloud_config_by_phone_number_id(p_phone_number_id text)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select public.wa_cloud_config(ch.id)
  from public.wa_channels ch
  where ch.phone_number_id = p_phone_number_id
  limit 1;
$$;

/** Igual, entrando por el slug de la URL del webhook (el camino nuevo). */
create or replace function public.wa_cloud_config_by_slug(p_slug text)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select public.wa_cloud_config(c.channel_id)
  from public.wa_cloud_credentials c
  where c.webhook_slug = p_slug
  limit 1;
$$;

/**
 * ¿Alguna agencia tiene ESE verify token? Solo para la URL vieja
 * (/api/wa/cloud/webhook, sin slug), donde el GET de Meta no dice de quién es.
 * La comparación se hace acá adentro para no sacar los tokens de la base.
 */
create or replace function public.wa_cloud_verify_token_matches(p_token text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.wa_cloud_credentials c
    join vault.decrypted_secrets s on s.id = c.verify_secret_id
    where s.decrypted_secret = p_token
  );
$$;

-- Solo el service role. `public` incluye a anon y authenticated: revocar
-- primero es obligatorio (PostgREST expone todo lo ejecutable del esquema public).
revoke all on function public.wa_cloud_secret_set(uuid, text, text) from public;
revoke all on function public.wa_cloud_secret_clear(uuid) from public;
revoke all on function public.wa_cloud_config(uuid) from public;
revoke all on function public.wa_cloud_config_by_phone_number_id(text) from public;
revoke all on function public.wa_cloud_config_by_slug(text) from public;
revoke all on function public.wa_cloud_verify_token_matches(text) from public;

grant execute on function public.wa_cloud_secret_set(uuid, text, text) to service_role;
grant execute on function public.wa_cloud_secret_clear(uuid) to service_role;
grant execute on function public.wa_cloud_config(uuid) to service_role;
grant execute on function public.wa_cloud_config_by_phone_number_id(text) to service_role;
grant execute on function public.wa_cloud_config_by_slug(text) to service_role;
grant execute on function public.wa_cloud_verify_token_matches(text) to service_role;

-- ─────────────────────────────────────────────
-- Todo número madre nace con su fila de credenciales (y con su slug de webhook).
-- Va por trigger y no en cada alta: el madre se crea desde tres lados distintos
-- (el bootstrap de la 0017, la action createMotherChannel y el backfill de acá),
-- y una agencia sin fila deja la pantalla sin URL de webhook que mostrar.
-- ─────────────────────────────────────────────
create or replace function public.wa_cloud_credentials_bootstrap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_mother then
    insert into public.wa_cloud_credentials (channel_id, agency_id)
    values (new.id, new.agency_id)
    on conflict (channel_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists wa_cloud_credentials_bootstrap on wa_channels;
create trigger wa_cloud_credentials_bootstrap
  after insert on wa_channels
  for each row execute function public.wa_cloud_credentials_bootstrap();

-- Las agencias que ya tienen número madre (backfill).
insert into wa_cloud_credentials (channel_id, agency_id)
select w.id, w.agency_id
from wa_channels w
where w.is_mother
  and not exists (
    select 1 from wa_cloud_credentials c where c.channel_id = w.id
  );
