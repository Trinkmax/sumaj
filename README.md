# viajerOS — el sistema operativo de tu agencia de viajes

Multi-tenant: cada agencia con su marca (la primera es **Sumaj Viajes**, con su logo propio en los comprobantes y el shell).

**Vender y organizar.** CRM con pipeline kanban + WhatsApp embebido + cotizador +
files + caja, multi-tenant, mobile-first. Construido con Next.js 16, React 19,
Tailwind v4 y Supabase.

## Arranque

```bash
pnpm install
cp .env.example .env.local   # ya viene configurado para el proyecto Supabase
pnpm dev
```

Usuarios demo (password `sumaj2026`):

| Email | Rol |
|---|---|
| tomas@sumaj.tur.ar | Socio/Admin |
| carla@sumaj.tur.ar | Vendedora |
| luca@sumaj.tur.ar | Freelance |

## Qué hay adentro

- **/inicio** — el día del vendedor (leads sin atender, seguimientos, chats) + el mes del socio (ventas, utilidad, cobrado, ranking, rendimiento de la pauta, radar de salidas/documentos/cumpleaños).
- **/crm** — pipeline kanban con drag & drop optimista, vista embudo con conversión por etapa y por campaña de Meta, detalle de lead con timeline, próxima acción y acciones de un toque (Chat / Presupuestar / Ganar / Perder).
- **/chats** — bandeja de WhatsApp embebida: burbujas, ticks, ventana de 24 hs con plantillas pre-aprobadas, panel del lead y envío de presupuestos sin salir de la conversación.
- **/presupuestos** — cotizador que replica la planilla (Final/Bruto/% comisión mayorista, markup, comisión por grupo) + presupuesto de papelería fina compartible: link público `/p/{token}`, imagen PNG para WhatsApp, temas de color y tipografía.
- **/files** — la venta: servicios con costo/precio, utilidad y comisión del vendedor, pasajeros con vencimiento de documentos, cobros con recibo compartible `/r/{token}`.
- **/caja** — movimientos, cuenta corriente con recordatorios por WhatsApp, comisiones por vendedor, multimoneda ARS/USD con cotización.
- **/config** — agencia (logo, tema de comprobantes), equipo e invitaciones, etiquetas, proveedores (Tucano Tours precargado), plantillas de WhatsApp, cadencia de seguimiento automático (48 h → 7 d → 21 d) y conexión de la Cloud API.

## Automatización (Supabase)

- `wa-webhook` (edge function): recibe mensajes de Meta, crea contacto → conversación → mensaje → **lead automático** con campaña CTWA, y responde al instante. Verificación de firma con `META_APP_SECRET`.
- `wa-send`: envía mensajes/plantillas por la Graph API.
- `followups-run` + `app.enqueue_followups()` (pg_cron cada hora): reenganche automático 48 h / día 7 / día 21 según etapa, con plantillas aprobadas. Sin credenciales queda en cola (modo honesto).
- `app.daily_notifications()` (pg_cron diario): documentos por vencer, salidas próximas, cumpleaños y seguimientos vencidos.

Para conectar WhatsApp real: `supabase secrets set WHATSAPP_TOKEN=... WA_VERIFY_TOKEN=... META_APP_SECRET=...`, cargar el `phone_number_id` en Configuración → WhatsApp, y pegar la URL del webhook en Meta.

## Arquitectura

- Multi-tenant por `agency_id` con RLS en todas las tablas (admin/vendedor ven su agencia; freelance solo lo suyo). Columnas de privilegio de `members` protegidas por trigger.
- Páginas públicas token-gated vía RPC `quote_public`/`receipt_public` (security definer, solo datos de cara al cliente).
- Convenciones de código en `CONVENTIONS.md` y lenguaje visual en `DESIGN.md`.
- Migraciones en `supabase/migrations/` (aplicadas al proyecto `zgfquryagiuncndjbmhf`), seed demo en `supabase/seed.sql`.
