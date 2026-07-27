-- viajerOS — nueva dirección de movimiento de caja: pago de comisiones al vendedor.
-- Va sola en su propia migración: Postgres no permite usar un valor de enum
-- recién agregado dentro de la misma transacción que lo crea.

alter type payment_direction add value if not exists 'pago_comision';
