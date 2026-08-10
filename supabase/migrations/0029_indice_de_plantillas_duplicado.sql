-- ─────────────────────────────────────────────
-- El índice único de plantillas ya estaba
--
-- La 0027 creó `wa_templates_meta_name_uidx` sobre (agency_id, meta_name) para
-- que el envío no pueda elegir mal entre dos plantillas homónimas. La intención
-- era correcta pero la restricción YA EXISTÍA desde el esquema inicial, como
-- `wa_templates_agency_id_meta_name_key` (el UNIQUE de la tabla). Quedaron dos
-- índices únicos idénticos sobre las mismas columnas.
--
-- No rompía nada —de hecho es el viejo el que estuvo rechazando los duplicados
-- todo este tiempo— pero un esquema con dos índices iguales hace dudar al que lo
-- lee y se mantiene dos veces en cada escritura. Se va el mío, que es el que
-- sobra.
-- ─────────────────────────────────────────────

drop index if exists wa_templates_meta_name_uidx;
