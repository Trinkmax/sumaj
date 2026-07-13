-- 0011 — Rediseño v2: las notificaciones ya no llevan emoji en el título
-- (la UI ahora usa iconos por tipo). Solo cambia el título de cumpleaños.

create or replace function app.daily_notifications()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare n integer := 0;
declare r integer;
begin
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

  insert into public.notifications (agency_id, member_id, type, title, body, link)
  select c.agency_id, m.id, 'cumpleanos',
         'Cumple de ' || c.full_name,
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
$function$;
