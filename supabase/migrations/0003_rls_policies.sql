-- RLS: aislamiento estricto por agencia (multi-tenant) + visibilidad por rol.
-- Modelo de visibilidad:
--   admin / vendedor → todo lo de su agencia (la UI filtra "míos" por defecto)
--   freelance        → solo lo asignado a él / creado por él, o sin asignar
-- Las funciones app.* sin argumentos se evalúan una sola vez por query (initplan).

alter table agencies enable row level security;
alter table members enable row level security;
alter table invitations enable row level security;
alter table tags enable row level security;
alter table contacts enable row level security;
alter table contact_tags enable row level security;
alter table travelers enable row level security;
alter table attachments enable row level security;
alter table suppliers enable row level security;
alter table leads enable row level security;
alter table activities enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table wa_templates enable row level security;
alter table followup_rules enable row level security;
alter table followups enable row level security;
alter table quotes enable row level security;
alter table quote_items enable row level security;
alter table files enable row level security;
alter table file_travelers enable row level security;
alter table file_services enable row level security;
alter table payments enable row level security;
alter table notifications enable row level security;

-- ─────────────────────────────────────────────
-- AGENCIES
-- ─────────────────────────────────────────────
create policy agencies_select on agencies for select to authenticated
  using (id in (select app.my_agency_ids()) or created_by = (select auth.uid()));

create policy agencies_insert on agencies for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy agencies_update on agencies for update to authenticated
  using (id in (select app.my_admin_agency_ids()))
  with check (id in (select app.my_admin_agency_ids()));

-- ─────────────────────────────────────────────
-- MEMBERS
-- ─────────────────────────────────────────────
create policy members_select on members for select to authenticated
  using (agency_id in (select app.my_agency_ids()));

-- primer miembro: el creador de la agencia se registra como admin.
-- siguientes: solo con invitación pendiente que matchee su email.
create policy members_insert on members for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      (
        role = 'admin'
        and exists (
          select 1 from agencies a
          where a.id = agency_id and a.created_by = (select auth.uid())
            and not exists (select 1 from members m where m.agency_id = a.id)
        )
      )
      or exists (
        select 1 from invitations i
        where i.agency_id = members.agency_id
          and lower(i.email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
          and i.accepted_at is null
          and i.role = members.role -- el rol debe coincidir con el de la invitación
      )
    )
  );

create policy members_update on members for update to authenticated
  using (
    agency_id in (select app.my_admin_agency_ids())
    or user_id = (select auth.uid())
  )
  with check (
    agency_id in (select app.my_admin_agency_ids())
    or user_id = (select auth.uid())
  );

create policy members_delete on members for delete to authenticated
  using (agency_id in (select app.my_admin_agency_ids()));

-- ─────────────────────────────────────────────
-- INVITATIONS
-- ─────────────────────────────────────────────
create policy invitations_select on invitations for select to authenticated
  using (
    agency_id in (select app.my_admin_agency_ids())
    or lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );

create policy invitations_insert on invitations for insert to authenticated
  with check (agency_id in (select app.my_admin_agency_ids()));

create policy invitations_update on invitations for update to authenticated
  using (
    agency_id in (select app.my_admin_agency_ids())
    or lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  )
  with check (
    agency_id in (select app.my_admin_agency_ids())
    or lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );

create policy invitations_delete on invitations for delete to authenticated
  using (agency_id in (select app.my_admin_agency_ids()));

-- ─────────────────────────────────────────────
-- Catálogos de agencia: tags, suppliers, wa_templates, followup_rules
-- lectura: todos los miembros · escritura: staff · borrado: admin
-- ─────────────────────────────────────────────
create policy tags_select on tags for select to authenticated
  using (agency_id in (select app.my_agency_ids()));
create policy tags_write on tags for insert to authenticated
  with check (agency_id in (select app.my_staff_agency_ids()));
create policy tags_update on tags for update to authenticated
  using (agency_id in (select app.my_staff_agency_ids()))
  with check (agency_id in (select app.my_staff_agency_ids()));
create policy tags_delete on tags for delete to authenticated
  using (agency_id in (select app.my_admin_agency_ids()));

create policy suppliers_select on suppliers for select to authenticated
  using (agency_id in (select app.my_agency_ids()));
create policy suppliers_insert on suppliers for insert to authenticated
  with check (agency_id in (select app.my_staff_agency_ids()));
create policy suppliers_update on suppliers for update to authenticated
  using (agency_id in (select app.my_staff_agency_ids()))
  with check (agency_id in (select app.my_staff_agency_ids()));
create policy suppliers_delete on suppliers for delete to authenticated
  using (agency_id in (select app.my_admin_agency_ids()));

create policy wa_templates_select on wa_templates for select to authenticated
  using (agency_id in (select app.my_agency_ids()));
create policy wa_templates_insert on wa_templates for insert to authenticated
  with check (agency_id in (select app.my_staff_agency_ids()));
create policy wa_templates_update on wa_templates for update to authenticated
  using (agency_id in (select app.my_staff_agency_ids()))
  with check (agency_id in (select app.my_staff_agency_ids()));
create policy wa_templates_delete on wa_templates for delete to authenticated
  using (agency_id in (select app.my_admin_agency_ids()));

create policy followup_rules_select on followup_rules for select to authenticated
  using (agency_id in (select app.my_agency_ids()));
create policy followup_rules_insert on followup_rules for insert to authenticated
  with check (agency_id in (select app.my_admin_agency_ids()));
create policy followup_rules_update on followup_rules for update to authenticated
  using (agency_id in (select app.my_admin_agency_ids()))
  with check (agency_id in (select app.my_admin_agency_ids()));
create policy followup_rules_delete on followup_rules for delete to authenticated
  using (agency_id in (select app.my_admin_agency_ids()));

-- ─────────────────────────────────────────────
-- CONTACTS + relacionados (visibles a toda la agencia:
-- necesarios para deduplicar por teléfono y crear leads)
-- ─────────────────────────────────────────────
create policy contacts_select on contacts for select to authenticated
  using (agency_id in (select app.my_agency_ids()));
create policy contacts_insert on contacts for insert to authenticated
  with check (agency_id in (select app.my_agency_ids()));
create policy contacts_update on contacts for update to authenticated
  using (agency_id in (select app.my_agency_ids()))
  with check (agency_id in (select app.my_agency_ids()));
create policy contacts_delete on contacts for delete to authenticated
  using (agency_id in (select app.my_admin_agency_ids()));

create policy contact_tags_select on contact_tags for select to authenticated
  using (agency_id in (select app.my_agency_ids()));
create policy contact_tags_insert on contact_tags for insert to authenticated
  with check (agency_id in (select app.my_agency_ids()));
create policy contact_tags_delete on contact_tags for delete to authenticated
  using (agency_id in (select app.my_agency_ids()));

create policy travelers_select on travelers for select to authenticated
  using (agency_id in (select app.my_agency_ids()));
create policy travelers_insert on travelers for insert to authenticated
  with check (agency_id in (select app.my_agency_ids()));
create policy travelers_update on travelers for update to authenticated
  using (agency_id in (select app.my_agency_ids()))
  with check (agency_id in (select app.my_agency_ids()));
create policy travelers_delete on travelers for delete to authenticated
  using (agency_id in (select app.my_agency_ids()));

create policy attachments_select on attachments for select to authenticated
  using (agency_id in (select app.my_agency_ids()));
create policy attachments_insert on attachments for insert to authenticated
  with check (agency_id in (select app.my_agency_ids()));
create policy attachments_delete on attachments for delete to authenticated
  using (agency_id in (select app.my_agency_ids()));

-- ─────────────────────────────────────────────
-- LEADS: staff ve todo · freelance ve lo suyo o sin asignar
-- ─────────────────────────────────────────────
create policy leads_select on leads for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or assigned_to in (select app.my_member_ids())
    or (agency_id in (select app.my_agency_ids()) and assigned_to is null)
  );
create policy leads_insert on leads for insert to authenticated
  with check (agency_id in (select app.my_agency_ids()));
create policy leads_update on leads for update to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or assigned_to in (select app.my_member_ids())
    or (agency_id in (select app.my_agency_ids()) and assigned_to is null)
  )
  with check (agency_id in (select app.my_agency_ids()));
create policy leads_delete on leads for delete to authenticated
  using (agency_id in (select app.my_admin_agency_ids()));

-- ─────────────────────────────────────────────
-- ACTIVITIES: mismo criterio que leads
-- ─────────────────────────────────────────────
create policy activities_select on activities for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or member_id in (select app.my_member_ids())
    or exists (
      select 1 from leads l
      where l.id = activities.lead_id
        and (l.assigned_to in (select app.my_member_ids()) or l.assigned_to is null)
    )
  );
create policy activities_insert on activities for insert to authenticated
  with check (agency_id in (select app.my_agency_ids()));
create policy activities_delete on activities for delete to authenticated
  using (agency_id in (select app.my_admin_agency_ids()));

-- ─────────────────────────────────────────────
-- CONVERSATIONS + MESSAGES
-- ─────────────────────────────────────────────
create policy conversations_select on conversations for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or assigned_to in (select app.my_member_ids())
    or (agency_id in (select app.my_agency_ids()) and assigned_to is null)
  );
create policy conversations_insert on conversations for insert to authenticated
  with check (agency_id in (select app.my_agency_ids()));
create policy conversations_update on conversations for update to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or assigned_to in (select app.my_member_ids())
    or (agency_id in (select app.my_agency_ids()) and assigned_to is null)
  )
  with check (agency_id in (select app.my_agency_ids()));

create policy messages_select on messages for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or exists (
      select 1 from conversations c
      where c.id = messages.conversation_id
        and (c.assigned_to in (select app.my_member_ids()) or c.assigned_to is null)
    )
  );
create policy messages_insert on messages for insert to authenticated
  with check (agency_id in (select app.my_agency_ids()));
create policy messages_update on messages for update to authenticated
  using (agency_id in (select app.my_agency_ids()))
  with check (agency_id in (select app.my_agency_ids()));

-- ─────────────────────────────────────────────
-- FOLLOWUPS
-- ─────────────────────────────────────────────
create policy followups_select on followups for select to authenticated
  using (agency_id in (select app.my_agency_ids()));
create policy followups_insert on followups for insert to authenticated
  with check (agency_id in (select app.my_agency_ids()));
create policy followups_update on followups for update to authenticated
  using (agency_id in (select app.my_agency_ids()))
  with check (agency_id in (select app.my_agency_ids()));
create policy followups_delete on followups for delete to authenticated
  using (agency_id in (select app.my_agency_ids()));

-- ─────────────────────────────────────────────
-- QUOTES: staff ve todo · freelance lo suyo
-- ─────────────────────────────────────────────
create policy quotes_select on quotes for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or created_by in (select app.my_member_ids())
  );
create policy quotes_insert on quotes for insert to authenticated
  with check (agency_id in (select app.my_agency_ids()));
create policy quotes_update on quotes for update to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or created_by in (select app.my_member_ids())
  )
  with check (agency_id in (select app.my_agency_ids()));
create policy quotes_delete on quotes for delete to authenticated
  using (
    agency_id in (select app.my_admin_agency_ids())
    or created_by in (select app.my_member_ids())
  );

create policy quote_items_select on quote_items for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or exists (
      select 1 from quotes q
      where q.id = quote_items.quote_id
        and q.created_by in (select app.my_member_ids())
    )
  );
create policy quote_items_insert on quote_items for insert to authenticated
  with check (agency_id in (select app.my_agency_ids()));
create policy quote_items_update on quote_items for update to authenticated
  using (agency_id in (select app.my_agency_ids()))
  with check (agency_id in (select app.my_agency_ids()));
create policy quote_items_delete on quote_items for delete to authenticated
  using (agency_id in (select app.my_agency_ids()));

-- ─────────────────────────────────────────────
-- FILES + servicios + pasajeros: staff todo · freelance sus ventas
-- ─────────────────────────────────────────────
create policy files_select on files for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or seller_id in (select app.my_member_ids())
  );
create policy files_insert on files for insert to authenticated
  with check (agency_id in (select app.my_agency_ids()));
create policy files_update on files for update to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or seller_id in (select app.my_member_ids())
  )
  with check (agency_id in (select app.my_agency_ids()));
create policy files_delete on files for delete to authenticated
  using (agency_id in (select app.my_admin_agency_ids()));

create policy file_travelers_select on file_travelers for select to authenticated
  using (agency_id in (select app.my_agency_ids()));
create policy file_travelers_insert on file_travelers for insert to authenticated
  with check (agency_id in (select app.my_agency_ids()));
create policy file_travelers_delete on file_travelers for delete to authenticated
  using (agency_id in (select app.my_agency_ids()));

create policy file_services_select on file_services for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or exists (
      select 1 from files f
      where f.id = file_services.file_id
        and f.seller_id in (select app.my_member_ids())
    )
  );
create policy file_services_insert on file_services for insert to authenticated
  with check (agency_id in (select app.my_agency_ids()));
create policy file_services_update on file_services for update to authenticated
  using (agency_id in (select app.my_agency_ids()))
  with check (agency_id in (select app.my_agency_ids()));
create policy file_services_delete on file_services for delete to authenticated
  using (agency_id in (select app.my_agency_ids()));

-- ─────────────────────────────────────────────
-- PAYMENTS: staff todo · freelance los de sus files
-- ─────────────────────────────────────────────
create policy payments_select on payments for select to authenticated
  using (
    agency_id in (select app.my_staff_agency_ids())
    or exists (
      select 1 from files f
      where f.id = payments.file_id
        and f.seller_id in (select app.my_member_ids())
    )
  );
create policy payments_insert on payments for insert to authenticated
  with check (agency_id in (select app.my_agency_ids()));
create policy payments_update on payments for update to authenticated
  using (agency_id in (select app.my_staff_agency_ids()))
  with check (agency_id in (select app.my_staff_agency_ids()));
create policy payments_delete on payments for delete to authenticated
  using (agency_id in (select app.my_admin_agency_ids()));

-- ─────────────────────────────────────────────
-- NOTIFICATIONS: cada uno ve las suyas
-- ─────────────────────────────────────────────
create policy notifications_select on notifications for select to authenticated
  using (member_id in (select app.my_member_ids()));
create policy notifications_insert on notifications for insert to authenticated
  with check (agency_id in (select app.my_agency_ids()));
create policy notifications_update on notifications for update to authenticated
  using (member_id in (select app.my_member_ids()))
  with check (member_id in (select app.my_member_ids()));
create policy notifications_delete on notifications for delete to authenticated
  using (member_id in (select app.my_member_ids()));
