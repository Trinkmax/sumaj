# Sumaj — Convenciones de arquitectura (LEER ANTES DE ESCRIBIR CÓDIGO)

Sistema de gestión para agencias de viaje. Next.js 16 (App Router, React 19) + Supabase.
Multi-tenant: TODA fila tiene `agency_id`; RLS lo garantiza — nunca filtrar por agency_id "a mano" es obligatorio, pero incluí `agency_id` en cada INSERT.

## Stack y reglas duras

- **Next.js 16**: `params` y `searchParams` son **Promise** en páginas/layouts → `const { id } = await params`.
- **Tailwind CSS v4** (config en `src/app/globals.css` con `@theme`). NO existe tailwind.config.
- **TypeScript estricto**. Tipos de DB en `src/lib/database.types.ts`; helpers `Tables<"leads">`, `Enums<"lead_stage">` en `src/lib/types.ts`.
- Server Components para data fetching; Client Components solo donde hay interacción.
- **Server Actions** en `src/lib/actions/<modulo>.ts` con `"use server"` arriba del archivo. Validar entrada con **zod**. Retornar `ActionResult<T>` de `src/lib/actions/core.ts` — NUNCA lanzar excepciones hacia el cliente.
- Toasts con `sonner` (`toast.success("...")` / `toast.error(...)`). Textos SIEMPRE en español rioplatense (vos), cortos y humanos. SIN emojis.
- Iconos: `lucide-react` SIEMPRE — **PROHIBIDO usar emojis en la UI** (solo se permiten en textos que van al cliente por WhatsApp o Instagram). Fechas: helpers de `src/lib/format.ts` (NO date-fns directo en UI). Excepción: los logos de marca, que lucide sacó en la v1 — `WhatsAppIcon` e `InstagramIcon` de `@/components/ui/brand-icons`, con la misma firma (`className`, `strokeWidth`) para que entren donde entra uno de lucide.
- **Modo oscuro**: la app tiene tema claro/oscuro por tokens (`data-theme` en html, ver DESIGN.md). Nunca clases de paleta cruda (bg-white, text-stone-600, bg-amber-50…) para superficies/texto/bordes — usar tokens (`cream/paper/sand-soft/ink*/line*`, tintes `brand-tint`/`money-tint`, tonos `tone-{hue}-{soft|text|line}`).
- NO ejecutar `npm run build` ni `npm run dev` (la integración se verifica después). NO tocar archivos fuera de los que te asignaron.

## Supabase

- Server: `import { createClient } from "@/lib/supabase/server"` (async).
- Browser: `import { createClient } from "@/lib/supabase/client"`.
- Público sin sesión (páginas /p/, /r/): `createAnonClient()` de server.ts + RPC `quote_public(token)` / `receipt_public(token)`.
- Alta de usuarios del equipo: `createAdminClient()` de `@/lib/supabase/admin` (service role, **solo desde server actions**) si existe `SUPABASE_SERVICE_ROLE_KEY`; si no, cae al camino de invitación. Nunca importarlo desde un client component.
- Auth en páginas: `const { member, agency, isAdmin, isStaff } = await requireMember()` de `@/lib/auth`.
- En actions: `const { supabase, member, agency, isAdmin } = await requireAction()` de `@/lib/actions/core`.
- Realtime: canal por recurso, SIEMPRE limpiar con `supabase.removeChannel(channel)` en el cleanup del useEffect.
- `revalidatePath("/ruta")` después de cada mutación en actions.

## Modelo de datos (resumen operativo)

- `contacts` = persona. `leads` = oportunidad en el pipeline (contact 1—N leads).
- Etapas (`lead_stage`): nuevo → contactado → presupuestado → negociacion → ganado | perdido.
  Metadata visual en `STAGES` de `src/lib/domain.ts`.
- `leads.position` (numeric) ordena dentro de la columna kanban (fractional index: entre 2 tarjetas = promedio).
- `leads.next_action` + `next_action_at` = próximo seguimiento manual del vendedor.
- `conversations` (1 por contacto + canal + **número/cuenta**) + `messages`. Trigger de DB ya actualiza `last_message_at`, `last_message_preview`, `unread_count` y cancela followups al recibir mensaje entrante — NO duplicar esa lógica. `conversations.wa_id` es "el id del interlocutor en ESTE canal": el teléfono en WhatsApp, el IGSID en Instagram. Ídem `messages.wa_message_id`, que guarda el id externo del mensaje (de Meta o del worker) y es la clave de deduplicación de todos los webhooks.

## Mensajería: número madre + sucursales (LEER antes de tocar WhatsApp)

La arquitectura que hace que el seguimiento no se pague:

1. **Número madre** (`wa_channels.is_mother`, kind `cloud_api`): por ahí entran TODAS las consultas nuevas. El webhook `POST /api/wa/cloud/webhook/{webhook_slug}` crea contacto + conversación + lead, manda la **respuesta automática** (`auto_reply_text`), **deriva a una sucursal** con `routing_rules` (primera que matchea; fallback `branches.is_default`) y **avisa a los operadores**.
2. **Sucursales** (`branches`, una fila en `wa_channels` kind `baileys` por sucursal): el operador sigue la charla desde el número de la sucursal. Ahí **no hay ventana de 24 hs ni plantillas pagas** — por eso `sendMessage` solo valida la ventana cuando el canal es `cloud_api`.
3. El **worker** (`/worker`, proceso aparte con Baileys) mantiene las sesiones, guarda credenciales en `wa_session_state` (RLS sin policies: solo service role) y publica el QR en `wa_channels.qr`. La app le habla por HTTP (`src/lib/wa/worker.ts`), él le avisa de los entrantes en `POST /api/wa/baileys/events` firmado con HMAC.
4. **Las credenciales de Meta viven en la base, por agencia** (`wa_cloud_credentials`, migración 0018) y las carga el admin desde `/config/whatsapp`. NO son variables de entorno: una env es una sola cuenta de Meta por deploy, y esto es multi-tenant. Los tres secretos (access token, App Secret, verify token) van al **Vault de Supabase** — en la tabla queda solo el uuid, y las funciones que los descifran (`wa_cloud_config`, `wa_cloud_config_by_slug`, `wa_cloud_config_by_phone_number_id`, `wa_cloud_verify_token_matches`) son SECURITY DEFINER con EXECUTE **solo para `service_role`** (la 0019 le sacó el grant a `anon` y `authenticated`, que Supabase concede por default a toda función nueva de `public`). Cada canal madre nace con su fila y su `webhook_slug` por trigger. `WA_CLOUD_TOKEN` / `WA_CLOUD_APP_SECRET` / `WA_CLOUD_VERIFY_TOKEN` sobreviven **solo como fallback de transición** y **solo para la agencia nombrada en `WA_CLOUD_LEGACY_AGENCY_ID`**: sin esa env no se leen nunca. El App Secret es la llave con la que se valida la firma del webhook, así que un secreto compartido entre tenants haría que la firma pruebe conocimiento del secreto y no de qué agencia es el mensaje. No escribas código nuevo que las lea.

Contratos:
- Lógica de entrada compartida por los dos webhooks: `handleInboundMessage()` de `src/lib/wa/inbound.ts` (service role). Alerta a operadores: `alertBranchOperators()` — aviso in-app + WhatsApp al operador desde el número de la sucursal.
- **`src/lib/wa/cloud.ts` es cliente puro del Graph API** (v25.0, override con `WA_GRAPH_VERSION`): no importa Supabase, no sabe de sesiones ni de agencias. Recibe `CloudCreds` ya resueltas y devuelve `GraphResult<T>` / `CloudResult` — **nunca tira excepciones**. Envío (`sendCloudText`, `sendCloudMedia`, `sendCloudTemplateMessage` — **la única forma de mandar una plantilla**: siempre con el `language` de la fila y los `bodyParams` con nombre; el viejo `sendCloudTemplate(creds, to, name)` se borró porque asumía `es_AR` y no mandaba parámetros, así que fallaba con 132001/132000 en todo lo que no fuera una plantilla en español y sin variables), alta (`registerCloudNumber`) y todo lo que consulta o configura Meta (`checkApp`, `debugToken`, `getWaba`, `listPhoneNumbers`, `getPhoneNumber`, `subscribeWaba`, `getWabaSubscription`, `unsubscribeWaba`, `subscribeAppWebhook`). Ahí NO va lógica de negocio ni lecturas de base — si te pinta agregar un `createClient()` en ese archivo, el código va en otro lado.
- **`src/lib/wa/cloud-credentials.ts` es el ÚNICO que resuelve credenciales.** Service role, base primero y envs como fallback acotado (ver arriba). Memoizado con `cache()` de React, que **solo memoiza donde hay render de React** (Server Components y server actions): en los Route Handlers —el webhook y el cron— no hay dispatcher y cada llamada re-ejecuta todo, así que ahí el caller memoiza a mano con un `Map` por agencia. Siempre **por agencia**, nunca una sola vez para todo el lote: es lo que evita que una mande con el token de otra. Entradas: `getCloudCreds(agencyId)`, `getCloudCredsByChannel(channelId)`, `getCloudCredsBySlug(slug)`, `getCloudCredsByPhoneNumberId(pnid)` → `ResolvedCloudCreds | null` (null = no hay token, que cada caller explique lo suyo). Escritura: `setCloudSecret` / `clearCloudSecrets`. **`hasCloudApi(agencyId)` es ASYNC y por agencia** — la versión sincrónica que miraba una env global ya no existe.
- **Los secretos nunca vuelven al navegador.** La pantalla recibe banderas (`hasToken`…), los últimos 4 del token y el diagnóstico. Única excepción: `revealVerifyToken()`, que se pide a propósito y aparte para pegarlo a mano en Meta si la suscripción por API falla.
- Asistente de conexión: `src/lib/actions/wa-cloud.ts`, admin-only y todo `ActionResult<T>` — `getCloudStatus`, `saveCloudCredentials` (valida contra Meta en el momento: app, token, permisos, alcance sobre la WABA), `selectCloudNumber`, `connectCloud` (suscribe el webhook con `override_callback_uri`, que es lo que hace posible el multi-tenant sin tocar la config de la app), `runCloudDiagnostics` (deja la foto en `checks` para pintar la pantalla sin volver a llamar al Graph), `registerMotherNumber` (**movida desde `branches.ts`**), `disconnectCloud`, `revealVerifyToken`.
- **Webhook: la firma se valida ANTES de cualquier escritura.** `/api/wa` es público (Meta no tiene cookie de sesión) y el handler escribe con service role: sin firma, cualquiera que adivine un `phone_number_id` inyecta contactos, leads y mensajes falsos. Con credenciales por agencia el App Secret depende de quién manda, así que hay que parsear el payload para resolver el tenant **antes** de poder verificar — parsear sí, escribir no: hasta que el HMAC no da, no se toca una fila. La ruta con slug resuelve por `getCloudCredsBySlug()` (el GET de verificación de Meta manda solo `hub.mode` / `hub.verify_token` / `hub.challenge`: el tenant tiene que venir en la URL); la vieja sin slug sigue viva y resuelve por `phone_number_id`, con `verifyTokenMatches()` para el handshake.
- Ya no hay edge functions: `supabase/functions/` se borró. El webhook, el envío y los seguimientos los hace la app de Next.
- Alta/vinculación de números de sucursal: `lib/actions/branches.ts` (`linkChannel` → QR, `unlinkChannel`, `syncChannel`, `getChannelState` para el polling). Todo lo del número madre vive en `wa-cloud.ts`.
- `members.branch_id` = sucursal del vendedor (null = ve todas, típico admin). **La asignación de vendedores y la derivación son admin-only.**
- Si falta el worker, la Cloud API o Instagram, el envío **falla explícito**: `sendMessage`/`sendTemplate` devuelven el motivo (sin teléfono, sucursal no vinculada, worker caído, número madre sin configurar, cuenta de Instagram sin conectar) y no se guarda ninguna fila. Nunca se registra un mensaje como enviado si no salió.

## Instagram Direct (LEER antes de tocar el canal)

La segunda puerta de entrada. Todo lo que sigue es distinto de WhatsApp por
motivos de la API de Meta, no por gusto.

1. **El canal vive en `wa_channels`, con `kind = 'instagram'`** (branch_id null, is_mother false, un solo canal por agencia). `conversations.channel_id` ya apunta a esa tabla, así que el hilo de Instagram hereda gratis el chip de "por dónde entra", la respuesta automática, el estado y el filtro de la bandeja. `wa_channels` dejó de ser "los números de WhatsApp" y pasó a ser "los canales de mensajería"; el nombre quedó por compatibilidad.
2. **La persona es un IGSID, no un teléfono.** `contacts.ig_id` (único por agencia) es la identidad; `contacts.instagram` es el @usuario, que sirve para reconocerlo pero cambia. En el hilo, `conversations.wa_id` guarda el IGSID: es "el id del interlocutor en este canal". **El envío usa `wa_id`, nunca `contacts.phone`** — después del puente el contacto SÍ tiene teléfono, y mandarle el DM a un número lo rechaza Meta sin explicar.
3. **La callback URL del webhook se pega A MANO en el panel de Meta.** Instagram no acepta `override_callback_uri` (eso es exclusivo de WhatsApp) y la documentación dice explícito "Account level webhooks customization is not supported". Por eso `connectInstagram()` solo suscribe la cuenta a los campos, y por eso el verify token acá **se muestra** en vez de esconderse: sin él el admin no puede terminar. No escribas código que intente configurar la URL por API. Y como la URL es una sola por app, el modelo es **una app de Meta por agencia** (ver el webhook, más abajo).
4. **El token vence a los 60 días.** No existe el permanente del usuario del sistema de WhatsApp. Lo renueva `POST /api/ig/token/refresh` (mismo `WA_CRON_SECRET`) con 15 días de margen, más el botón "Renovar token" de la pantalla. Si esto se rompe, la agencia deja de recibir DMs un martes cualquiera sin que nada más falle.
5. **Se guardan DOS App Secrets** (`app_secret` y `ig_app_secret`) y la firma del webhook se valida contra los dos. Meta no documenta cuál firma en el flujo de Instagram Login, y elegir mal no da un error entendible: da un webhook que rechaza todo. El porqué largo está en la migración 0025.
6. **Fuera de las 24 hs no hay plantillas pagas**: la única vía es el tag `HUMAN_AGENT` (7 días), que Meta aprueba en App Review. Por eso es un interruptor (`ig_accounts.human_agent_enabled`) apagado por default; con él apagado el chat dice la verdad y ofrece pasar a WhatsApp.
7. **Para la propia cuenta de la agencia alcanza el acceso estándar**: sin App Review y sin verificación del negocio. Es la diferencia práctica más grande con WhatsApp.

Contratos:
- Entrada: `handleIgInbound()` de `src/lib/ig/inbound.ts` (service role). NO es `handleInboundMessage` —la identidad, la API de envío y el puente son otros— pero **comparte lo que tiene que compartir**: `routeToBranch()` y `alertBranchOperators()` de `lib/wa/inbound`. Las reglas de derivación son del negocio, no del canal.
- **`src/lib/ig/graph.ts` es cliente puro** (v25.0, override con `IG_GRAPH_VERSION`): no importa Supabase, recibe `IgCreds` ya resueltas, devuelve `GraphResult<T>` / `IgSendResult` y **nunca tira excepciones**. `sendIgText` (con quick replies y tag de agente humano), `markIgSeenAndTyping`, `getIgAccount`, `getIgUserProfile`, `subscribeIgWebhook`, `getIgSubscription`, `unsubscribeIgWebhook`, `exchangeIgLongLived`, `refreshIgToken`.
- **`src/lib/ig/credentials.ts` es el ÚNICO que resuelve credenciales.** Service role, Vault, memoizado con `cache()` (mismas advertencias que WhatsApp en los Route Handlers). Sin fallback por entorno: Instagram nació con las credenciales en la base. Entradas: `getIgCreds(agencyId)`, `getIgCredsByChannel`, `getIgCredsBySlug`, `getIgCredsByAccountId` → `ResolvedIgCreds | null` (trae también la config del puente). `hasInstagram(agencyId)` es async.
- Webhook: `src/lib/ig/webhook.ts`, mismo orden de validación que el de WhatsApp (body crudo → resolver tenant por el slug de la URL → firma → recién ahí escribir). **Una sola ruta: `/api/ig/webhook/{slug}`, o sea una app de Meta por agencia.** No repongas una ruta sin slug que resuelva el tenant por `entry[].id`: si dos agencias comparten la app también comparten el App Secret, y ahí la firma prueba que quien mandó el pedido conoce el secreto, no de qué agencia es el mensaje.
- Asistente: `src/lib/actions/instagram.ts`, admin-only y todo `ActionResult<T>` — `getInstagramStatus`, `createInstagramChannel`, `saveInstagramCredentials` (valida contra Meta ANTES de escribir el Vault), `connectInstagram`, `runInstagramDiagnostics`, `refreshInstagramToken`, `updateInstagramBridge`, `revealIgVerifyToken`, `disconnectInstagram`.

### El puente a WhatsApp (es la razón de tener Instagram adentro)

Instagram trae la consulta; WhatsApp cierra la venta. `src/lib/ig/bridge.ts` es lo
que hace que la persona no se pierda en el cruce, en los dos sentidos:

- **Cliente → nosotros**: la respuesta automática lleva un link `wa.me` con un texto prellenado que incluye una **referencia corta** (`ig_bridge_links.code`, `Ref. IG-3F7A9C21`). Cuando ese WhatsApp entra, `handleInboundMessage` la reconoce (`findBridgeCode` → `redeemBridgeLink`) y sigue en el MISMO contacto y el MISMO lead, en vez de crear un duplicado. El canje es de un solo uso y atómico (`used_at is null` en el propio UPDATE). Sin referencia todo funciona como antes: degradar, nunca romper.
- **Nosotros → cliente**: si deja su teléfono en el DM —escrito, o compartido con el quick reply que Instagram completa desde su perfil— se guarda en la ficha y, si `auto_wa_enabled` está prendido, el sistema le escribe primero por WhatsApp desde el número de la sucursal. Viene **apagado** a propósito. El teléfono se normaliza con `toE164()` de `lib/ig/phone.ts`, que es deliberadamente conservador: ante la duda devuelve `null`, porque del otro lado hay un mensaje a un desconocido.
- A mano, desde el chat: `bridgeToWhatsapp()` / `getWhatsappBridgeDraft()` de `lib/actions/messages.ts` (el botón verde del hilo de Instagram).
- Como máximo sale **un** mensaje de Instagram por evento entrante. Contestar dos veces seguidas es lo que hace que un negocio parezca un bot.
- `quotes` + `quote_items`: el cotizador. Ítem: `gross` (Bruto comisionable = **lo que se carga a mano**), `cost` (Final = lo que se paga = bruto + fee del grupo), `commission_pct` (comisión mayorista, sale sola del proveedor). Totales SIEMPRE con `computeQuoteTotals()` de `src/lib/domain.ts` — única fuente de verdad. Al guardar, persistir `total_cost`, `total_price`, `commission_total`.
  - **Pasajeros desglosados**: `pax_adults` / `pax_children` / `pax_infants` + `children_ages` (jsonb). `pax` = total (lo mantiene la app). El infante paga el **30%** (`INFANT_FACTOR`): `paxUnits()` da las "unidades de precio" y el precio por persona sale de ahí.
  - **Opciones comparables** (`quote_options`): dos hoteles en un mismo presupuesto. `quote_items.option_id` nulo = servicio común a todas las opciones. Totales por opción con `computeOptionTotals(comunes, opciones, calc)`; cada `quote_options` guarda `total_cost/total_price/per_person`. `quotes.accepted_option_id` = la opción vigente (con la que se vende).
  - **Fees automáticos**: `finalFromGross(gross, type, fees)` con `agencies.settings.quote_fees` (`aereo_pct` 2, `terrestre_pct` 4). El usuario puede pisar el Final a mano.
  - **Comisión**: la ve **solo el admin** (`isAdmin`). El vendedor ve un estimado = `sellerMarkupCommission(markup, settings.quote_seller_commission_pct)` (30% por defecto).
  - Al vender: `selectQuoteSale(quote, items, options)` de `actions/core.ts` devuelve los ítems (comunes + los de la opción elegida) y el precio de esa opción.
- `files` + `file_services` + `payments`. Vista `file_totals` (file_id, total_cost, total_sale, utility, paid_total, balance, services_sale, markup, discount, supplier_commission, gross_profit) — usarla para saldos, no recalcular.
  - **La agencia gana tres platas distintas en un file y van SEPARADAS** (migración 0020):
    `file_services.gross` + `commission_pct` = comisión que devuelve el mayorista (no está en precio − costo);
    `files.markup` / `files.discount` = sobreprecio y descuento del paquete, **a nivel file**;
    `file_services.price` = precio real del servicio (por defecto = `cost`).
    El markup **NO se prorratea** entre los servicios: si se reparte, ningún precio del file coincide
    con lo que cuesta cada cosa y la venta deja de ser auditable. Al convertir un presupuesto usar
    `quotePackageMarkup()` + `buildFileServices()` de `actions/core.ts`.
  - Números del file SIEMPRE con `computeFileProfit()` de domain.ts (única fuente de verdad; la vista
    da lo mismo). `utility` = venta − costo → **lo que ve el vendedor y base de su comisión**.
    `netProfit` = comisión mayorista + markup − comisión del vendedor → **lo que ven los socios**.
    Para pantallas que agregan muchos files sin traer los servicios: `fileNetProfit(totals, file)`.
  - `ProfitCard` (tarjeta "Rentabilidad" del file) es **admin-only**, igual que el desglose del cotizador.
  - `round2()` redondea medio-para-arriba sobre el DECIMAL (no sobre el binario) para dar igual que
    `round(numeric, 2)` de Postgres: hay plata que se calcula en los dos motores (la comisión del
    mayorista, en `computeFileProfit` y en la vista) y un centavo de diferencia se ve en pantalla.
  - `fileCommission()` nunca devuelve negativo: si la venta pierde plata el vendedor no cobra, pero
    tampoco se le descuenta de lo que ganó en otros files al liquidar el mes.
  - **Las columnas de plata del file las protege un trigger** (`app.protect_file_money`, migración 0021),
    no solo el `isAdmin` de la action: markup, descuento, esquema de comisión y `seller_id` quedan
    congelados en el UPDATE para el que no es admin, y el INSERT solo acepta lo que escriben las
    actions (comisión = la de la ficha del vendedor, markup solo si viene de un presupuesto).
    Por eso la conversión pone el markup **en el INSERT** y no en un UPDATE posterior.
  - `files.review_status` (`pendiente` | `revisado`): las ventas que nacen del pipeline (`convertLeadToSale`) entran **pendiente** y un admin las cierra con `markFileReviewed`. Las cargadas a mano nacen revisadas.
  - `file_services.deadline_date` = fecha de caída de la reserva (hasta cuándo hay tiempo de pagarle al proveedor) → chips con `fmtDeadline()`.
  - `file_services.images` (jsonb `{path, name}[]`) = vouchers/comprobantes en el bucket privado `attachments`, path `{agency_id}/files/{file_id}/…` (`ServiceImagesField` / `ServiceImagesStrip`).
- `payments`: multimoneda. `amount` en la moneda pagada; `amount_in_file_currency` normalizado (si ARS→USD dividir por `exchange_rate`). Los cobros reciben `receipt_code` (R-0001) y `receipt_token` automáticamente (trigger). Direcciones: `cobro`, `pago_proveedor`, `pago_comision` (a un `member_id`, `file_id` opcional), `reembolso` — metadata visual en `PAYMENT_DIRECTIONS`.
- Numeración automática por triggers: files `F-0001`, quotes `P-0001`, recibos `R-0001`. NO setear number/code al insertar.
- `members.commission_pct` = % del vendedor sobre la UTILIDAD del file; se snapshotea en `files.commission_pct`. La venta puede tener **comisión plana**: `files.commission_type` (`utilidad_pct` | `monto_fijo`) + `commission_amount` + `commission_label` (ej. "Grupal Europa"). Calcular SIEMPRE con `fileCommission()` de domain.ts.
- Roles: admin (todo), vendedor (ve todo, la UI defaultea "míos"), freelance (RLS lo limita a lo suyo o sin asignar).
- Historial: `logActivity()` de core.ts en cada evento relevante (cambio de etapa, presupuesto enviado, cobro, nota).

## Difusiones (LEER antes de tocar `broadcasts`, `wa_templates` o el despachador)

La primera vez que el sistema **arranca** la conversación en vez de contestarla. Y la primera vez
que se puede quemar el número madre, así que casi todo lo que sigue es un freno a propósito.

1. **Solo por el número madre** (`cloud_api`). Fuera de la ventana de 24 hs, WhatsApp exige una
   plantilla aprobada y las plantillas solo existen en la Cloud API. Un número de sucursal (Baileys)
   mandaría lo mismo gratis, pero difundir desde un número no oficial es la forma más rápida de
   perderlo — y con él se va el historial de la sucursal entera. **No escribas código que difunda
   por Baileys.** Lo que sí es gratis es el SEGUIMIENTO: el que contesta abre la ventana, se deriva
   a la sucursal y desde ahí se le habla sin costo. Difundir se paga una vez; vender, no.
2. **El lead calificado es el botón.** `wa_templates.buttons` es `[{type, text, url?, intent?}]` y
   cada respuesta rápida declara su `intent` (`interesado` | `tal_vez` | `baja`). El toque abre la
   ventana, crea o revive el lead con la intención puesta por el CLIENTE (no por el vendedor) y lo
   deriva. `baja` marca `contacts.wa_opt_out_at`, no alerta a nadie y no crea lead: una baja
   respetada sube la calidad del número, que es lo que sube el límite de envío.
   **El orden del array ES el índice de Meta**, al enviar y al recibir el toque.
3. **Todo se congela.** `broadcasts` guarda `body_snapshot` / `buttons_snapshot` /
   `template_name_snapshot`, y `broadcast_recipients` guarda `phone` y `vars`. Una plantilla se
   edita, Meta la pausa, el cliente cambia de número: el resultado de una difusión que ya salió
   tiene que seguir diciendo la verdad seis meses después.
4. **Las plantillas ahora las manda Meta, no el admin.** `wa_templates.meta_status` es la verdad
   (`local` = nunca viajó a Meta). `is_approved` **la escribe un trigger** (`app.sync_template_approved`)
   y sigue existiendo solo porque `app.enqueue_followups` la usa: no la seteés a mano salvo en las
   plantillas `local`. El índice único `(agency_id, meta_name)` evita que el envío elija mal.
   **NUNCA filtres por `is_approved` para decidir si una plantilla se puede mandar por la Cloud
   API.** El trigger deja esa columna intacta cuando `meta_status = 'local'`, así que una plantilla
   que jamás viajó a Meta conserva el tilde manual y parece aprobada; el chat filtraba por ahí y
   ofrecía cuatro plantillas que Meta contestaba con *"template name does not exist"*. El único
   predicado válido es **`motivoPlantillaNoEnviable()` de `lib/domain.ts`** (mira `meta_status` y
   descarta `hello_world`, la de ejemplo de Meta, que solo sale desde sus números de prueba —
   error 131058). Lo comparten la pantalla y la action a propósito: si cada una decidiera por su
   lado, el vendedor vería en la lista algo que el servidor rechaza. `is_approved` significa hoy
   una sola cosa: **"usala en el seguimiento automático por el número de la sucursal"**, donde una
   plantilla es texto libre y no hay nada que Meta tenga que aprobar.
5. **A quién le llega lo decide SQL, no TypeScript.** `public.broadcast_audience(agency, filtros)`
   es SECURITY INVOKER (la RLS sigue mandando) y ya excluye: sin teléfono, dados de baja, los que
   recibieron una difusión hace menos de `no_broadcast_days` (7 por defecto) y —salvo
   `skip_active:false`— los que están en `presupuestado`/`negociacion`. No repitas esos filtros en
   el servidor de Next: el contador de la pantalla dejaría de coincidir con lo que sale.
   Si agregás una clave al filtro, va en el SQL **y** en `BroadcastAudience` de `lib/types.ts`.
6. **El envío es reanudable y no duplica.** Las filas de `broadcast_recipients` se crean al ARMAR
   (no al enviar), con `unique (broadcast_id, contact_id)`. El despachador
   (`/api/wa/broadcasts/run`, cron cada 5 min) toma `throttle_per_run` pendientes por vuelta y
   respeta el tope diario por agencia (`agencies.settings.broadcast_daily_cap`, 250 por defecto: es
   el tier inicial de Meta). Llegar al tope **no es un error** — es el sistema cuidando el número.
   Igual que el runner de seguimientos, las credenciales se memoizan en un `Map` **por agencia**.
7. **Atribuir una respuesta, en este orden**: `context.id` contra
   `broadcast_recipients.wa_message_id` (lo manda Meta cuando tocan un botón, es la prueba dura) →
   el payload `vjos:<recipientId>:<index>` → la última difusión que recibió ese contacto hace ≤72 hs
   (para el que contesta escribiendo). Si nada matchea, el mensaje entra como siempre: **degradar,
   nunca romper**.
8. Los contadores salen de la vista `broadcast_totals`, no de columnas contadoras: el estado de un
   destinatario cambia por tres caminos distintos (despachador, webhook de entrega, webhook de
   respuesta) y tres escritores sobre un contador es una desincronización esperando pasar. Mismo
   criterio que `file_totals`.

Contratos:
- Cliente puro del Graph para plantillas: `src/lib/wa/templates.ts` (mismas reglas que `wa/cloud.ts`
  — no importa Supabase, recibe `CloudCreds`, devuelve `GraphResult`, nunca tira). Actions:
  `src/lib/actions/templates.ts` (`submitTemplateToMeta`, `syncTemplatesFromMeta`).
- Audiencia: `src/lib/broadcasts/audience.ts` (tipos + `AUDIENCE_PRESETS` + `describeAudience`, sin
  `"use server"`: lo comparten cliente y servidor). Actions: `src/lib/actions/broadcasts.ts`.
- Atribución: `src/lib/wa/broadcast-reply.ts` (`attributeReply`, `recordBroadcastReply`,
  `looksLikeOptOut` — conservador: ante la duda NO es una baja).
- Meta pide las variables con nombre declaradas al crear (`example.body_text_named_params`) y
  enviadas con `parameter_name`. Encaja con `fillTemplate` y el `{{nombre}}` que ya usa el repo.
  Una variable sin valor hace que Meta rechace el mensaje entero: `launchBroadcast` las completa
  todas al materializar.

## Contratos entre módulos (respetarlos EXACTO)

- Chat de un lead: `ensureConversation(contactId)` (core.ts) → redirect a `/crm?vista=chats&c={conversationId}`.
- Ganar un lead / aceptar presupuesto: `convertLeadToSale({ leadId, quoteId? })` (core.ts) → crea file + servicios + marca cliente. Después: toast éxito + link a `/files/{fileId}`.
- Nuevo presupuesto desde un lead: link a `/presupuestos/nuevo?lead={leadId}`.
- Detalle de lead: `/crm/{leadId}`. Detalle de contacto: `/clientes/{contactId}`. File: `/files/{fileId}`. Presupuesto: `/presupuestos/{quoteId}`. Chat: `/crm?vista=chats&c={conversationId}` (el chat es una subsección del CRM; las rutas `/chats` y `/chats/{id}` quedan como redirects legacy hacia ese destino).
- Difusiones: lista `/difusiones` · armar `/difusiones/nueva` · resultado `/difusiones/{id}`. Desde el resultado se salta al chat (`/crm?vista=chats&c={conversationId}`) o al lead (`/crm/{leadId}`) de cada persona que respondió: la difusión se trabaja desde ahí, no hay que ir a buscarla al CRM.
- Página pública de presupuesto: `/p/{public_token}` · recibo: `/r/{public_token}`. Imagen PNG del presupuesto: `/api/public/quote-image/{token}` (og ImageResponse).
- Compartir por WhatsApp (sin Cloud API conectada): `waLink(phone, text)` de domain.ts abre wa.me con el texto + link público.

## Contratos de la operativa embebida (CRM ↔ Chats ↔ Presupuestos)

- `src/components/chats/bubble.tsx` exporta `Bubble({ m }: { m: MessageRow })` — la burbuja memoizada del hilo.
- `src/components/chats/embedded-chat.tsx` exporta:
  ```ts
  export function EmbeddedChat(props: {
    conversationId: string;
    meId: string;            // member.id actual
    waSend: WaSendCapability; // { worker, cloud, instagram }: infraestructura VIVA,
                              // no la preferencia guardada
    onQuoteRequest?: () => void;  // si viene, muestra botón 🧾 para abrir el popup de presupuesto
    onBridgeRequest?: () => void; // si viene, en los chats de Instagram muestra el pase a WhatsApp
    className?: string;
  })
  ```
  Client component AUTOCONTENIDO: carga mensajes + conversación + plantillas client-side,
  realtime, optimista, ventana de 24h con TemplatePicker, marca leída. Layout: flex column
  h-full min-h-0 (el padre define la altura), fondo chat-bg.
  **Es consciente del canal**: en Instagram el destinatario es el IGSID, fuera de la
  ventana no ofrece plantillas (no existen) sino el pase a WhatsApp, y el motivo por
  el que no se puede enviar es otro.
- `src/components/quotes/quote-dialog.tsx` exporta:
  ```ts
  export function QuoteDialog(props: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    leadId?: string | null;
    contactId?: string | null;
    conversationId?: string | null; // si viene: al "Guardar y enviar" manda el link público
                                    // como mensaje a esa conversación (sendMessage); si falla
                                    // por ventana de 24h → copia el link y avisa con toast
    onDone?: () => void;            // para refrescar al caller después de guardar
  })
  ```
  Carga sus datos con la action `getQuoteBuilderData({ leadId?, contactId? })` de
  `lib/actions/quotes.ts` y renderiza QuoteBuilder en modo dialog.
- `lib/actions/leads.ts` exporta `getLeadConversationId({ contactId }): Promise<ActionResult<{ conversationId: string }>>`
  (wrapper de ensureConversation de core, SIN redirect).
- `src/components/shell/command-palette.tsx` exporta `CommandPalette()` (automontada en el layout,
  escucha cmd+K y el CustomEvent "viajeros:open-search") y `openCommandPalette()` (dispara ese evento).
  Búsqueda global via `globalSearch({ q })` de `lib/actions/search.ts`.
- Branding: el SISTEMA es "viajerOS" (login/registro/onboarding, títulos, "hecho con viajerOS");
  el shell y los comprobantes muestran la marca de la AGENCIA (agencies.logo_url con fallback al nombre).
- Tarjeta del kanban: `BoardLead.conversation: { id, last_message_preview, last_message_at, last_inbound_at, unread_count } | null`.

## Patrón de server action (copiar tal cual)

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAction, succeed, fail, logActivity, type ActionResult } from "@/lib/actions/core";

const schema = z.object({ leadId: z.string().uuid(), stage: z.enum([...]) });

export async function moveLead(input: z.infer<typeof schema>): Promise<ActionResult<null>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail("Datos inválidos.");
  const { supabase, member, agency } = await requireAction();

  const { error } = await supabase.from("leads").update({ ... }).eq("id", parsed.data.leadId);
  if (error) return fail("No se pudo mover el lead.");

  revalidatePath("/crm");
  return succeed(null);
}
```

En el cliente: `const res = await moveLead(...); if (!res.ok) { toast.error(res.error); /* revertir optimista */ }`.

## Optimistic UI (obligatorio en interacciones frecuentes)

Kanban drag, enviar mensaje, marcar leído, tildar checkbox: actualizar el estado local
INMEDIATAMENTE, disparar la action, revertir + toast.error si falla. El vendedor nunca espera.

## UI compartida (usar SIEMPRE estos, no inventar duplicados)

- `Button` (variants: primary | brand | secondary | ghost | danger | success | whatsapp; prop `loading`)
- `Input, Textarea, Label, Select` de `@/components/ui/input` (Select solo para listas largas/dinámicas)
- `Dialog + DialogContent` (`title`, `description`, `size`: md/lg/xl — en mobile es bottom-sheet automático con asa)
- `Dropdown*` de ui/dropdown · de ui/misc: `Popover, Tooltip, Switch, Checkbox, Segmented, Skeleton`,
  `EmptyState` (**prop `icon: LucideIcon`**, ya no `emoji`), `ChoiceGrid` (selector visual de opciones con icono — usarlo para tipo de servicio/pago/viaje/canal), `AnimatedNumber` (KPIs que cuentan), `ProgressRing`.
- Tema: `ThemeToggle / ThemeToggleCompact / useThemePref` de `@/components/shell/theme` (ya montado en shell; no reimplementar).
- `Badge` (prop `color` = key de TAG_COLORS para etiquetas) · `Avatar` (prop `name`, genera iniciales+color)
- `PageHeader` de `@/components/shell/page-header` en el tope de CADA página
- Asistentes de conexión con Meta: `Step, SecretField, IdField, CheckRow, CopyRow, Crumb, copyToClipboard` de `@/components/config/wizard-bits` — los comparten Configuración → WhatsApp e Instagram y tienen que verse igual.
- Logos de marca: `WhatsAppIcon`, `InstagramIcon` de `@/components/ui/brand-icons` (lucide no los trae).
- Dinero: `fmtMoney(n, "USD")` → "USD 1.386". Fechas: `fmtDate/fmtDateFull/fmtDateLong/fmtRelative/fmtDue`. Teléfono: `fmtPhone`.
- Dominio: `STAGES, STAGE_BY_KEY, CHANNELS, SERVICE_TYPES, SERVICE_ORDER, FILE_STATUSES, QUOTE_STATUSES, PAYMENT_METHODS, PAYMENT_DIRECTIONS, COMMISSION_TYPES, TRIP_TYPES, TAG_COLORS, TAG_DOTS, TAG_CATEGORIES, computeQuoteTotals, computeOptionTotals, paxCount, paxUnits, paxLabel, PAX_KINDS, INFANT_FACTOR, feePct, finalFromGross, DEFAULT_QUOTE_FEES, sellerMarkupCommission, fileCommission, computeFileProfit, fileNetProfit, serviceSupplierCommission, QUOTE_COLORS, QUOTE_FONTS, quoteColor, quoteFont, fillTemplate, waLink` — todo en `src/lib/domain.ts`.
  **Shapes v2 (con icono lucide, sin emoji)**: `STAGES[].icon` · `CHANNELS[c] = {label, short, icon}` · `TRIP_TYPES[t] = {label, icon}` · `SERVICE_TYPES[t] = {label, plural, icon}` (ya NO existe `.emoji`) · `PAYMENT_METHODS[m] = {label, icon}` · `ACTIVITY_TYPES[a] = {label, icon}` · `FILE_STATUSES[s] / QUOTE_STATUSES[s] = {label, chip, icon}`.
- Personas relacionadas: `travelers.linked_contact_id` (nullable → ficha propia del pasajero). Grupo de un contacto = `travelers where contact_id = X`; "viaja con" inverso = `travelers where linked_contact_id = X` → dueño. Promover pasajero a contacto: action en `lib/actions/contacts.ts`.

## Estructura de un módulo

```
src/app/(app)/<modulo>/page.tsx        ← RSC: fetch + render
src/app/(app)/<modulo>/loading.tsx     ← skeleton fiel al layout real
src/app/(app)/<modulo>/[id]/page.tsx   ← detalle (si aplica)
src/components/<modulo>/*.tsx          ← client components del módulo
src/lib/actions/<modulo>.ts            ← server actions
```

Leé DESIGN.md antes de escribir UI. Mobile-first: todo usable con un pulgar.
