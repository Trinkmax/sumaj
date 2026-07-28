-- El seguimiento automático deja de salir por la Cloud API (plantillas pagas) y
-- pasa a salir por el número de la sucursal (Baileys, gratis). Lo despacha la
-- app en POST /api/wa/followups/run; el cron solo la despierta.
--
-- Después de desplegar la app hay que completar estas dos filas:
--   update app_config set value = 'https://TU-APP/api/wa/followups/run' where key = 'followups_url';
--   update app_config set value = '<WA_CRON_SECRET de la app>'          where key = 'followups_secret';
-- Mientras estén vacías el job no hace nada (y no se gasta un peso en plantillas).

create table if not exists app_config (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

alter table app_config enable row level security;  -- sin policies a propósito

insert into app_config (key, value) values
  ('followups_url', ''),
  ('followups_secret', '')
on conflict (key) do nothing;

comment on table app_config is
  'Config del sistema para los jobs. followups_url = {APP_URL}/api/wa/followups/run, followups_secret = WA_CRON_SECRET de la app.';

create or replace function app.dispatch_followups()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target text;
  secret text;
begin
  select value into target from public.app_config where key = 'followups_url';
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

select cron.unschedule('dispatch-followups')
where exists (select 1 from cron.job where jobname = 'dispatch-followups');

select cron.schedule('dispatch-followups', '25 * * * *', $$select app.dispatch_followups()$$);
