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
-- UPDATE: las columnas de plata quedan congeladas para el que no es admin.
--   `seller_id` entra en la lista: reasignarse la venta de otro es cobrarle la
--   comisión. Ninguna action reasigna vendedor, así que no rompe nada.
--
-- INSERT: no se puede prohibir del todo —al ganar un lead, el vendedor crea el
--   file con su markup y su comisión adentro— pero sí acotarlo a lo que las
--   actions realmente escriben:
--     · el esquema de comisión nace en el default (`utilidad_pct`, 0, sin
--       etiqueta): la comisión plana la define un admin después;
--     · `commission_pct` tiene que ser el % que el vendedor ya tiene en
--       `members` (createFile y las dos conversiones lo copian de ahí);
--     · markup y descuento solo con presupuesto de origen; a mano nacen en 0.
-- ─────────────────────────────────────────────

create or replace function app.protect_file_money()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  seller_pct numeric(5,2);
begin
  -- sin JWT (service_role, migraciones, SQL directo) no aplica el guard
  if (select auth.uid()) is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if (new.markup is distinct from old.markup
        or new.discount is distinct from old.discount
        or new.commission_type is distinct from old.commission_type
        or new.commission_pct is distinct from old.commission_pct
        or new.commission_amount is distinct from old.commission_amount
        or new.commission_label is distinct from old.commission_label
        or new.seller_id is distinct from old.seller_id
        or new.agency_id is distinct from old.agency_id)
       and not app.is_admin(old.agency_id) then
      raise exception 'Solo un admin puede cambiar el markup, la comisión o el vendedor de una venta';
    end if;
    return new;
  end if;

  -- INSERT
  if app.is_admin(new.agency_id) then
    return new;
  end if;

  if new.commission_type is distinct from 'utilidad_pct'
     or coalesce(new.commission_amount, 0) <> 0
     or new.commission_label is not null then
    raise exception 'La comisión plana de una venta la define un admin';
  end if;

  select m.commission_pct into seller_pct
  from public.members m
  where m.id = new.seller_id;

  if coalesce(new.commission_pct, 0) is distinct from coalesce(seller_pct, 0) then
    raise exception 'La comisión del vendedor sale de su ficha, no se carga a mano';
  end if;

  if new.quote_id is null
     and (coalesce(new.markup, 0) <> 0 or coalesce(new.discount, 0) <> 0) then
    raise exception 'El markup de una venta cargada a mano lo pone un admin';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_file_money on files;
create trigger protect_file_money
before insert or update on files
for each row execute function app.protect_file_money();
