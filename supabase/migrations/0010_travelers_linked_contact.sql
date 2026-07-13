-- 0010 — Personas relacionadas navegables.
-- Un traveler (pasajero del grupo de un contacto) puede estar "promovido" a
-- contacto propio: travelers.linked_contact_id apunta a esa ficha.
-- Esto habilita la navegación bidireccional contacto ↔ contacto:
--   · grupo de X:      travelers where contact_id = X
--   · X viaja con:     travelers where linked_contact_id = X  → dueño (contact_id)
-- La carga no cambia: el vínculo es opcional y se crea al "abrir ficha".

alter table public.travelers
  add column if not exists linked_contact_id uuid references public.contacts (id) on delete set null;

create index if not exists travelers_linked_contact_idx
  on public.travelers (agency_id, linked_contact_id)
  where linked_contact_id is not null;

comment on column public.travelers.linked_contact_id is
  'Ficha de contacto propia de este pasajero (null = todavía no promovido).';
