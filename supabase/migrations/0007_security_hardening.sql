-- Endurecimiento de seguridad (hallazgos del review):
-- 1. members: nadie puede auto-escalar rol/comisión/estado — solo un admin
--    de la agencia puede tocar columnas de privilegio (la policy de UPDATE
--    permite self-update para display_name/avatar, el trigger protege el resto).
-- 2. members INSERT por invitación: rol y comisión los define la invitación.
-- 3. logos del bucket: solo admins suben/pisan el logo de la agencia.

create or replace function app.protect_member_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv record;
begin
  -- sin JWT (service_role, seeds, SQL directo) no aplica el guard
  if (select auth.uid()) is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if (new.role is distinct from old.role
        or new.commission_pct is distinct from old.commission_pct
        or new.is_active is distinct from old.is_active
        or new.agency_id is distinct from old.agency_id
        or new.user_id is distinct from old.user_id)
       and not app.is_admin(old.agency_id) then
      raise exception 'Solo un admin puede modificar rol, comisión o estado de un miembro';
    end if;
    return new;
  end if;

  -- INSERT: si no es el creador fundando su agencia, entra por invitación
  -- y el rol/comisión deben ser exactamente los invitados.
  if not exists (
    select 1 from public.agencies a
    where a.id = new.agency_id and a.created_by = (select auth.uid())
  ) then
    select i.role, i.commission_pct into inv
    from public.invitations i
    where i.agency_id = new.agency_id
      and lower(i.email) = (select lower(coalesce(auth.jwt() ->> 'email', '')))
      and i.accepted_at is null
    limit 1;

    if inv is null then
      raise exception 'No hay invitación pendiente para este email';
    end if;
    if new.role is distinct from inv.role
       or new.commission_pct is distinct from inv.commission_pct then
      raise exception 'El rol y la comisión los define la invitación';
    end if;
  end if;

  return new;
end;
$$;

create trigger protect_member_privileges
before insert or update on members
for each row execute function app.protect_member_privileges();

-- logos: solo admins
drop policy "logos_insert" on storage.objects;
drop policy "logos_update" on storage.objects;
drop policy "logos_delete" on storage.objects;

create policy "logos_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1]::uuid in (select app.my_admin_agency_ids())
  );
create policy "logos_update" on storage.objects for update to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1]::uuid in (select app.my_admin_agency_ids())
  );
create policy "logos_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1]::uuid in (select app.my_admin_agency_ids())
  );
