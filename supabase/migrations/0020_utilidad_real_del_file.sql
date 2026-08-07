-- ─────────────────────────────────────────────
-- 0020 — La utilidad real de una venta
--
-- Problema: al convertir un presupuesto en file se prorrateaba el markup
-- entre los servicios (cada precio quedaba "sucio": 1.313,76 de costo pasaba
-- a venderse a 1.326,43) y la comisión del mayorista —que es la parte más
-- gorda de lo que gana la agencia— se perdía en el camino. Resultado: el file
-- decía "Utilidad USD 50" cuando la agencia se estaba llevando USD 570,80.
--
-- Solución: el file guarda las tres platas por separado.
--   · file_services.gross + commission_pct → comisión que devuelve el mayorista
--   · files.markup / files.discount        → sobreprecio y descuento del paquete
--   · file_services.price                  → precio real del servicio (= costo si
--                                            no se le puso sobreprecio propio)
-- ─────────────────────────────────────────────

-- 1) Columnas nuevas ─────────────────────────────────────────────

alter table file_services
  add column if not exists gross numeric(12,2),
  add column if not exists commission_pct numeric(5,2) not null default 0;

alter table files
  add column if not exists markup numeric(12,2) not null default 0,
  add column if not exists discount numeric(12,2) not null default 0;

comment on column file_services.gross is
  'BRUTO comisionable del mayorista (base de su comisión). null = no se cargó.';
comment on column file_services.commission_pct is
  '% que devuelve el mayorista sobre el bruto. Es utilidad que NO está en (precio − costo).';
comment on column files.markup is
  'Sobreprecio de la agencia sobre el paquete. Vive en el file: NO se prorratea en los servicios.';
comment on column files.discount is
  'Descuento otorgado al cliente sobre el paquete.';

-- 2) Backfill: recuperar bruto y % del presupuesto de origen ─────
--    Se emparejan por (presupuesto, descripción, posición): la conversión
--    copia las tres cosas tal cual. Si un presupuesto compara opciones, gana
--    el ítem de la opción que se vendió (o el común a todas): un ítem de una
--    opción descartada nunca fue parte de esta venta.
--
--    Backfill de una sola pasada sobre los datos que ya estaban. Los guards
--    (`fs.gross is null`, `f.markup = 0 and f.discount = 0`) hacen que volver
--    a correrla no toque nada; en una base nueva no hay filas y es un no-op.

drop table if exists _emparejados;
create temporary table _emparejados as
select distinct on (fs.id)
  fs.id as service_id,
  fs.file_id,
  qi.gross,
  coalesce(qi.commission_pct, 0) as commission_pct
from file_services fs
join files f on f.id = fs.file_id
join quotes q on q.id = f.quote_id
join quote_items qi
  on qi.quote_id = f.quote_id
 and qi.description = fs.description
 and qi.position = fs.position
where f.quote_id is not null
  and fs.gross is null
  and f.markup = 0
  and f.discount = 0
  and (qi.option_id is null or qi.option_id = q.accepted_option_id)
order by
  fs.id,
  -- el ítem de la opción vendida manda sobre el común; después, el más viejo
  (qi.option_id is not null) desc,
  qi.created_at;

update file_services fs
set gross = e.gross,
    commission_pct = e.commission_pct
from _emparejados e
where e.service_id = fs.id;

-- 3) Des-prorratear: el markup vuelve al file ────────────────────
--    Σ(precio − costo) de los servicios que vinieron del presupuesto ES el
--    markup menos el descuento. Se mueve al file antes de tocar los precios,
--    respetando el descuento que el presupuesto ya declaraba.
--    Solo ventas nacidas de un presupuesto: en las cargadas a mano, la
--    diferencia entre precio y costo es un sobreprecio real del servicio.

with delta as (
  select
    f.id as file_id,
    round(sum(fs.price - fs.cost), 2) as monto,
    greatest(coalesce(max(q.discount), 0), 0) as descuento_presupuestado
  from files f
  join quotes q on q.id = f.quote_id
  join file_services fs on fs.file_id = f.id
  join _emparejados e on e.service_id = fs.id
  group by f.id
)
update files f
set discount = case
      when delta.monto < 0 then greatest(delta.descuento_presupuestado, -delta.monto)
      else delta.descuento_presupuestado
    end,
    markup = delta.monto + case
      when delta.monto < 0 then greatest(delta.descuento_presupuestado, -delta.monto)
      else delta.descuento_presupuestado
    end
from delta
where delta.file_id = f.id;

-- 4) Cada servicio emparejado recupera su precio exacto ──────────
--    Atado a los mismos servicios del paso 3: nunca pisa un sobreprecio que
--    alguien haya cargado a mano después.

update file_services fs
set price = fs.cost
from _emparejados e
where e.service_id = fs.id
  and fs.price <> fs.cost;

drop table _emparejados;

-- 5) Vista de totales ────────────────────────────────────────────
--    Las columnas viejas conservan nombre, orden, tipo y VALOR (total_sale
--    sigue siendo lo que paga el cliente, ahora armado en dos partes), así
--    que receipt_public() y todo lo que ya la consulta siguen andando.
--    Las nuevas van al final: create or replace no admite reordenar.
--
--    · utility     = venta − costo → lo que ve el vendedor y base de su comisión
--    · gross_profit = utility + comisión del mayorista → lo que gana la agencia
--      antes de pagarle al vendedor (la comisión del vendedor se calcula en la
--      app con fileCommission(): una sola fórmula, en un solo lugar)

create or replace view file_totals
with (security_invoker = true) as
select
  f.id as file_id,
  f.agency_id,
  coalesce(s.total_cost, 0)::numeric(12,2) as total_cost,
  (coalesce(s.services_sale, 0) + f.markup - f.discount)::numeric(12,2) as total_sale,
  (coalesce(s.services_sale, 0) + f.markup - f.discount - coalesce(s.total_cost, 0))::numeric(12,2) as utility,
  coalesce(p.paid, 0)::numeric(12,2) as paid_total,
  (coalesce(s.services_sale, 0) + f.markup - f.discount - coalesce(p.paid, 0))::numeric(12,2) as balance,
  coalesce(s.services_sale, 0)::numeric(12,2) as services_sale,
  f.markup::numeric(12,2) as markup,
  f.discount::numeric(12,2) as discount,
  coalesce(s.supplier_commission, 0)::numeric(12,2) as supplier_commission,
  (
    coalesce(s.services_sale, 0) + f.markup - f.discount
    - coalesce(s.total_cost, 0)
    + coalesce(s.supplier_commission, 0)
  )::numeric(12,2) as gross_profit
from files f
left join lateral (
  select
    sum(fs.cost) as total_cost,
    sum(fs.price) as services_sale,
    round(sum(coalesce(fs.gross, 0) * fs.commission_pct / 100), 2) as supplier_commission
  from file_services fs
  where fs.file_id = f.id
) s on true
left join lateral (
  select sum(p.amount_in_file_currency) as paid
  from payments p
  where p.file_id = f.id and p.direction = 'cobro'
) p on true;
