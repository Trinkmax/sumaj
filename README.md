# viajerOS — el sistema operativo de tu agencia de viajes

Multi-tenant: cada agencia con su marca (la primera es **Sumaj Viajes**, con su logo propio en los comprobantes y el shell).

**Vender y organizar.** CRM con pipeline kanban + WhatsApp embebido + cotizador +
files + caja, multi-tenant, mobile-first. Construido con Next.js 16, React 19,
Tailwind v4 y Supabase.

## Arranque

```bash
pnpm install
cp .env.example .env.local   # el proyecto Supabase ya viene puesto; los secretos se completan
pnpm dev
```

### Variables de entorno

| Variable | Para qué |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` | conexión a Supabase — **requeridas** |
| `NEXT_PUBLIC_APP_URL` | links públicos de presupuestos, recibos y acceso al login — **requerida** |
| `SUPABASE_SERVICE_ROLE_KEY` | WhatsApp entrante, seguimientos, QR de las sucursales y alta directa del equipo — **requerida en producción** |
| `WA_CLOUD_TOKEN` · `WA_CLOUD_VERIFY_TOKEN` · `WA_CLOUD_APP_SECRET` | número madre por Cloud API de Meta — **las tres requeridas** para recibir consultas |
| `WA_WORKER_URL` · `WA_WORKER_TOKEN` · `WA_WEBHOOK_SECRET` | worker de WhatsApp de las sucursales (ver `/worker`) |
| `WA_CRON_SECRET` | despacho del seguimiento automático (`POST /api/wa/followups/run`) |

`SUPABASE_SERVICE_ROLE_KEY` no es opcional en un deploy real: sin ella los webhooks de
WhatsApp contestan 503 y las consultas no entran, el seguimiento automático no sale y el
QR de las sucursales no se puede mostrar. Lo único que degrada elegante es el alta del
equipo: con la clave, el admin pone email y contraseña en Configuración → Equipo y la
cuenta queda lista para pasarle el acceso por WhatsApp; sin la clave queda una invitación
y la persona entra sola la primera vez con ese email y contraseña.
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
la app y en el worker, y el worker necesita `APP_URL` apuntando a la app: sin esa
variable no arranca, porque un worker que le avisa al lugar equivocado pierde cada
consulta en un log. El detalle está en [`worker/README.md`](worker/README.md).
Sin nada de esto configurado la app funciona igual: los mensajes se registran y la
UI avisa que el número no está vinculado.

#### Set mínimo para que WhatsApp ande en producción

El webhook de Meta valida la firma HMAC de cada POST con el App Secret y **rechaza todo
con 401 si falta `WA_CLOUD_APP_SECRET`**: `/api/wa` es público (Meta, el worker y el cron
no tienen cookie de sesión), así que sin firma cualquiera podría inyectar contactos, leads
y mensajes falsos. Por eso el orden importa — primero el secreto, después el deploy:

1. En Vercel → Settings → Environment Variables, cargar en **Production y Preview**:
   `SUPABASE_SERVICE_ROLE_KEY`, `WA_CLOUD_TOKEN`, `WA_CLOUD_VERIFY_TOKEN`,
   `WA_CLOUD_APP_SECRET`, `WA_CRON_SECRET` y —si el worker ya está desplegado—
   `WA_WORKER_URL`, `WA_WORKER_TOKEN` y `WA_WEBHOOK_SECRET`.
2. Deployar. Las variables se leen del entorno del server: sin redeploy no toman efecto.
3. En Meta → WhatsApp → Configuration → Webhook: URL
   `{NEXT_PUBLIC_APP_URL}/api/wa/cloud/webhook`, verify token = `WA_CLOUD_VERIFY_TOKEN`,
   campo suscripto `messages`. La verificación (GET) no usa la firma, así que la
   suscripción se puede dejar armada antes de tener el App Secret.
4. Cargar el `phone_number_id` del número madre en Configuración → WhatsApp.
5. **Registrar el número** en Configuración → WhatsApp. Meta da de alta y verifica el número,
   pero el registro final va por API (`POST /{phone_number_id}/register`): en el panel nuevo
   de Meta el botón "Registrarte" queda gris ("number registration is unavailable for this
   account now") y el número se queda en **Pendiente** para siempre. Mientras esté pendiente
   Meta **no entrega nada al webhook**, por más que el número esté verificado y la
   suscripción a `messages` armada.
   El PIN son los 6 dígitos de la **verificación en dos pasos del número**: si ya está
   activa hay que mandar el PIN existente (si no, Meta contesta 133005); si no lo está, el
   que se carga queda fijado. No se guarda en la base, así que hay que anotarlo aparte.
   Si nadie lo recuerda, resetearlo en WhatsApp Manager → el número → Verificación en dos
   pasos **antes** de reintentar: Meta permite 10 registros por número cada 72 hs y al
   pasarse devuelve 133016 y bloquea el número tres días.
6. Vincular por QR el número de cada sucursal en Configuración → Sucursales (pide el worker vivo).

**Qué falta hoy**: en `.env.local` solo están `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` y `NEXT_PUBLIC_APP_URL`. Faltan cargar
`SUPABASE_SERVICE_ROLE_KEY`, las tres de la Cloud API, las tres del worker y
`WA_CRON_SECRET`. Mientras falten, ninguna consulta de WhatsApp entra al sistema.

#### Prender el seguimiento automático

`app.dispatch_followups()` corre cada hora (pg_cron, minuto 25) y despierta la ruta de la
app, pero no hace nada mientras las dos filas de `app_config` estén vacías — que es como
están hoy. Con la app ya desplegada, correr en el SQL editor de Supabase:

```sql
update app_config set value = 'https://TU-APP/api/wa/followups/run', updated_at = now()
 where key = 'followups_url';
update app_config set value = 'EL-MISMO-VALOR-DE-WA_CRON_SECRET', updated_at = now()
 where key = 'followups_secret';
```

Si el secreto no coincide con `WA_CRON_SECRET`, la ruta responde 401 y los seguimientos
quedan encolados sin salir.

### Cuentas

La base de producción está en blanco: no hay datos de ejemplo ni usuarios demo. Queda un
admin de respaldo (`tomas@sumaj.tur.ar`) y 5 invitaciones pendientes del equipo real
(`@sumajviajes.com`): cada persona se registra con su email y el sistema la suma al equipo
con el rol de su invitación. Las contraseñas no viven en el repo.

## Qué hay adentro

- **/inicio** — el día del vendedor (leads sin atender, seguimientos, chats) + el mes del socio (ventas, utilidad, cobrado, ranking, rendimiento de la pauta, radar de salidas/documentos/cumpleaños).
- **/crm** — pipeline kanban con drag & drop optimista, vista embudo con conversión por etapa y por campaña de Meta, detalle de lead con timeline, próxima acción y acciones de un toque (Chat / Presupuestar / Ganar / Perder).
- **/chats** — bandeja de WhatsApp embebida: burbujas, ticks, ventana de 24 hs con plantillas pre-aprobadas, panel del lead y envío de presupuestos sin salir de la conversación.
- **/presupuestos** — cotizador que replica la planilla (Final/Bruto/% comisión mayorista, markup, comisión por grupo) + presupuesto de papelería fina compartible: link público `/p/{token}`, imagen PNG para WhatsApp, temas de color y tipografía.
- **/files** — la venta: servicios con costo/precio, utilidad y comisión del vendedor, pasajeros con vencimiento de documentos, cobros con recibo compartible `/r/{token}`.
- **/caja** — movimientos, cuenta corriente con recordatorios por WhatsApp, comisiones por vendedor, multimoneda ARS/USD con cotización.
- **/config** — agencia (logo, tema de comprobantes, fees del cotizador y comisión del vendedor), equipo (alta de usuarios con email y contraseña, listo para pasar por WhatsApp), etiquetas, proveedores mayoristas con su % de comisión, plantillas de WhatsApp, cadencia de seguimiento automático (48 h → 7 d → 21 d) y conexión de la Cloud API.

## Automatización

- `POST /api/wa/cloud/webhook` — entrantes del número madre: crea contacto → conversación → mensaje → **lead automático** con campaña CTWA, contesta al instante, deriva a la sucursal y avisa a sus operadores. Firma validada con `WA_CLOUD_APP_SECRET`.
- `POST /api/wa/baileys/events` — entrantes de los números de sucursal, que le manda el worker firmados con `WA_WEBHOOK_SECRET`.
- `app.enqueue_followups()` (pg_cron, minuto 15) encola el reenganche 48 h / día 7 / día 21 según etapa; `app.dispatch_followups()` (minuto 25) despierta `POST /api/wa/followups/run`, que lo manda **por el número de la sucursal** (sin ventana de 24 hs, sin costo) y solo cae a plantilla paga del número madre si la sucursal no tiene número vinculado.
- `app.daily_notifications()` (pg_cron diario, 9:00 ART): documentos por vencer, salidas próximas, cumpleaños y seguimientos vencidos.

Las edge functions de `supabase/functions/` (`wa-webhook`, `wa-send`, `followups-run`) son de la etapa anterior, cuando todo el WhatsApp salía por la Cloud API paga: hoy el cron ya no las llama (ver `0015_followups_por_sucursal.sql`).

## Arquitectura

- Multi-tenant por `agency_id` con RLS en todas las tablas (admin/vendedor ven su agencia; freelance solo lo suyo). Columnas de privilegio de `members` protegidas por trigger.
- Páginas públicas token-gated vía RPC `quote_public`/`receipt_public` (security definer, solo datos de cara al cliente).
- Convenciones de código en `CONVENTIONS.md` y lenguaje visual en `DESIGN.md`.
- Migraciones en `supabase/migrations/` (aplicadas al proyecto `zgfquryagiuncndjbmhf`). **No hay seed**: la base es la de producción y arranca vacía — no volver a inyectar datos de ejemplo.
