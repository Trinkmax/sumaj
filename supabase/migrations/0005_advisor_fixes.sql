-- Correcciones de advisors:
-- 1. El bucket público 'logos' no necesita política SELECT (las URLs públicas
--    funcionan sin ella) y tenerla permite listar todos los archivos.
-- 2. auth.jwt() envuelto completo en (select ...) para evaluarse una sola vez.

drop policy "logos_read" on storage.objects;

drop policy invitations_select on invitations;
create policy invitations_select on invitations for select to authenticated
  using (
    agency_id in (select app.my_admin_agency_ids())
    or lower(email) = (select lower(coalesce(auth.jwt() ->> 'email', '')))
  );

drop policy invitations_update on invitations;
create policy invitations_update on invitations for update to authenticated
  using (
    agency_id in (select app.my_admin_agency_ids())
    or lower(email) = (select lower(coalesce(auth.jwt() ->> 'email', '')))
  )
  with check (
    agency_id in (select app.my_admin_agency_ids())
    or lower(email) = (select lower(coalesce(auth.jwt() ->> 'email', '')))
  );

drop policy members_insert on members;
create policy members_insert on members for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      (
        role = 'admin'
        and exists (
          select 1 from agencies a
          where a.id = agency_id and a.created_by = (select auth.uid())
            and not exists (select 1 from members m where m.agency_id = a.id)
        )
      )
      or exists (
        select 1 from invitations i
        where i.agency_id = members.agency_id
          and lower(i.email) = (select lower(coalesce(auth.jwt() ->> 'email', '')))
          and i.accepted_at is null
          and i.role = members.role
      )
    )
  );
