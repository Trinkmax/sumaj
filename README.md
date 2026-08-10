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
| `SUPABASE_SERVICE_ROLE_KEY` | credenciales de Meta (guardarlas y leerlas), WhatsApp entrante, seguimientos, QR de las sucursales y alta directa del equipo — **requerida en producción** |
| `WA_GRAPH_VERSION` | versión del Graph API de Meta — opcional, por defecto `v25.0` |
| `WA_CLOUD_LEGACY_AGENCY_ID` | **legacy y opcional**: uuid de la única agencia autorizada a usar el fallback de abajo. Sin ella, esas tres no se leen |
| `WA_CLOUD_TOKEN` · `WA_CLOUD_VERIFY_TOKEN` · `WA_CLOUD_APP_SECRET` | **legacy y opcionales**: fallback para esa agencia mientras no cargue sus credenciales en Configuración → WhatsApp |
| `WA_WORKER_URL` · `WA_WORKER_TOKEN` · `WA_WEBHOOK_SECRET` | worker de WhatsApp de las sucursales (ver `/worker`) |
| `WA_CRON_SECRET` | despacho del seguimiento automático (`POST /api/wa/followups/run`) y renovación del token de Instagram (`POST /api/ig/token/refresh`) |
| `IG_GRAPH_VERSION` | versión del Graph API para Instagram — opcional, por defecto `v25.0` |

`SUPABASE_SERVICE_ROLE_KEY` no es opcional en un deploy real, y desde que las
credenciales de Meta viven en la base lo es todavía menos: los secretos de la Cloud API
se guardan cifrados en el Vault de Supabase y las funciones que los descifran solo se lo
permiten al service role, así que sin esa clave el admin **no puede ni guardar ni leer**
las credenciales y Configuración → WhatsApp queda muerta. Sumado a eso: los webhooks
contestan 503 y las consultas no entran, el seguimiento automático no sale y el QR de las
sucursales no se puede mostrar. Lo único que degrada elegante es el alta del equipo: con
la clave, el admin pone email y contraseña en Configuración → Equipo y la cuenta queda
lista para pasarle el acceso por WhatsApp; sin la clave queda una invitación y la persona
entra sola la primera vez con ese email y contraseña.
**Nunca se expone al browser**: no lleva prefijo `NEXT_PUBLIC_`, vive solo en el
servidor (`src/lib/supabase/admin.ts`) y saltea todas las políticas RLS.

Las tres `WA_CLOUD_*` quedaron como **fallback de transición**. Lo normal hoy es no
cargarlas: el admin pega las credenciales de Meta en Configuración → WhatsApp y viven por
agencia en la base (cifradas en el Vault). Una variable de entorno es una sola cuenta de
Meta para todo el deploy — con varias agencias eso no cierra.

El fallback está atado a **una sola agencia**, la que se nombre en
`WA_CLOUD_LEGACY_AGENCY_ID` (el uuid de la fila en `agencies`). Sin esa variable las tres
`WA_CLOUD_*` no se leen nunca. No es un detalle de prolijidad: el App Secret es la llave con
la que se valida la firma de cada webhook, así que si todas las agencias sin credenciales
propias compartieran el del entorno, la firma probaría que quien mandó el mensaje conoce ese
secreto pero **no de qué agencia es** — y el admin de la agencia dueña de esa app de Meta
podría inyectarle contactos, leads y mensajes a cualquier otra.

### WhatsApp: número madre + sucursales

Todas las consultas entran por un **número madre** (Cloud API oficial): el sistema
contesta solo, crea el lead, lo deriva a la sucursal que corresponda y avisa a sus
operadores. La cuenta de Meta del número madre se conecta desde **Configuración →
WhatsApp**, con un asistente que valida las credenciales contra Meta, suscribe el
webhook y diagnostica lo que falta. Después, cada **sucursal** sigue la charla desde su
propio número, vinculado por QR con el worker de `/worker` (Baileys): ahí **no hay
ventana de 24 hs ni plantillas pagas**, así el seguimiento no cuesta.

```bash
cd worker && npm install && cp .env.example .env && npm run dev
```

Los secretos `WA_WORKER_TOKEN` y `WA_WEBHOOK_SECRET` tienen que ser los mismos en
la app y en el worker, y el worker necesita `APP_URL` apuntando a la app: sin esa
variable no arranca, porque un worker que le avisa al lugar equivocado pierde cada
consulta en un log. El detalle está en [`worker/README.md`](worker/README.md).
Sin nada de esto configurado la app funciona igual: los mensajes se registran y la
UI avisa que el número no está vinculado.

#### Poner WhatsApp en marcha

Las credenciales de Meta ya no son variables de entorno: se cargan desde la app y viven
por agencia, cifradas en el Vault de Supabase. Eso cambia el orden — para deployar no hace
falta tener nada de Meta a mano, y renovar un token dejó de ser un redeploy.

1. En Vercel → Settings → Environment Variables, cargar en **Production y Preview**:
   `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL` (la dirección pública de verdad, no
   localhost: es la que Meta va a verificar) y `WA_CRON_SECRET`; si el worker ya está
   desplegado, también `WA_WORKER_URL`, `WA_WORKER_TOKEN` y `WA_WEBHOOK_SECRET`. De Meta,
   nada.
2. Deployar. Las variables se leen del entorno del server: sin redeploy no toman efecto.
3. Juntar cuatro datos del panel de Meta:
   - **Access token** permanente — Configuración del negocio → Usuarios del sistema, con
     los permisos `whatsapp_business_management` y `whatsapp_business_messaging`, y la
     cuenta de WhatsApp asignada al usuario como activo con control total.
   - **App ID** y **App Secret** — Meta for Developers → Configuración → Básica.
   - **WABA ID** — WhatsApp Manager, arriba a la izquierda.
4. Entrar a **Configuración → WhatsApp**, pegar los cuatro y guardar. El sistema los valida
   contra Meta en el momento: que el App ID y el App Secret sean de la misma app, que el
   token sea de esa app, si vence, que tenga los permisos y que alcance a esa cuenta. Si
   algo no cierra, dice qué es y dónde se arregla. Los secretos se guardan en el Vault y no
   vuelven a salir de ahí.
5. Elegir cuál de los números de la cuenta es el **número madre** — sale de una lista, no
   hay que tipear el `phone_number_id`— y tocar **Conectar**. El sistema le dice a Meta por
   API que entregue los mensajes a `{NEXT_PUBLIC_APP_URL}/api/wa/cloud/webhook/{slug}` con
   un verify token que genera solo, y corre el diagnóstico completo. En el panel de Meta no
   hay que configurar nada a mano. (Si la verificación del webhook falla —típico: la
   dirección pública apunta a algo que no está en línea—, la pantalla deja pedir el verify
   token para pegarlo a mano en Meta.)
6. **Registrar el número** si el diagnóstico lo pide. Meta da de alta y verifica el número,
   pero el registro final va por API (`POST /{phone_number_id}/register`): en el panel nuevo
   de Meta el botón "Registrarte" queda gris ("number registration is unavailable for this
   account now") y el número se queda en **Pendiente** para siempre. Mientras esté pendiente
   Meta **no entrega nada al webhook**, por más que el número esté verificado y la
   suscripción armada.
   El PIN son los 6 dígitos de la **verificación en dos pasos del número**: si ya está
   activa hay que mandar el PIN existente (si no, Meta contesta 133005); si no lo está, el
   que se carga queda fijado. No se guarda en la base, así que hay que anotarlo aparte.
   Si nadie lo recuerda, resetearlo en WhatsApp Manager → el número → Verificación en dos
   pasos **antes** de reintentar: Meta permite 10 registros por número cada 72 hs y al
   pasarse devuelve 133016 y bloquea el número tres días.
7. Vincular por QR el número de cada sucursal en Configuración → Sucursales (pide el worker vivo).

**Qué falta hoy**: en `.env.local` solo están `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` y `NEXT_PUBLIC_APP_URL`. Faltan cargar
`SUPABASE_SERVICE_ROLE_KEY`, las tres del worker y `WA_CRON_SECRET`. De la Cloud API ya no
falta ninguna variable —eso se carga desde la app—, pero sin la service role no hay ni
credenciales que guardar ni consulta que entre.

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

#### Difundir sin quemar el número

Las difusiones (`/difusiones`) salen **solo por el número madre** y usan el mismo
`app_config.followups_secret`; la URL (`broadcasts_url`) se completó sola al aplicar la
migración a partir de la de seguimientos. Tres cosas que conviene saber antes de la primera:

1. **Se paga.** Fuera de la ventana de 24 hs la única vía es una plantilla aprobada, y Meta
   cobra por mensaje de marketing. Lo que **no** se paga es lo que viene después: el que
   contesta abre la ventana, el chat se deriva a la sucursal y desde ahí se le habla gratis.
   Difundir se paga una vez; vender, no.
2. **El límite es de Meta, no nuestro.** Un número arranca en 250 destinatarios únicos cada
   24 hs (1.000 después de verificar el negocio) y sube por calidad. Por eso el envío va de a
   tandas y hay un tope diario. Si una difusión llega al tope, no falla: sigue al día
   siguiente donde iba.
3. **La baja es la mejor inversión.** Poner un botón "No me interesa" parece perder gente y
   es al revés: cada baja respetada es un bloqueo que no pasó, y los bloqueos son lo que baja
   la calidad y con ella el límite de envío. Los dados de baja quedan fuera de toda difusión
   futura (`contacts.wa_opt_out_at`), sin frenar las conversaciones en curso.

Las plantillas se crean en **Configuración · Plantillas** y se mandan a aprobar a Meta desde
ahí mismo (suele tardar minutos). El estado que se muestra es el que dice Meta, no un tilde
manual: si la rechaza, aparece el motivo textual para saber qué cambiar.

### Instagram: los mensajes directos

La segunda puerta de entrada, y hoy la más fácil de abrir: para la **propia cuenta de la
agencia** Meta no pide verificación del negocio ni App Review — alcanza con que la cuenta
de Instagram sea profesional (empresa o creador) y que tu usuario tenga rol en la app.

Cada DM crea el contacto y el lead igual que un WhatsApp, se deriva a una sucursal con las
mismas reglas y se contesta desde el mismo chat del CRM. La diferencia es lo que pasa
después: la respuesta automática ofrece **pasar a WhatsApp**, que es donde la agencia
vende, y el sistema se encarga de que sea la misma persona de los dos lados.

#### Ponerlo en marcha

1. En [Meta for Developers](https://developers.facebook.com/apps), app de tipo **Business**
   (la misma que usás para WhatsApp sirve). Agregá el producto **Instagram** y entrá a
   **API setup with Instagram login**.
2. Vinculá ahí la cuenta profesional de Instagram de la agencia y generá el **token de
   acceso** (paso *Generate access tokens*). Anotá también el **Instagram App ID** y el
   **Instagram App Secret** de *Business login settings*, y el **App Secret** de
   *Configuración → Básica*.
3. En la app: **Configuración → Instagram**, "Crear el canal", y pegá esos cuatro datos.
   Al guardar, el sistema valida contra Meta y te dice de qué cuenta se trata.
4. La pantalla te muestra la **Callback URL** y el **verify token**. Copialos y pegalos en
   Meta, en *Configure webhooks*, tildando el campo `messages`. Este paso es a mano y una
   sola vez: Instagram —a diferencia de WhatsApp— no deja configurar esa URL por API.
5. Volvé a la app y tocá **Conectar**. El diagnóstico te dice, punto por punto, qué falta.

Para recibir notificaciones, Meta pide además que la app esté **publicada** (modo Live) en
el panel. No hace falta App Review para tu propia cuenta, pero sí ese interruptor.

#### El token vence a los 60 días

No existe el token permanente que tiene WhatsApp. El sistema lo renueva solo con 15 días
de margen, pero hay que programar el cron una vez (SQL editor de Supabase):

```sql
select cron.schedule(
  'ig-token-refresh', '0 4 * * *',
  $$ select net.http_post(
       url     := 'https://TU-APP/api/ig/token/refresh',
       headers := jsonb_build_object('x-cron-secret', 'EL-MISMO-VALOR-DE-WA_CRON_SECRET')
     ) $$
);
```

Mientras tanto, la pantalla avisa cuando quedan menos de 15 días y tiene un botón
**Renovar token** que hace lo mismo a mano.

#### El puente a WhatsApp

- **El cliente salta**: la respuesta automática del DM lleva un link `wa.me` al número de
  la sucursal que lo atiende, con un texto ya escrito que incluye una referencia corta
  (`Ref. IG-…`). Cuando ese WhatsApp entra, el sistema reconoce la referencia y sigue en el
  mismo contacto y el mismo lead — no aparece un duplicado.
- **Nosotros saltamos**: si la persona deja su teléfono (escrito, o con el botón que
  Instagram completa desde su perfil), queda en la ficha. Si activás *"Escribirle primero"*
  en Configuración → Instagram, el sistema le manda un WhatsApp desde el número de la
  sucursal en el acto. Viene apagado a propósito.
- **A mano**: en cualquier chat de Instagram hay un botón verde que abre el WhatsApp de esa
  persona con el saludo cargado.

Fuera de las 24 hs Instagram no deja escribir y no hay plantillas pagas como en WhatsApp:
o la persona vuelve a escribir, o se sigue por WhatsApp. Si Meta te aprueba el feature
*Human Agent*, el interruptor de la pantalla habilita contestar hasta 7 días después.

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
- **/difusiones** — envíos masivos desde el número madre pensados para traer **leads calificados**, no para "mandar mensajes". Se arma en un scroll: a quiénes (presets tipo *clientes que ya viajaron*, *leads perdidos hace 60 días*, *cumpleañeros del mes*, con el contador vivo y los nombres a la vista), qué les decís (plantilla aprobada con botones de respuesta rápida, preview igual a WhatsApp) y cuándo. El resultado se mide en interesados, leads y plata — no en mensajes enviados — y se trabaja desde ahí: cada persona que respondió linkea a su chat o a su lead.
- **/config** — agencia (logo, tema de comprobantes, fees del cotizador y comisión del vendedor), equipo (alta de usuarios con email y contraseña, listo para pasar por WhatsApp), etiquetas, proveedores mayoristas con su % de comisión, plantillas de WhatsApp, cadencia de seguimiento automático (48 h → 7 d → 21 d) y conexión con Meta (asistente de la Cloud API: credenciales, elección del número madre, suscripción del webhook y diagnóstico).

## Automatización

- `POST /api/wa/cloud/webhook/{slug}` — entrantes del número madre: crea contacto → conversación → mensaje → **lead automático** con campaña CTWA, contesta al instante, deriva a la sucursal y avisa a sus operadores. El `slug` es un valor opaco propio de cada agencia (lo genera la base al crear el número madre) y es lo único que identifica al tenant en el GET de verificación de Meta, que no manda nada más. La firma HMAC de cada POST se valida con el **App Secret de esa agencia**, sacado de la base, antes de escribir una sola fila.
- `POST /api/wa/cloud/webhook` — la misma ruta sin slug, viva para lo que ya estaba configurado en Meta desde antes: resuelve la agencia por el `phone_number_id` que viene en el payload.
- `POST /api/wa/baileys/events` — entrantes de los números de sucursal, que le manda el worker firmados con `WA_WEBHOOK_SECRET`.
- `app.enqueue_followups()` (pg_cron, minuto 15) encola el reenganche 48 h / día 7 / día 21 según etapa; `app.dispatch_followups()` (minuto 25) despierta `POST /api/wa/followups/run`, que lo manda **por el número de la sucursal** (sin ventana de 24 hs, sin costo) y solo cae a plantilla paga del número madre si la sucursal no tiene número vinculado.
- `app.dispatch_broadcasts()` (pg_cron **cada 5 minutos**) despierta `POST /api/wa/broadcasts/run`, que manda las difusiones **de a tandas**: `broadcasts.throttle_per_run` por vuelta (60 por defecto) y un tope diario por agencia (`agencies.settings.broadcast_daily_cap`, 250 por defecto). Los frenos no son burocracia: Meta arranca a cada número en 250 destinatarios únicos cada 24 hs y sube el límite por calidad — blastear de golpe baja la calidad y con ella el límite. Usa el mismo secreto que los seguimientos (`WA_CRON_SECRET`) y la URL sale sola de `app_config.followups_url` al aplicar la migración.
- `app.daily_notifications()` (pg_cron diario, 9:00 ART): documentos por vencer, salidas próximas, cumpleaños y seguimientos vencidos.

**Ya no hay edge functions.** `supabase/functions/` (`wa-webhook`, `wa-send`,
`followups-run`) era la etapa anterior, cuando todo el WhatsApp salía por la Cloud API
paga: el cron dejó de llamarlas en `0015_followups_por_sucursal.sql` y la app de Next hace
hoy el webhook, el envío y los seguimientos. Se borraron del repo (quedan en el historial
de git). La 0006 todavía menciona la URL de `followups-run`, pero es una migración vieja
ya aplicada: no se toca, la reemplaza la 0015.

## Arquitectura

- Multi-tenant por `agency_id` con RLS en todas las tablas (admin/vendedor ven su agencia; freelance solo lo suyo). Columnas de privilegio de `members` protegidas por trigger.
- Páginas públicas token-gated vía RPC `quote_public`/`receipt_public` (security definer, solo datos de cara al cliente).
- Convenciones de código en `CONVENTIONS.md` y lenguaje visual en `DESIGN.md`.
- Migraciones en `supabase/migrations/` (aplicadas al proyecto `zgfquryagiuncndjbmhf`). **No hay seed**: la base es la de producción y arranca vacía — no volver a inyectar datos de ejemplo.
