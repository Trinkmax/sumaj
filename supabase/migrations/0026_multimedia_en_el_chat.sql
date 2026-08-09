-- ═══════════════════════════════════════════════════════════════════════════
-- MULTIMEDIA Y REACCIONES EN EL CHAT
--
-- Hasta acá el webhook guardaba QUÉ tipo de cosa había mandado el cliente, pero
-- no la cosa: una foto entraba como un mensaje de tipo `imagen` con el cuerpo
-- vacío, y en el hilo se veía una burbuja muda. El sticker directamente no se
-- veía. El audio decía "Mensaje de voz" y no había forma de escucharlo.
--
-- El problema de fondo: Meta NO manda el archivo en el webhook. Manda un id, y
-- ese id se cambia por una URL que vive CINCO MINUTOS y que además hay que
-- descargar con el token. O sea: si no se baja en el momento, el archivo se
-- pierde para siempre. Por eso ahora el webhook lo descarga y lo guarda en el
-- bucket privado `attachments`, y acá queda dónde quedó y qué es.
--
-- ─────────────────────────────────────────────
-- POR QUÉ UNA COLUMNA jsonb Y NO SEIS COLUMNAS
--
-- Los metadatos de un adjunto dependen del adjunto: un audio tiene duración, un
-- sticker tiene "animado", una imagen tiene tamaño, un documento tiene nombre de
-- archivo. Seis columnas nullables serían seis columnas vacías en el 90% de las
-- filas, y cada tipo nuevo que Meta invente sería otra migración. Es el mismo
-- criterio que ya usa `file_services.images`.
--
-- El path que se guarda es el del bucket, NO una URL: las URLs firmadas duran
-- una hora y se piden en el momento de mostrar (ver service-images.tsx).
-- ═══════════════════════════════════════════════════════════════════════════

alter table messages
  add column if not exists media jsonb,
  add column if not exists reactions jsonb not null default '[]'::jsonb;

comment on column messages.media is
  'Adjunto del mensaje: {path, mime, name, size, duration, voice, sticker, animated, width, height}. `path` es del bucket privado attachments, nunca una URL — las firmadas duran una hora y se piden al mostrar.';

comment on column messages.reactions is
  'Reacciones al mensaje: [{emoji, direction, at}]. No son mensajes: se pegan a la burbuja del mensaje reaccionado, como en WhatsApp.';

-- `media_url` queda para lo que ya estaba (y para las URLs externas que todavía
-- no se re-hostean). Lo nuevo va en `media`.
comment on column messages.media_url is
  'Legado: URL externa del adjunto. Lo nuevo usa `media.path` sobre el bucket propio, porque las URLs de Meta vencen.';
