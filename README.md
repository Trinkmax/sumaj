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

### Variables de entorno

| Variable | Para qué |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` | conexión a Supabase |
| `NEXT_PUBLIC_APP_URL` | links públicos de presupuestos, recibos y acceso al login |
| `SUPABASE_SERVICE_ROLE_KEY` | alta directa de usuarios del equipo y webhooks de WhatsApp — **opcional pero recomendada** |
| `WA_CLOUD_TOKEN` · `WA_CLOUD_VERIFY_TOKEN` | número madre por Cloud API de Meta |
| `WA_WORKER_URL` · `WA_WORKER_TOKEN` · `WA_WEBHOOK_SECRET` | worker de WhatsApp de las sucursales (ver `/worker`) |

`SUPABASE_SERVICE_ROLE_KEY` habilita el alta directa de usuarios del equipo:
el admin pone email y contraseña en Configuración → Equipo y la cuenta queda lista
para pasarle el acceso por WhatsApp. Sin la clave el alta igual funciona, pero deja
una invitación y la persona entra sola la primera vez con ese email y contraseña.
**Nunca se expone al browser**: no lleva prefijo `NEXT_PUBLIC_`, vive solo en el
servidor (`src/lib/supabase/admin.ts`) y saltea todas las políticas RLS.

### WhatsApp: número madre + sucursales

Todas las consultas entran por un **número madre** (Cloud API oficial): el sistema
contesta solo, crea el lead, lo deriva a la sucursal que corresponda y avisa a sus
operadores. Después, cada **sucursal** sigue la charla desde su propio número,
vinculado por QR con el worker de `/worker` (Baileys): ahí **no hay ventana de 24 hs
ni plantillas pagas**, así el seguimiento no cuesta.

```bash
cd worker && npm install && cp .env.example .env && npm run dev
```

Los secretos `WA_WORKER_TOKEN` y `WA_WEBHOOK_SECRET` tienen que ser los mismos en
la app y en el worker. El detalle está en [`worker/README.md`](worker/README.md).
Sin nada de esto configurado la app funciona igual: los mensajes se registran y la
UI avisa que el número no está vinculado.

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
- **/config** — agencia (logo, tema de comprobantes, fees del cotizador y comisión del vendedor), equipo (alta de usuarios con email y contraseña, listo para pasar por WhatsApp), etiquetas, proveedores (Tucano Tours precargado), plantillas de WhatsApp, cadencia de seguimiento automático (48 h → 7 d → 21 d) y conexión de la Cloud API.

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
