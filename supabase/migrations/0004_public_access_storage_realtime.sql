-- Acceso público con token (presupuestos y recibos compartidos por WhatsApp),
-- buckets de storage y realtime.

-- ─────────────────────────────────────────────
-- Presupuesto público: solo datos de cara al cliente, nunca costos ni comisiones.
-- security definer con search_path fijo; expuesta deliberadamente a anon.
-- ─────────────────────────────────────────────
create or replace function public.quote_public(token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'code', q.code,
    'title', q.title,
    'destination', q.destination,
    'currency', q.currency,
    'pax', q.pax,
    'nights', q.nights,
    'trip_date_from', q.trip_date_from,
    'trip_date_to', q.trip_date_to,
    'valid_until', q.valid_until,
    'status', q.status,
    'total_price', q.total_price,
    'per_person', case when q.pax > 0 then round(q.total_price / q.pax, 2) else q.total_price end,
    'discount', q.discount,
    'notes', q.notes,
    'theme', q.theme,
    'created_at', q.created_at,
    'contact_name', c.full_name,
    'contact_phone', c.phone,
    'agency', jsonb_build_object(
      'name', a.name,
      'logo_url', a.logo_url,
      'phone', a.phone,
      'email', a.email
    ),
    'seller_name', m.display_name,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', qi.type,
        'description', qi.description
      ) order by qi.position)
      from public.quote_items qi
      where qi.quote_id = q.id and qi.show_in_client_quote
    ), '[]'::jsonb)
  )
  from public.quotes q
  join public.agencies a on a.id = q.agency_id
  left join public.contacts c on c.id = q.contact_id
  left join public.members m on m.id = q.created_by
  where q.public_token = token
$$;

-- Recibo público
create or replace function public.receipt_public(token uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'code', p.receipt_code,
    'amount', p.amount,
    'currency', p.currency,
    'exchange_rate', p.exchange_rate,
    'method', p.method,
    'paid_at', p.paid_at,
    'note', p.note,
    'contact_name', c.full_name,
    'file_code', f.code,
    'destination', f.destination,
    'file_currency', f.currency,
    'total_sale', ft.total_sale,
    'paid_total', ft.paid_total,
    'balance', ft.balance,
    'agency', jsonb_build_object(
      'name', a.name,
      'logo_url', a.logo_url,
      'phone', a.phone,
      'email', a.email
    ),
    'theme', a.settings -> 'quote_theme'
  )
  from public.payments p
  join public.files f on f.id = p.file_id
  join public.file_totals ft on ft.file_id = f.id
  join public.agencies a on a.id = p.agency_id
  left join public.contacts c on c.id = p.contact_id
  where p.receipt_token = token and p.direction = 'cobro'
$$;

revoke all on function public.quote_public(uuid) from public;
revoke all on function public.receipt_public(uuid) from public;
grant execute on function public.quote_public(uuid) to anon, authenticated;
grant execute on function public.receipt_public(uuid) to anon, authenticated;

-- file_totals es security_invoker; receipt_public (definer) la consulta como owner. ok.

-- ─────────────────────────────────────────────
-- STORAGE: logos (público) y attachments (privado por agencia)
-- convención de path: {agency_id}/...
-- ─────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true), ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy "logos_read" on storage.objects for select
  using (bucket_id = 'logos');
create policy "logos_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1]::uuid in (select app.my_agency_ids())
  );
create policy "logos_update" on storage.objects for update to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1]::uuid in (select app.my_agency_ids())
  );
create policy "logos_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1]::uuid in (select app.my_agency_ids())
  );

create policy "attachments_select" on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1]::uuid in (select app.my_agency_ids())
  );
create policy "attachments_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1]::uuid in (select app.my_agency_ids())
  );
create policy "attachments_update" on storage.objects for update to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1]::uuid in (select app.my_agency_ids())
  );
create policy "attachments_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1]::uuid in (select app.my_agency_ids())
  );

-- ─────────────────────────────────────────────
-- REALTIME: chat, bandeja, kanban y notificaciones en vivo
-- ─────────────────────────────────────────────
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table conversations;
alter publication supabase_realtime add table leads;
alter publication supabase_realtime add table notifications;
