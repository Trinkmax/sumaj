-- Automatización: cola de seguimientos (48h / día 7 / día 21) y avisos diarios.
-- El envío real por Cloud API lo hace la edge function followups-run;
-- acá solo se ENCOLA (sin credenciales no se envía nada, honesto y seguro).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ─────────────────────────────────────────────
-- Encolar seguimientos vencidos según las reglas por agencia.
-- Un toque por regla por período de silencio (un mensaje entrante
-- cancela pendientes vía trigger y "resetea" el reloj).
-- ─────────────────────────────────────────────
create or replace function app.enqueue_followups()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  with candidates as (
    select distinct on (l.id, r.touch_number)
      l.agency_id,
      l.id as lead_id,
      c.id as conversation_id,
      r.id as rule_id,
      r.touch_number,
      c.last_inbound_at + make_interval(hours => r.hours_after_silence) as scheduled_at,
      t.id as template_id
    from public.leads l
    join public.conversations c
      on c.contact_id = l.contact_id
     and c.agency_id = l.agency_id
     and c.channel = 'whatsapp'
     and c.status = 'abierta'
    join public.followup_rules r
      on r.agency_id = l.agency_id
     and r.is_active
     and l.stage = any (r.applies_to_stages)
    left join public.wa_templates t
      on t.agency_id = l.agency_id
     and t.is_approved
     and (t.stage = l.stage or t.stage is null)
    where not l.followups_paused
      and l.stage in ('contactado', 'presupuestado', 'negociacion')
      and c.last_inbound_at is not null
      and c.last_inbound_at + make_interval(hours => r.hours_after_silence) <= now()
      -- todavía no se creó este toque para este período de silencio
      and not exists (
        select 1 from public.followups f
        where f.lead_id = l.id
          and f.touch_number = r.touch_number
          and f.created_at >= c.last_inbound_at
      )
    order by l.id, r.touch_number, (t.stage is null) -- prioriza plantilla de la etapa
  )
  insert into public.followups
    (agency_id, lead_id, conversation_id, rule_id, touch_number, scheduled_at, template_id, status)
  select agency_id, lead_id, conversation_id, rule_id, touch_number,
         greatest(scheduled_at, now()), template_id, 'pendiente'
  from candidates;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- ─────────────────────────────────────────────
-- Avisos diarios por miembro: seguimientos vencidos, documentos por vencer,
-- salidas próximas y cumpleaños. Idempotente por día (no duplica).
-- ─────────────────────────────────────────────
create or replace function app.daily_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer := 0;
declare r integer;
begin
  -- documentos de viaje que vencen en menos de 60 días → avisar a admins
  insert into public.notifications (agency_id, member_id, type, title, body, link)
  select t.agency_id, m.id, 'documento',
         'Documento por vencer',
         t.full_name || ': ' || coalesce(t.document_type::text, 'documento') ||
         ' vence el ' || to_char(t.document_expiry, 'DD/MM/YYYY'),
         '/clientes/' || t.contact_id
  from public.travelers t
  join public.members m on m.agency_id = t.agency_id and m.role = 'admin' and m.is_active
  where t.document_expiry between current_date and current_date + 60
    and not exists (
      select 1 from public.notifications x
      where x.member_id = m.id and x.type = 'documento'
        and x.body like t.full_name || '%'
        and x.created_at > now() - interval '7 days'
    );
  get diagnostics r = row_count; n := n + r;

  -- salidas en los próximos 7 días → avisar al vendedor del file (y admins)
  insert into public.notifications (agency_id, member_id, type, title, body, link)
  select f.agency_id, m.id, 'salida',
         'Salida próxima',
         c.full_name || ' viaja a ' || f.destination || ' el ' || to_char(f.departure_date, 'DD/MM'),
         '/files/' || f.id
  from public.files f
  join public.contacts c on c.id = f.contact_id
  join public.members m on m.agency_id = f.agency_id and m.is_active
    and (m.id = f.seller_id or m.role = 'admin')
  where f.departure_date between current_date and current_date + 7
    and f.status not in ('cancelado', 'finalizado')
    and not exists (
      select 1 from public.notifications x
      where x.member_id = m.id and x.type = 'salida'
        and x.link = '/files/' || f.id
        and x.created_at > now() - interval '7 days'
    );
  get diagnostics r = row_count; n := n + r;

  -- cumpleaños de hoy → avisar a todos los activos de la agencia
  insert into public.notifications (agency_id, member_id, type, title, body, link)
  select c.agency_id, m.id, 'cumpleanos',
         '🎂 Cumple de ' || c.full_name,
         'Un saludo por WhatsApp suma un montón — y es remarketing gratis.',
         '/clientes/' || c.id
  from public.contacts c
  join public.members m on m.agency_id = c.agency_id and m.is_active
  where c.birth_date is not null
    and to_char(c.birth_date, 'MM-DD') = to_char(current_date, 'MM-DD')
    and not exists (
      select 1 from public.notifications x
      where x.member_id = m.id and x.type = 'cumpleanos'
        and x.link = '/clientes/' || c.id
        and x.created_at > now() - interval '2 days'
    );
  get diagnostics r = row_count; n := n + r;

  -- seguimientos vencidos hace más de 2 horas → recordarle al asignado
  insert into public.notifications (agency_id, member_id, type, title, body, link)
  select l.agency_id, l.assigned_to, 'seguimiento',
         'Seguimiento vencido',
         c.full_name || ' (' || coalesce(l.destination, 'sin destino') || ') esperaba un contacto',
         '/crm/' || l.id
  from public.leads l
  join public.contacts c on c.id = l.contact_id
  where l.assigned_to is not null
    and l.next_action_at < now() - interval '2 hours'
    and l.stage in ('nuevo', 'contactado', 'presupuestado', 'negociacion')
    and not exists (
      select 1 from public.notifications x
      where x.member_id = l.assigned_to and x.type = 'seguimiento'
        and x.link = '/crm/' || l.id
        and x.created_at > now() - interval '1 day'
    );
  get diagnostics r = row_count; n := n + r;

  return n;
end;
$$;

-- ─────────────────────────────────────────────
-- Cron: encolar seguimientos cada hora, avisos diarios 9:00 ART (12:00 UTC),
-- y disparar la edge function que envía los seguimientos encolados
-- (solo envía si la agencia tiene WhatsApp Cloud API conectada).
-- ─────────────────────────────────────────────
select cron.schedule('enqueue-followups', '15 * * * *', $$select app.enqueue_followups()$$);
select cron.schedule('daily-notifications', '0 12 * * *', $$select app.daily_notifications()$$);
select cron.schedule(
  'dispatch-followups',
  '25 * * * *',
  $$
  select net.http_post(
    url := 'https://zgfquryagiuncndjbmhf.supabase.co/functions/v1/followups-run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpnZnF1cnlhZ2l1bmNuZGpibWhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzNDI1NDYsImV4cCI6MjA5ODkxODU0Nn0.CzCddDNInJyKUNBa53gVbnMdB6vhCiG1L8LDqho_DeU'
    ),
    body := '{}'::jsonb
  )
  $$
);
