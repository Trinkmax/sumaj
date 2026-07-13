-- Seed de demo para Sumaj (datos de prueba, NO es una migración)
-- Usuarios demo (password: sumaj2026):
--   tomas@sumaj.tur.ar   → admin
--   carla@sumaj.tur.ar   → vendedora
--   luca@sumaj.tur.ar    → freelance

do $$
declare
  u_tomas uuid := gen_random_uuid();
  u_carla uuid := gen_random_uuid();
  u_luca  uuid := gen_random_uuid();
  ag uuid;
  m_tomas uuid; m_carla uuid; m_luca uuid;
  sup_tucano uuid; sup_delfos uuid; sup_ola uuid;
  t_caribe uuid; t_brasil uuid; t_europa uuid; t_turquia uuid; t_bariloche uuid;
  t_familiar uuid; t_pareja uuid; t_grupal uuid;
  t_meta uuid; t_ig uuid; t_referido uuid; t_verano uuid;
  c_gabriela uuid; c_martin uuid; c_sofia uuid; c_diego uuid; c_valentina uuid;
  c_lucas uuid; c_camila uuid; c_franco uuid; c_julieta uuid; c_marcos uuid;
  c_agustina uuid; c_ricardo uuid; c_paula uuid; c_hernan uuid;
  l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid; l6 uuid; l7 uuid;
  l8 uuid; l9 uuid; l10 uuid; l11 uuid; l12 uuid; l13 uuid; l14 uuid;
  cv1 uuid; cv2 uuid; cv3 uuid; cv4 uuid; cv5 uuid; cv6 uuid; cv8 uuid;
  q1 uuid; q2 uuid; q3 uuid; q4 uuid;
  f1 uuid; f2 uuid;
  tv1 uuid; tv2 uuid; tv3 uuid;
  tpl_contactado uuid; tpl_presupuestado uuid; tpl_negociacion uuid;
begin
  -- ── Usuarios auth ──
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new)
  values
    ('00000000-0000-0000-0000-000000000000', u_tomas, 'authenticated', 'authenticated',
     'tomas@sumaj.tur.ar', crypt('sumaj2026', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Tomás Burgos"}', now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', u_carla, 'authenticated', 'authenticated',
     'carla@sumaj.tur.ar', crypt('sumaj2026', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Carla Ferreyra"}', now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', u_luca, 'authenticated', 'authenticated',
     'luca@sumaj.tur.ar', crypt('sumaj2026', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Luca Prieto"}', now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values
    (gen_random_uuid(), u_tomas, u_tomas::text,
     jsonb_build_object('sub', u_tomas::text, 'email', 'tomas@sumaj.tur.ar', 'email_verified', true),
     'email', now(), now(), now()),
    (gen_random_uuid(), u_carla, u_carla::text,
     jsonb_build_object('sub', u_carla::text, 'email', 'carla@sumaj.tur.ar', 'email_verified', true),
     'email', now(), now(), now()),
    (gen_random_uuid(), u_luca, u_luca::text,
     jsonb_build_object('sub', u_luca::text, 'email', 'luca@sumaj.tur.ar', 'email_verified', true),
     'email', now(), now(), now());

  -- ── Agencia ──
  insert into agencies (name, slug, phone, email, created_by, settings)
  values ('Sumaj Viajes', 'sumaj', '5493511234567', 'hola@sumaj.tur.ar', u_tomas,
    '{
      "quote_theme": {"color": "sand", "font": "editorial"},
      "quote_saved_notes": ["Tarifas sujetas a disponibilidad al momento de reservar.", "Precios expresados en dólares estadounidenses."],
      "whatsapp": {"phone_number_id": null, "display_number": "+54 9 351 123-4567", "connected": false},
      "usd_rate": 1465
    }'::jsonb)
  returning id into ag;

  insert into members (agency_id, user_id, role, display_name, email, commission_pct) values
    (ag, u_tomas, 'admin', 'Tomás', 'tomas@sumaj.tur.ar', 0) returning id into m_tomas;
  insert into members (agency_id, user_id, role, display_name, email, commission_pct) values
    (ag, u_carla, 'vendedor', 'Carla', 'carla@sumaj.tur.ar', 30) returning id into m_carla;
  insert into members (agency_id, user_id, role, display_name, email, commission_pct) values
    (ag, u_luca, 'freelance', 'Luca', 'luca@sumaj.tur.ar', 40) returning id into m_luca;

  -- ── Proveedores ──
  insert into suppliers (agency_id, name, website, default_commission_pct, notes) values
    (ag, 'Tucano Tours', 'https://www.tucanotours.com.ar', 13, 'Mayorista principal. Consolidador de aéreos y paquetes.')
    returning id into sup_tucano;
  insert into suppliers (agency_id, name, website, default_commission_pct) values
    (ag, 'Delfos Turismo', 'https://www.delfos.tur.ar', 12) returning id into sup_delfos;
  insert into suppliers (agency_id, name, website, default_commission_pct) values
    (ag, 'Ola Mayorista', 'https://www.ola.com.ar', 11) returning id into sup_ola;

  -- ── Etiquetas ──
  insert into tags (agency_id, name, category, color) values (ag, 'Caribe', 'destino', 'cyan') returning id into t_caribe;
  insert into tags (agency_id, name, category, color) values (ag, 'Brasil', 'destino', 'green') returning id into t_brasil;
  insert into tags (agency_id, name, category, color) values (ag, 'Europa', 'destino', 'blue') returning id into t_europa;
  insert into tags (agency_id, name, category, color) values (ag, 'Turquía/Egipto', 'destino', 'amber') returning id into t_turquia;
  insert into tags (agency_id, name, category, color) values (ag, 'Bariloche', 'destino', 'violet') returning id into t_bariloche;
  insert into tags (agency_id, name, category, color) values (ag, 'Familiar', 'tipo_viaje', 'pink') returning id into t_familiar;
  insert into tags (agency_id, name, category, color) values (ag, 'Pareja', 'tipo_viaje', 'rose') returning id into t_pareja;
  insert into tags (agency_id, name, category, color) values (ag, 'Grupal', 'tipo_viaje', 'orange') returning id into t_grupal;
  insert into tags (agency_id, name, category, color) values (ag, 'Meta Ads', 'origen', 'indigo') returning id into t_meta;
  insert into tags (agency_id, name, category, color) values (ag, 'Instagram', 'origen', 'fuchsia') returning id into t_ig;
  insert into tags (agency_id, name, category, color) values (ag, 'Referido', 'origen', 'teal') returning id into t_referido;
  insert into tags (agency_id, name, category, color) values (ag, 'Verano 2027', 'temporada', 'yellow') returning id into t_verano;

  -- ── Plantillas WhatsApp ──
  insert into wa_templates (agency_id, name, meta_name, body, stage, is_approved) values
    (ag, 'Reenganche — Contactado', 'reenganche_contactado',
     'Hola {{nombre}}, soy {{vendedor}} de Sumaj 👋 Te escribo por tu consulta de {{destino}}. ¿Seguís buscando para esas fechas?',
     'contactado', true) returning id into tpl_contactado;
  insert into wa_templates (agency_id, name, meta_name, body, stage, is_approved) values
    (ag, 'Reenganche — Presupuestado', 'reenganche_presupuestado',
     'Hola {{nombre}}, ¿pudiste ver la propuesta de {{destino}}? Cualquier ajuste lo vemos por acá.',
     'presupuestado', true) returning id into tpl_presupuestado;
  insert into wa_templates (agency_id, name, meta_name, body, stage, is_approved) values
    (ag, 'Reenganche — En negociación', 'reenganche_negociacion',
     'Hola {{nombre}}, la tarifa de {{destino}} vence el {{fecha}}. ¿Avanzamos?',
     'negociacion', true) returning id into tpl_negociacion;
  insert into wa_templates (agency_id, name, meta_name, body, stage, is_approved) values
    (ag, 'Bienvenida — calificación', 'bienvenida_calificacion',
     '¡Hola {{nombre}}! Gracias por escribirnos 🌎 Para pasarte la mejor propuesta: ¿a qué destino querés viajar, en qué fechas y cuántos son?',
     null, true);

  -- ── Reglas de seguimiento (48h / día 7 / día 21) ──
  insert into followup_rules (agency_id, touch_number, hours_after_silence, applies_to_stages) values
    (ag, 1, 48,  array['contactado','presupuestado','negociacion']::lead_stage[]),
    (ag, 2, 168, array['contactado','presupuestado','negociacion']::lead_stage[]),
    (ag, 3, 504, array['presupuestado','negociacion']::lead_stage[]);

  -- ── Contactos ──
  insert into contacts (agency_id, full_name, phone, email, source, city) values
    (ag, 'Gabriela Suárez', '5493515550118', 'gabi.suarez@gmail.com', 'whatsapp', 'Córdoba') returning id into c_gabriela;
  insert into contacts (agency_id, full_name, phone, source, city) values
    (ag, 'Martín Ocampo', '5493515552341', 'whatsapp', 'Córdoba') returning id into c_martin;
  insert into contacts (agency_id, full_name, phone, email, source, city) values
    (ag, 'Sofía Benítez', '5493515557782', 'sofi.benitez@hotmail.com', 'instagram', 'Villa Carlos Paz') returning id into c_sofia;
  insert into contacts (agency_id, full_name, phone, source, city) values
    (ag, 'Diego Palacios', '5493515553019', 'whatsapp', 'Córdoba') returning id into c_diego;
  insert into contacts (agency_id, full_name, phone, source, city) values
    (ag, 'Valentina Ríos', '5493515558864', 'lead_form', 'Río Cuarto') returning id into c_valentina;
  insert into contacts (agency_id, full_name, phone, email, source, city, is_client, document_type, document_number, birth_date) values
    (ag, 'Lucas Medina', '5493515551507', 'lucas.medina@gmail.com', 'whatsapp', 'Córdoba', true, 'dni', '32456789', '1986-03-14') returning id into c_lucas;
  insert into contacts (agency_id, full_name, phone, source, city) values
    (ag, 'Camila Torres', '5493515559923', 'instagram', 'Córdoba') returning id into c_camila;
  insert into contacts (agency_id, full_name, phone, source, city) values
    (ag, 'Franco Gigena', '5493515554478', 'whatsapp', 'Alta Gracia') returning id into c_franco;
  insert into contacts (agency_id, full_name, phone, email, source, city, is_client, document_type, document_number, birth_date) values
    (ag, 'Julieta Paz', '5493515556690', 'juli.paz@gmail.com', 'referido', 'Córdoba', true, 'dni', '35678123', '1990-11-02') returning id into c_julieta;
  insert into contacts (agency_id, full_name, phone, source, city) values
    (ag, 'Marcos Villalba', '5493515552205', 'whatsapp', 'Córdoba') returning id into c_marcos;
  insert into contacts (agency_id, full_name, phone, source, city) values
    (ag, 'Agustina Ludueña', '5493515558137', 'whatsapp', 'Córdoba') returning id into c_agustina;
  insert into contacts (agency_id, full_name, phone, source, city) values
    (ag, 'Ricardo Nieto', '5493515553356', 'manual', 'Córdoba') returning id into c_ricardo;
  insert into contacts (agency_id, full_name, phone, source, city) values
    (ag, 'Paula Giordano', '5493515557214', 'instagram', 'Córdoba') returning id into c_paula;
  insert into contacts (agency_id, full_name, phone, source, city) values
    (ag, 'Hernán Quiroga', '5493515550452', 'whatsapp', 'Jesús María') returning id into c_hernan;

  -- Etiquetas de contactos
  insert into contact_tags (contact_id, tag_id, agency_id) values
    (c_gabriela, t_caribe, ag), (c_gabriela, t_pareja, ag), (c_gabriela, t_meta, ag),
    (c_martin, t_brasil, ag), (c_martin, t_familiar, ag), (c_martin, t_meta, ag),
    (c_sofia, t_europa, ag), (c_sofia, t_pareja, ag), (c_sofia, t_ig, ag),
    (c_diego, t_caribe, ag), (c_diego, t_grupal, ag), (c_diego, t_meta, ag),
    (c_valentina, t_turquia, ag), (c_valentina, t_pareja, ag),
    (c_lucas, t_caribe, ag), (c_lucas, t_familiar, ag), (c_lucas, t_verano, ag),
    (c_camila, t_brasil, ag), (c_camila, t_ig, ag),
    (c_franco, t_bariloche, ag), (c_franco, t_grupal, ag),
    (c_julieta, t_brasil, ag), (c_julieta, t_pareja, ag), (c_julieta, t_referido, ag),
    (c_marcos, t_europa, ag), (c_marcos, t_meta, ag),
    (c_agustina, t_caribe, ag), (c_agustina, t_meta, ag),
    (c_paula, t_brasil, ag), (c_paula, t_ig, ag),
    (c_hernan, t_turquia, ag), (c_hernan, t_meta, ag);

  -- Pasajeros del grupo familiar
  insert into travelers (agency_id, contact_id, full_name, relationship, birth_date, document_type, document_number, document_expiry) values
    (ag, c_lucas, 'Lucas Medina', 'titular', '1986-03-14', 'pasaporte', 'AAB123456', now()::date + interval '4 years'),
    (ag, c_lucas, 'Marina Coppola', 'pareja', '1988-07-22', 'pasaporte', 'AAB654321', now()::date + interval '2 months'),
    (ag, c_lucas, 'Benicio Medina', 'hijo', '2016-01-30', 'pasaporte', 'AAC111222', now()::date + interval '5 years');
  select id into tv1 from travelers where contact_id = c_lucas and relationship = 'titular';
  select id into tv2 from travelers where contact_id = c_lucas and relationship = 'pareja';
  select id into tv3 from travelers where contact_id = c_lucas and relationship = 'hijo';

  insert into travelers (agency_id, contact_id, full_name, relationship, birth_date, document_type, document_number, document_expiry) values
    (ag, c_julieta, 'Julieta Paz', 'titular', '1990-11-02', 'pasaporte', 'AAD998877', now()::date + interval '3 years'),
    (ag, c_julieta, 'Nicolás Ferrer', 'pareja', '1989-05-17', 'pasaporte', 'AAD776655', now()::date + interval '3 years');

  -- ── LEADS ──
  -- NUEVOS (sin asignar o recién llegados de la pauta)
  insert into leads (agency_id, contact_id, stage, position, destination, origin_channel, origin_campaign, pax_adults, pax_children, trip_type, initial_message, created_at) values
    (ag, c_agustina, 'nuevo', 1, 'Punta Cana', 'whatsapp', 'CTWA — Caribe Verano 2027', 2, 1, 'familiar',
     'Hola! Vi el anuncio de Punta Cana, ¿me pasás precios para enero?', now() - interval '25 minutes')
    returning id into l11;
  insert into leads (agency_id, contact_id, stage, position, destination, origin_channel, origin_campaign, pax_adults, trip_type, initial_message, created_at) values
    (ag, c_paula, 'nuevo', 2, 'Río de Janeiro', 'instagram', 'IG — Brasil Playas', 2, 'pareja',
     'Holaa ¿tienen paquetes a Río para octubre?', now() - interval '3 hours')
    returning id into l13;
  insert into leads (agency_id, contact_id, stage, position, destination, origin_channel, origin_campaign, pax_adults, trip_type, initial_message, created_at) values
    (ag, c_hernan, 'nuevo', 3, 'Estambul y El Cairo', 'whatsapp', 'CTWA — Turquía/Egipto', 2, 'pareja',
     'Buenas, quería info del tour por Turquía y Egipto que publicaron', now() - interval '6 hours')
    returning id into l14;

  -- CONTACTADOS
  insert into leads (agency_id, contact_id, stage, position, destination, origin_channel, origin_campaign, assigned_to, pax_adults, trip_type, next_action, next_action_at, created_at) values
    (ag, c_martin, 'contactado', 1, 'Florianópolis', 'whatsapp', 'CTWA — Brasil Familias', m_carla, 2, 'familiar',
     'Pasar opciones de hotel frente al mar', now() + interval '2 hours', now() - interval '2 days')
    returning id into l2;
  insert into leads (agency_id, contact_id, stage, position, destination, origin_channel, assigned_to, pax_adults, trip_type, next_action, next_action_at, created_at) values
    (ag, c_camila, 'contactado', 2, 'Buzios', 'instagram', m_luca, 2, 'pareja',
     'Confirmar fechas exactas de viaje', now() + interval '1 day', now() - interval '3 days')
    returning id into l7;
  insert into leads (agency_id, contact_id, stage, position, destination, origin_channel, origin_campaign, assigned_to, pax_adults, pax_children, trip_type, next_action, next_action_at, created_at) values
    (ag, c_marcos, 'contactado', 3, 'Madrid y Barcelona', 'whatsapp', 'CTWA — Europa 2027', m_tomas, 2, 2, 'familiar',
     'Averiguar tarifa de aéreos con Iberia para julio 2027', now() - interval '3 hours', now() - interval '4 days')
    returning id into l10;

  -- PRESUPUESTADOS
  insert into leads (agency_id, contact_id, stage, position, destination, origin_channel, origin_campaign, assigned_to, pax_adults, trip_type, budget_estimate, next_action, next_action_at, created_at) values
    (ag, c_gabriela, 'presupuestado', 1, 'Cancún', 'whatsapp', 'CTWA — Caribe Verano 2027', m_carla, 2, 'pareja', 1400,
     'Seguimiento del presupuesto enviado', now() + interval '5 hours', now() - interval '6 days')
    returning id into l1;
  insert into leads (agency_id, contact_id, stage, position, destination, origin_channel, assigned_to, pax_adults, trip_type, budget_estimate, next_action, next_action_at, created_at) values
    (ag, c_sofia, 'presupuestado', 2, 'Roma y París', 'instagram', m_tomas, 2, 'pareja', 3800,
     'Ajustar propuesta: quieren 3 noches más en París', now() + interval '1 day', now() - interval '8 days')
    returning id into l3;
  insert into leads (agency_id, contact_id, stage, position, destination, origin_channel, origin_campaign, assigned_to, pax_adults, trip_type, budget_estimate, next_action, next_action_at, created_at) values
    (ag, c_valentina, 'presupuestado', 3, 'Estambul y Capadocia', 'lead_form', 'Form — Turquía/Egipto', m_carla, 2, 'pareja', 2600,
     'Mandó señal de interés, reforzar con disponibilidad', now() - interval '1 day', now() - interval '10 days')
    returning id into l5;

  -- EN NEGOCIACIÓN
  insert into leads (agency_id, contact_id, stage, position, destination, origin_channel, origin_campaign, assigned_to, pax_adults, pax_children, trip_type, budget_estimate, next_action, next_action_at, created_at) values
    (ag, c_diego, 'negociacion', 1, 'Punta Cana', 'whatsapp', 'CTWA — Caribe Verano 2027', m_carla, 6, 2, 'grupal', 8200,
     'La tarifa grupal vence el viernes — llamar hoy', now() + interval '3 hours', now() - interval '12 days')
    returning id into l4;
  insert into leads (agency_id, contact_id, stage, position, destination, origin_channel, assigned_to, pax_adults, trip_type, budget_estimate, next_action, next_action_at, created_at) values
    (ag, c_franco, 'negociacion', 2, 'Bariloche', 'whatsapp', m_luca, 8, 'grupal', 4500,
     'Esperan confirmación del grupo para señar', now() + interval '2 days', now() - interval '9 days')
    returning id into l6;

  -- GANADOS
  insert into leads (agency_id, contact_id, stage, position, destination, origin_channel, origin_campaign, assigned_to, pax_adults, pax_children, trip_type, closed_at, created_at) values
    (ag, c_lucas, 'ganado', 1, 'Cancún', 'whatsapp', 'CTWA — Caribe Verano 2027', m_carla, 2, 1, 'familiar', now() - interval '5 days', now() - interval '20 days')
    returning id into l8;
  insert into leads (agency_id, contact_id, stage, position, destination, origin_channel, assigned_to, pax_adults, trip_type, closed_at, created_at) values
    (ag, c_julieta, 'ganado', 2, 'Río de Janeiro', 'referido', m_tomas, 2, 'pareja', now() - interval '12 days', now() - interval '30 days')
    returning id into l9;

  -- PERDIDO
  insert into leads (agency_id, contact_id, stage, position, destination, origin_channel, origin_campaign, assigned_to, pax_adults, trip_type, lost_reason, closed_at, created_at) values
    (ag, c_ricardo, 'perdido', 1, 'Miami', 'whatsapp', 'CTWA — Caribe Verano 2027', m_carla, 2, 'pareja',
     'Compró por su cuenta con millas', now() - interval '4 days', now() - interval '15 days')
    returning id into l12;

  -- ── Conversaciones + mensajes ──
  -- Gabriela (presupuestado, la del ejemplo)
  insert into conversations (agency_id, contact_id, wa_id, assigned_to, unread_count) values
    (ag, c_gabriela, '5493515550118', m_carla, 0) returning id into cv1;
  insert into messages (agency_id, conversation_id, direction, body, status, created_at) values
    (ag, cv1, 'in', 'Hola! Vi el anuncio de Cancún 😍 ¿me pasás precios para la primera quincena de enero? Somos 2', 'leido', now() - interval '6 days'),
    (ag, cv1, 'out', '¡Hola Gabi! Soy Carla de Sumaj 👋 ¡Enero es una época hermosa para Cancún! ¿Tienen fecha exacta y cuántas noches pensaban?', 'leido', now() - interval '6 days' + interval '4 minutes'),
    (ag, cv1, 'in', 'Del 10 al 17 de enero, 7 noches. Algo all inclusive si se puede', 'leido', now() - interval '6 days' + interval '22 minutes'),
    (ag, cv1, 'out', 'Perfecto 🙌 Te armo una propuesta con hotel all inclusive frente al mar y te la mando hoy mismo por acá.', 'leido', now() - interval '6 days' + interval '25 minutes'),
    (ag, cv1, 'out', 'Gabi, te paso el presupuesto que armamos para ustedes ✨ Cualquier duda escribime por acá 👇', 'leido', now() - interval '4 days');
  update messages set sent_by = m_carla where conversation_id = cv1 and direction = 'out';
  insert into messages (agency_id, conversation_id, direction, body, status, created_at) values
    (ag, cv1, 'in', '¡Gracias! Lo veo con mi novio esta noche y te digo 🙏', 'leido', now() - interval '4 days' + interval '1 hour');

  -- Martín (contactado)
  insert into conversations (agency_id, contact_id, wa_id, assigned_to, unread_count) values
    (ag, c_martin, '5493515552341', m_carla, 1) returning id into cv2;
  insert into messages (agency_id, conversation_id, direction, body, status, created_at) values
    (ag, cv2, 'in', 'Buenas! Consulto por Florianópolis para 2 adultos en febrero', 'leido', now() - interval '2 days'),
    (ag, cv2, 'out', '¡Hola Martín! Claro que sí 😊 ¿Alguna fecha puntual de febrero? ¿Y buscan hotel o algo tipo posada?', 'entregado', now() - interval '2 days' + interval '10 minutes'),
    (ag, cv2, 'in', 'Primera quincena. Hotel frente al mar si puede ser', 'leido', now() - interval '4 hours');
  update messages set sent_by = m_carla where conversation_id = cv2 and direction = 'out';

  -- Sofía (presupuestado)
  insert into conversations (agency_id, contact_id, wa_id, assigned_to, unread_count) values
    (ag, c_sofia, '5493515557782', m_tomas, 0) returning id into cv3;
  insert into messages (agency_id, conversation_id, direction, body, status, created_at) values
    (ag, cv3, 'in', 'Hola! Los sigo de IG. Queremos hacer Roma y París en mayo del año que viene, luna de miel 💍', 'leido', now() - interval '8 days'),
    (ag, cv3, 'out', '¡Hola Sofi! Felicitaciones 🥂 Mayo en Europa es ideal. Les armé una propuesta de 10 noches: 5 Roma + 5 París con aéreos incluidos. Te la paso 👇', 'leido', now() - interval '7 days'),
    (ag, cv3, 'in', 'Nos encantó!! Pero queremos 3 noches más en París, se puede?', 'leido', now() - interval '2 days');
  update messages set sent_by = m_tomas where conversation_id = cv3 and direction = 'out';

  -- Diego (negociación, grupal)
  insert into conversations (agency_id, contact_id, wa_id, assigned_to, unread_count) values
    (ag, c_diego, '5493515553019', m_carla, 0) returning id into cv4;
  insert into messages (agency_id, conversation_id, direction, body, status, created_at) values
    (ag, cv4, 'in', 'Hola, somos un grupo de 6 amigos + 2 chicos, queremos Punta Cana en marzo', 'leido', now() - interval '12 days'),
    (ag, cv4, 'out', '¡Hola Diego! Buenísimo, para grupos tenemos tarifas especiales. Te paso propuesta con el Riu Republica 🏝️', 'leido', now() - interval '11 days'),
    (ag, cv4, 'in', 'Che, el grupo está casi decidido. ¿Hasta cuándo aguanta el precio?', 'leido', now() - interval '1 day'),
    (ag, cv4, 'out', 'La tarifa grupal está tomada hasta el viernes. Si me confirman antes, congelamos precio con USD 200 de seña por persona 💪', 'leido', now() - interval '1 day' + interval '30 minutes');
  update messages set sent_by = m_carla where conversation_id = cv4 and direction = 'out';

  -- Agustina (lead nuevo sin responder — entra de la pauta)
  insert into conversations (agency_id, contact_id, wa_id, unread_count) values
    (ag, c_agustina, '5493515558137', 2) returning id into cv5;
  insert into messages (agency_id, conversation_id, direction, body, status, created_at) values
    (ag, cv5, 'in', 'Hola! Vi el anuncio de Punta Cana, ¿me pasás precios para enero?', 'entregado', now() - interval '25 minutes'),
    (ag, cv5, 'in', 'Somos 2 adultos y una nena de 6', 'entregado', now() - interval '23 minutes');
  insert into messages (agency_id, conversation_id, direction, body, is_automated, status, created_at) values
    (ag, cv5, 'out', '¡Hola! Gracias por escribirnos 🌎 Soy el asistente de Sumaj. Ya le paso tu consulta a un asesor. Para agilizar: ¿en qué fechas de enero y desde qué ciudad salen?', true, 'entregado', now() - interval '24 minutes');

  -- Lucas (ganado — cliente)
  insert into conversations (agency_id, contact_id, wa_id, assigned_to, unread_count) values
    (ag, c_lucas, '5493515551507', m_carla, 0) returning id into cv6;
  insert into messages (agency_id, conversation_id, direction, body, status, created_at) values
    (ag, cv6, 'in', 'Carla! Al final vamos con el plan B que nos pasaste, el Grand Oasis 👌', 'leido', now() - interval '6 days'),
    (ag, cv6, 'out', '¡Excelente elección Lucas! 🎉 Les armo el file y te paso los datos para la seña. Necesito pasaportes de los 3 cuando puedas.', 'leido', now() - interval '6 days' + interval '15 minutes'),
    (ag, cv6, 'in', 'Listo, te mandé la transferencia y las fotos de los pasaportes', 'leido', now() - interval '5 days'),
    (ag, cv6, 'out', '¡Recibido! Te mando el recibo 🧾 Quedan USD 2.100 para antes del 15/12. ¡Ya están comprados los aéreos! ✈️', 'leido', now() - interval '5 days' + interval '2 hours');
  update messages set sent_by = m_carla where conversation_id = cv6 and direction = 'out';

  -- Franco (negociación)
  insert into conversations (agency_id, contact_id, wa_id, assigned_to, unread_count) values
    (ag, c_franco, '5493515554478', m_luca, 0) returning id into cv8;
  insert into messages (agency_id, conversation_id, direction, body, status, created_at) values
    (ag, cv8, 'in', 'Luca, el grupo son 8 confirmados para Bariloche en agosto', 'leido', now() - interval '3 days'),
    (ag, cv8, 'out', 'Genial Franco 🏔️ Con 8 personas les mantengo la tarifa de grupo. ¿Cerramos con la seña esta semana?', 'leido', now() - interval '3 days' + interval '1 hour');
  update messages set sent_by = m_luca where conversation_id = cv8 and direction = 'out';

  -- ── COTIZACIONES ──
  -- Q1: Cancún Gabriela — réplica exacta del ejemplo de la planilla
  insert into quotes (agency_id, lead_id, contact_id, created_by, title, destination, currency, pax, nights,
    trip_date_from, trip_date_to, valid_until, status, markup_type, markup_value,
    total_cost, total_price, commission_total, notes, sent_at, theme)
  values (ag, l1, c_gabriela, m_carla, 'Cancún — Gabriela y Fede', 'Cancún', 'USD', 2, 7,
    date '2027-01-10', date '2027-01-17', now()::date + interval '10 days', 'enviado', 'monto', 150,
    1236.00, 1386.00, 170.65,
    'Incluye equipaje de bodega 23kg por pasajero. Tarifas sujetas a disponibilidad al momento de reservar.',
    now() - interval '4 days', '{"color": "sand", "font": "editorial"}'::jsonb)
  returning id into q1;
  insert into quote_items (agency_id, quote_id, type, description, supplier_id, cost, gross, commission_pct, position) values
    (ag, q1, 'aereo', 'Aéreos Córdoba–Cancún ida y vuelta, vía Panamá (Copa Airlines)', sup_tucano, 714.00, 700.00, 0, 1),
    (ag, q1, 'hotel', 'Hotel Krystal Cancún 4★ — 7 noches, all inclusive, hab. doble vista al mar', sup_tucano, 364.00, 350.00, 13, 2),
    (ag, q1, 'traslado', 'Traslados aeropuerto–hotel–aeropuerto en servicio compartido', sup_tucano, 78.00, 75.00, 13, 3),
    (ag, q1, 'asistencia', 'Asistencia al viajero Universal Assistance — cobertura USD 60.000', sup_tucano, 80.00, 80.00, 13, 4);

  -- Q2: Europa Sofía
  insert into quotes (agency_id, lead_id, contact_id, created_by, title, destination, currency, pax, nights,
    trip_date_from, trip_date_to, valid_until, status, markup_type, markup_value,
    total_cost, total_price, commission_total, notes, sent_at, theme)
  values (ag, l3, c_sofia, m_tomas, 'Luna de miel — Roma y París', 'Roma y París', 'USD', 2, 10,
    date '2027-05-08', date '2027-05-18', now()::date + interval '7 days', 'enviado', 'porcentaje', 8,
    3480.00, 3758.40, 458.40,
    'Habitación doble superior con desayuno. Tren Roma–París en primera clase incluido.',
    now() - interval '7 days', '{"color": "blue", "font": "moderna"}'::jsonb)
  returning id into q2;
  insert into quote_items (agency_id, quote_id, type, description, supplier_id, cost, gross, commission_pct, position) values
    (ag, q2, 'aereo', 'Aéreos Buenos Aires–Roma / París–Buenos Aires (ITA Airways)', sup_delfos, 1850.00, 1800.00, 0, 1),
    (ag, q2, 'hotel', 'Hotel Artemide 4★ Roma — 5 noches con desayuno', sup_delfos, 680.00, 650.00, 12, 2),
    (ag, q2, 'hotel', 'Hôtel Malte Opera 4★ París — 5 noches con desayuno', sup_delfos, 720.00, 690.00, 12, 3),
    (ag, q2, 'otro', 'Tren Roma–París (Frecciarossa + TGV) primera clase', sup_delfos, 150.00, null, 0, 4),
    (ag, q2, 'asistencia', 'Asistencia al viajero — cobertura Europa (Schengen)', sup_delfos, 80.00, 80.00, 12, 5);

  -- Q3: Punta Cana grupal Diego (negociación)
  insert into quotes (agency_id, lead_id, contact_id, created_by, title, destination, currency, pax, nights,
    trip_date_from, trip_date_to, valid_until, status, markup_type, markup_value,
    total_cost, total_price, commission_total, notes, sent_at, theme)
  values (ag, l4, c_diego, m_carla, 'Punta Cana — Grupo Diego (8 pax)', 'Punta Cana', 'USD', 8, 7,
    date '2027-03-13', date '2027-03-20', now()::date + interval '4 days', 'enviado', 'monto', 800,
    7360.00, 8160.00, 1462.40,
    'Tarifa grupal para 6 adultos + 2 menores. Seña de USD 200 por persona congela precio.',
    now() - interval '10 days', '{"color": "cyan", "font": "editorial"}'::jsonb)
  returning id into q3;
  insert into quote_items (agency_id, quote_id, type, description, supplier_id, cost, gross, commission_pct, position) values
    (ag, q3, 'aereo', 'Aéreos Córdoba–Punta Cana directo (Arajet) — 8 pasajeros', sup_tucano, 3760.00, 3700.00, 0, 1),
    (ag, q3, 'hotel', 'Riu Republica 5★ (adults friendly con sección familiar) — 7 noches all inclusive, 4 habitaciones', sup_tucano, 3100.00, 2980.00, 13, 2),
    (ag, q3, 'traslado', 'Traslados privados aeropuerto–hotel–aeropuerto (van exclusiva)', sup_tucano, 260.00, 250.00, 13, 3),
    (ag, q3, 'asistencia', 'Asistencia al viajero x8 — cobertura USD 35.000', sup_tucano, 240.00, 240.00, 13, 4);

  -- Q4: aceptada de Lucas (ya convertida en file más abajo)
  insert into quotes (agency_id, lead_id, contact_id, created_by, title, destination, currency, pax, nights,
    trip_date_from, trip_date_to, valid_until, status, markup_type, markup_value,
    total_cost, total_price, commission_total, notes, sent_at, accepted_at, theme)
  values (ag, l8, c_lucas, m_carla, 'Cancún — Familia Medina', 'Cancún', 'USD', 3, 7,
    date '2027-01-04', date '2027-01-11', now()::date - interval '2 days', 'aceptado', 'monto', 260,
    2840.00, 3100.00, 553.90,
    'Incluye habitación familiar. Menor de 10 años con 50% de descuento en hotel.',
    now() - interval '8 days', now() - interval '6 days', '{"color": "sand", "font": "editorial"}'::jsonb)
  returning id into q4;
  insert into quote_items (agency_id, quote_id, type, description, supplier_id, cost, gross, commission_pct, position) values
    (ag, q4, 'aereo', 'Aéreos Córdoba–Cancún vía Lima (LATAM) — 2 adultos + 1 menor', sup_tucano, 1620.00, 1580.00, 0, 1),
    (ag, q4, 'hotel', 'Grand Oasis Cancún 4★ — 7 noches all inclusive, hab. familiar', sup_tucano, 980.00, 940.00, 13, 2),
    (ag, q4, 'traslado', 'Traslados compartidos aeropuerto–hotel–aeropuerto x3', sup_tucano, 90.00, 87.00, 13, 3),
    (ag, q4, 'asistencia', 'Asistencia al viajero x3 — plan familiar', sup_tucano, 150.00, 150.00, 13, 4);

  -- ── FILES (ventas) ──
  -- F1: Lucas — Cancún (del presupuesto aceptado)
  insert into files (agency_id, contact_id, lead_id, quote_id, seller_id, destination,
    departure_date, return_date, status, currency, commission_pct, notes, created_at)
  values (ag, c_lucas, l8, q4, m_carla, 'Cancún',
    date '2027-01-04', date '2027-01-11', 'vendido', 'USD', 30,
    'Familia Medina: 2 adultos + Benicio (10). Pedir asientos juntos en LATAM.', now() - interval '5 days')
  returning id into f1;
  update leads set won_file_id = f1 where id = l8;
  update quotes set file_id = f1 where id = q4;

  insert into file_services (agency_id, file_id, type, description, supplier_id, reservation_code, date_from, date_to, cost, price, position) values
    (ag, f1, 'aereo', 'Aéreos CBA–CUN vía Lima (LATAM)', sup_tucano, 'LTM-8842XK', date '2027-01-04', date '2027-01-11', 1620.00, 1760.00, 1),
    (ag, f1, 'hotel', 'Grand Oasis Cancún — 7 noches all inclusive', sup_tucano, 'TCN-445217', date '2027-01-04', date '2027-01-11', 980.00, 1090.00, 2),
    (ag, f1, 'traslado', 'Traslados IN/OUT compartidos x3', sup_tucano, 'TCN-445218', date '2027-01-04', date '2027-01-11', 90.00, 100.00, 3),
    (ag, f1, 'asistencia', 'Asistencia al viajero plan familiar x3', sup_tucano, 'UA-99120', date '2027-01-04', date '2027-01-11', 150.00, 150.00, 4);

  insert into file_travelers (file_id, traveler_id, agency_id) values
    (f1, tv1, ag), (f1, tv2, ag), (f1, tv3, ag);

  insert into payments (agency_id, file_id, contact_id, direction, method, currency, amount, amount_in_file_currency, received_by, note, paid_at, created_at) values
    (ag, f1, c_lucas, 'cobro', 'transferencia', 'USD', 1000.00, 1000.00, m_carla, 'Seña 30% — transferencia en USD', (now() - interval '5 days')::date, now() - interval '5 days');

  -- F2: Julieta — Río (viaje próximo, pagado completo)
  insert into files (agency_id, contact_id, lead_id, seller_id, destination,
    departure_date, return_date, status, currency, commission_pct, notes, created_at)
  values (ag, c_julieta, l9, m_tomas, 'Río de Janeiro',
    (now() + interval '18 days')::date, (now() + interval '25 days')::date, 'pagado', 'USD', 0,
    'Aniversario. Dejaron propina para upgrade de habitación con vista.', now() - interval '12 days')
  returning id into f2;
  update leads set won_file_id = f2 where id = l9;

  insert into file_services (agency_id, file_id, type, description, supplier_id, reservation_code, date_from, date_to, cost, price, paid_to_supplier, position) values
    (ag, f2, 'aereo', 'Aéreos CBA–GIG directo (GOL)', sup_ola, 'GOL-71D2M', (now() + interval '18 days')::date, (now() + interval '25 days')::date, 640.00, 720.00, true, 1),
    (ag, f2, 'hotel', 'Hotel Arena Copacabana 4★ — 7 noches con desayuno, vista al mar', sup_ola, 'OLA-30988', (now() + interval '18 days')::date, (now() + interval '25 days')::date, 810.00, 920.00, true, 2),
    (ag, f2, 'excursion', 'City tour + Cristo Redentor + Pan de Azúcar', sup_ola, 'OLA-31002', (now() + interval '20 days')::date, (now() + interval '20 days')::date, 120.00, 150.00, false, 3),
    (ag, f2, 'asistencia', 'Asistencia al viajero x2', sup_ola, 'UA-99417', (now() + interval '18 days')::date, (now() + interval '25 days')::date, 70.00, 90.00, true, 4);

  insert into payments (agency_id, file_id, contact_id, direction, method, currency, amount, amount_in_file_currency, received_by, note, paid_at, created_at) values
    (ag, f2, c_julieta, 'cobro', 'transferencia', 'USD', 900.00, 900.00, m_tomas, 'Seña 50%', (now() - interval '12 days')::date, now() - interval '12 days'),
    (ag, f2, c_julieta, 'cobro', 'efectivo', 'ARS', 1450000.00, 980.00, m_tomas, 'Saldo en pesos — cotización 1479,59', (now() - interval '3 days')::date, now() - interval '3 days');
  update payments set exchange_rate = 1479.59 where file_id = f2 and currency = 'ARS';

  -- pago a proveedor de F2
  insert into payments (agency_id, file_id, direction, method, currency, amount, amount_in_file_currency, supplier_id, note, paid_at, created_at) values
    (ag, f2, 'pago_proveedor', 'transferencia', 'USD', 1520.00, 1520.00, sup_ola, 'Pago Ola Mayorista: aéreo + hotel + asistencia', (now() - interval '2 days')::date, now() - interval '2 days');

  -- ── Actividades (timeline) ──
  insert into activities (agency_id, lead_id, contact_id, member_id, type, body, created_at) values
    (ag, l1, c_gabriela, m_carla, 'etapa', 'Lead movido a Presupuestado', now() - interval '4 days'),
    (ag, l1, c_gabriela, m_carla, 'presupuesto', 'Presupuesto P-0001 enviado por WhatsApp (USD 1.386)', now() - interval '4 days'),
    (ag, l3, c_sofia, m_tomas, 'presupuesto', 'Presupuesto P-0002 enviado por WhatsApp (USD 3.758)', now() - interval '7 days'),
    (ag, l3, c_sofia, m_tomas, 'nota', 'Piden 3 noches más en París — recotizar con Delfos', now() - interval '2 days'),
    (ag, l4, c_diego, m_carla, 'llamada', 'Llamada con Diego: el grupo junta las señas este fin de semana', now() - interval '2 days'),
    (ag, l4, c_diego, m_carla, 'nota', '⚠️ La tarifa grupal del Riu vence el viernes', now() - interval '1 day'),
    (ag, l8, c_lucas, m_carla, 'etapa', 'Lead ganado 🎉 — se creó el file F-0001', now() - interval '5 days'),
    (ag, l9, c_julieta, m_tomas, 'etapa', 'Lead ganado 🎉 — se creó el file F-0002', now() - interval '12 days'),
    (ag, l12, c_ricardo, m_carla, 'etapa', 'Lead perdido: compró por su cuenta con millas', now() - interval '4 days'),
    (ag, l2, c_martin, m_carla, 'whatsapp', 'Respondió: quiere hotel frente al mar, primera quincena de febrero', now() - interval '4 hours');

  insert into activities (agency_id, file_id, contact_id, member_id, type, body, created_at) values
    (ag, f1, c_lucas, m_carla, 'sistema', 'Cobro registrado: USD 1.000 (transferencia) — recibo R-0001', now() - interval '5 days'),
    (ag, f2, c_julieta, m_tomas, 'sistema', 'File saldado ✅ — cobros completos por USD 1.880', now() - interval '3 days');

  -- ── Seguimientos programados (cola de reenganche) ──
  insert into followups (agency_id, lead_id, conversation_id, rule_id, touch_number, scheduled_at, template_id, status) values
    (ag, l1, cv1, (select id from followup_rules where agency_id = ag and touch_number = 1), 1,
     now() + interval '8 hours', tpl_presupuestado, 'pendiente'),
    (ag, l5, null, (select id from followup_rules where agency_id = ag and touch_number = 2), 2,
     now() + interval '1 day', tpl_presupuestado, 'pendiente');

  -- ── Notificaciones ──
  insert into notifications (agency_id, member_id, type, title, body, link, created_at) values
    (ag, m_carla, 'lead_nuevo', 'Nuevo lead de Meta', 'Agustina Ludueña consultó por Punta Cana (CTWA — Caribe Verano 2027)', '/crm', now() - interval '25 minutes'),
    (ag, m_carla, 'seguimiento', 'Seguimiento vencido', 'Valentina Ríos (Estambul y Capadocia) tenía seguimiento ayer', '/crm', now() - interval '10 hours'),
    (ag, m_tomas, 'documento', 'Pasaporte por vencer', 'El pasaporte de Marina Coppola (grupo Medina) vence en 2 meses — viajan a Cancún en enero', '/clientes', now() - interval '1 day'),
    (ag, m_tomas, 'salida', 'Salida próxima', 'Julieta Paz viaja a Río de Janeiro en 18 días — file F-0002', '/files', now() - interval '2 days');

end $$;
