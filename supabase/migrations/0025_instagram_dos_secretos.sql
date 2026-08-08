-- ═══════════════════════════════════════════════════════════════════════════
-- DOS APP SECRETS, Y EL TAG DE AGENTE HUMANO
--
-- Dos cosas que salieron de leer la documentación de Meta y que la 0023 no
-- previó.
--
-- ─────────────────────────────────────────────
-- 1. LOS DOS APP SECRETS
--
-- Una app que usa "Instagram API with Instagram Login" tiene DOS secretos
-- distintos en el panel de Meta:
--
--   · App Secret         → Configuración de la app, Básica.
--   · Instagram App Secret → Instagram, API setup with Instagram login,
--                            Business login settings.
--
-- El segundo es el `client_secret` del OAuth de Instagram. El primero es el de
-- la app de Meta. ¿Con cuál firma Meta el `X-Hub-Signature-256` del webhook? La
-- documentación NO lo dice. La página de webhooks de Instagram dice "your app's
-- App Secret found on Meta App Dashboard App settings > Basic", pero esa misma
-- página cubre los tres setups (Instagram Login, Facebook Login y Messenger) sin
-- desambiguar, y no hay ninguna página que diga cuál corresponde a cada uno.
--
-- Elegir mal no da un error entendible: da un webhook que devuelve 401 a todo y
-- una agencia que no recibe un solo mensaje sin saber por qué. Así que se
-- guardan LOS DOS y la firma se valida contra cualquiera de ellos (en tiempo
-- constante, los dos siempre). Es un secreto de la misma app en las dos puntas:
-- aceptar el otro no agranda la superficie, y saca de la ecuación una
-- ambigüedad de la documentación de Meta que no podemos resolver desde acá.
--
-- ─────────────────────────────────────────────
-- 2. HUMAN_AGENT
--
-- Fuera de las 24 hs, en Instagram no hay plantillas pagas como en WhatsApp: la
-- ÚNICA vía documentada para contestar es el tag `HUMAN_AGENT`, que estira el
-- plazo a 7 días desde el último mensaje de la persona. Pero no es un permiso
-- que se pida con un scope: es un feature que se aprueba en App Review, y usarlo
-- sin aprobación devuelve un error opaco.
--
-- Por eso es un interruptor, apagado por default: la agencia lo prende cuando
-- Meta se lo aprobó. Con el interruptor apagado, fuera de la ventana el sistema
-- dice la verdad ("se cerró la ventana, seguí por WhatsApp") en vez de intentar
-- un envío que Meta va a rechazar.
-- ═══════════════════════════════════════════════════════════════════════════

alter table ig_accounts
  add column if not exists ig_app_id text,
  add column if not exists ig_app_secret_id uuid,
  add column if not exists human_agent_enabled boolean not null default false;

comment on column ig_accounts.ig_app_id is
  'Instagram App ID (Instagram, API setup with Instagram login). Es el client_id del OAuth de Instagram y NO es el App ID de la app de Meta.';
comment on column ig_accounts.ig_app_secret_id is
  'Instagram App Secret en el Vault. Se guarda además del App Secret porque la doc de Meta no dice cuál de los dos firma el webhook: se prueban los dos.';
comment on column ig_accounts.human_agent_enabled is
  'La agencia tiene aprobado el feature Human Agent en App Review. Habilita contestar hasta 7 días después del último mensaje con el tag HUMAN_AGENT.';

-- ─────────────────────────────────────────────
-- El cuarto slot del Vault
-- ─────────────────────────────────────────────

create or replace function public.ig_secret_set(
  p_channel_id uuid,
  p_slot text,          -- 'token' | 'app_secret' | 'ig_app_secret' | 'verify_token'
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
  if p_slot not in ('token', 'app_secret', 'ig_app_secret', 'verify_token') then
    raise exception 'slot inválido: %', p_slot;
  end if;
  if p_value is null or length(trim(p_value)) = 0 then
    raise exception 'el secreto no puede venir vacío';
  end if;

  select case p_slot
           when 'token'          then a.token_secret_id
           when 'app_secret'     then a.app_secret_id
           when 'ig_app_secret'  then a.ig_app_secret_id
           else                       a.verify_secret_id
         end
    into v_existing
    from public.ig_accounts a
   where a.channel_id = p_channel_id;

  if not found then
    raise exception 'el canal % no tiene cuenta de Instagram', p_channel_id;
  end if;

  v_name := 'ig/' || p_channel_id::text || '/' || p_slot;

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
     set token_secret_id   = case when p_slot = 'token'         then v_id else token_secret_id end,
         app_secret_id     = case when p_slot = 'app_secret'    then v_id else app_secret_id end,
         ig_app_secret_id  = case when p_slot = 'ig_app_secret' then v_id else ig_app_secret_id end,
         verify_secret_id  = case when p_slot = 'verify_token'  then v_id else verify_secret_id end,
         updated_at        = now()
   where channel_id = p_channel_id;
end;
$$;

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
           array[a.token_secret_id, a.app_secret_id, a.ig_app_secret_id, a.verify_secret_id],
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
         ig_app_secret_id = null,
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
    'ig_app_id',           a.ig_app_id,
    'ig_user_id',          a.ig_user_id,
    'page_id',             a.page_id,
    'username',            a.username,
    'webhook_slug',        a.webhook_slug,
    'token',          (select s.decrypted_secret from vault.decrypted_secrets s where s.id = a.token_secret_id),
    'app_secret',     (select s.decrypted_secret from vault.decrypted_secrets s where s.id = a.app_secret_id),
    'ig_app_secret',  (select s.decrypted_secret from vault.decrypted_secrets s where s.id = a.ig_app_secret_id),
    'verify_token',   (select s.decrypted_secret from vault.decrypted_secrets s where s.id = a.verify_secret_id),
    'human_agent_enabled', a.human_agent_enabled,
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

-- `create or replace function` REPONE los privilegios por default del esquema
-- (anon y authenticated incluidos): sin estos revokes, redefinir ig_config
-- vuelve a dejar el token de Instagram colgando de /rest/v1/rpc. Es la misma
-- trampa de la 0019 y la 0024, ahora por otro camino.
revoke all on function public.ig_secret_set(uuid, text, text) from public, anon, authenticated;
revoke all on function public.ig_secret_clear(uuid) from public, anon, authenticated;
revoke all on function public.ig_config(uuid) from public, anon, authenticated;

grant execute on function public.ig_secret_set(uuid, text, text) to service_role;
grant execute on function public.ig_secret_clear(uuid) to service_role;
grant execute on function public.ig_config(uuid) to service_role;
