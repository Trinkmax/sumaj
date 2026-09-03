-- 0032 — Linked ID de WhatsApp en la ficha del contacto
--
-- WhatsApp entrega los chats de sucursal por LID (un identificador de
-- privacidad, no el número). El número real viene en el stanza a veces sí y a
-- veces no, y el LID de una persona es el MISMO para todos nuestros números.
-- Sin un lugar durable donde guardarlo, la identidad se pierde en cuanto
-- aparece el teléfono (el hilo `lid:…` se renombraba) y la misma persona que
-- escribe por LID a otra sucursal abre una ficha nueva "WhatsApp XXXX".
--
-- Acá se guarda una vez y se usa para reconocerla desde cualquier número.

alter table contacts
  add column if not exists wa_lid text;

comment on column contacts.wa_lid is
  'Linked ID de WhatsApp (solo dígitos, sin @lid). Lo completa el webhook de las sucursales; único por agencia. Permite reconocer a la persona aunque WhatsApp no comparta el número.';

create unique index if not exists contacts_agency_wa_lid_uidx
  on contacts(agency_id, wa_lid)
  where wa_lid is not null;
