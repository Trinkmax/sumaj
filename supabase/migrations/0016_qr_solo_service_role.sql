-- El QR de vinculación es la llave del WhatsApp de la sucursal: quien lo escanea
-- se queda con la sesión. La policy de wa_channels deja leer la fila a todo el
-- equipo (hace falta para el chip del chat y la ventana de 24 hs), así que las
-- tres columnas sensibles se sacan del alcance de `authenticated` a nivel
-- privilegio de columna. Las lee solo el service role (el worker y la action
-- getChannelState, que además exige admin).

revoke select on public.wa_channels from authenticated;

grant select (
  id, agency_id, branch_id, kind, is_mother, label, phone, status,
  phone_number_id, last_connected_at,
  auto_reply_enabled, auto_reply_text,
  created_at, updated_at
) on public.wa_channels to authenticated;

-- qr, qr_expires_at y last_error quedan fuera a propósito.

comment on column public.wa_channels.qr is
  'QR de vinculación. Solo service role: quien lo escanea se queda con la sesión de WhatsApp de la sucursal.';
