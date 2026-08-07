-- ─────────────────────────────────────────────
-- 0021 — La plata del file solo la mueve un admin (de verdad)
--
-- `updateFileCommission` y `updateFileMarkup` chequean isAdmin, pero ese chequeo
-- vive en la server action: la policy `files_update` deja que cualquier miembro
-- de la agencia escriba la fila, así que un vendedor que llame a PostgREST con
-- su propia sesión podía subirse el markup o su comisión y cobrar de más.
-- El guard va donde no se puede esquivar, igual que `protect_member_privileges`
-- de la 0007 con el rol y la comisión de un miembro.
--
-- Solo UPDATE: al convertir un presupuesto en venta, el vendedor crea el file
-- con su markup y su comisión ya adentro del INSERT (ver convertLeadToSale /
-- convertQuoteDirect). Después de eso, esas columnas quedan congeladas para él.
-- ─────────────────────────────────────────────

create or replace function app.protect_file_money()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- sin JWT (service_role, migraciones, SQL directo) no aplica el guard
  if (select auth.uid()) is null then
    return new;
  end if;

  if (new.markup is distinct from old.markup
      or new.discount is distinct from old.discount
      or new.commission_type is distinct from old.commission_type
      or new.commission_pct is distinct from old.commission_pct
      or new.commission_amount is distinct from old.commission_amount
      or new.commission_label is distinct from old.commission_label
      or new.agency_id is distinct from old.agency_id)
     and not app.is_admin(old.agency_id) then
    raise exception 'Solo un admin puede cambiar el markup o la comisión de una venta';
  end if;

  return new;
end;
$$;

create trigger protect_file_money
before update on files
for each row execute function app.protect_file_money();
