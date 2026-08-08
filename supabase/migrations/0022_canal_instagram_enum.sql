-- ═══════════════════════════════════════════════════════════════════════════
-- INSTAGRAM: el valor del enum, y NADA MÁS
--
-- Va solo en esta migración a propósito. Postgres deja agregar un valor a un
-- enum dentro de una transacción, pero NO deja usarlo hasta que esa transacción
-- commitea ("unsafe use of new value of enum type"). Como el resto de la
-- migración de Instagram sí lo usa —el índice parcial de un canal por agencia,
-- el backfill— tiene que ir en un archivo aparte que corra antes.
--
-- Por qué el canal de Instagram vive en `wa_channels` y no en una tabla nueva:
-- `conversations.channel_id` ya apunta ahí, y con eso el hilo de Instagram
-- hereda gratis TODO lo que ya funciona — el chip de "por dónde entra" en el
-- chat, la respuesta automática, el estado conectado/desconectado, el filtro de
-- la bandeja. Una tabla paralela obligaba a una segunda foreign key en
-- conversations y a duplicar esa lógica en cada pantalla. La tabla dejó de ser
-- "los números de WhatsApp" para ser "los canales de mensajería de la agencia";
-- el nombre queda por compatibilidad.
-- ═══════════════════════════════════════════════════════════════════════════

alter type wa_channel_kind add value if not exists 'instagram';

comment on type wa_channel_kind is
  'Cómo habla un canal: cloud_api (número madre de WhatsApp), baileys (número de una sucursal), instagram (DMs de la cuenta profesional).';
