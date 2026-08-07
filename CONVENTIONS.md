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
- Iconos: `lucide-react` SIEMPRE — **PROHIBIDO usar emojis en la UI** (solo se permiten en textos que van al cliente por WhatsApp). Fechas: helpers de `src/lib/format.ts` (NO date-fns directo en UI).
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
- `conversations` (1 por contacto + canal + **número**) + `messages`. Trigger de DB ya actualiza `last_message_at`, `last_message_preview`, `unread_count` y cancela followups al recibir mensaje entrante — NO duplicar esa lógica.

## Mensajería: número madre + sucursales (LEER antes de tocar WhatsApp)

La arquitectura que hace que el seguimiento no se pague:

1. **Número madre** (`wa_channels.is_mother`, kind `cloud_api`): por ahí entran TODAS las consultas nuevas. El webhook `POST /api/wa/cloud/webhook/{webhook_slug}` crea contacto + conversación + lead, manda la **respuesta automática** (`auto_reply_text`), **deriva a una sucursal** con `routing_rules` (primera que matchea; fallback `branches.is_default`) y **avisa a los operadores**.
2. **Sucursales** (`branches`, una fila en `wa_channels` kind `baileys` por sucursal): el operador sigue la charla desde el número de la sucursal. Ahí **no hay ventana de 24 hs ni plantillas pagas** — por eso `sendMessage` solo valida la ventana cuando el canal es `cloud_api`.
3. El **worker** (`/worker`, proceso aparte con Baileys) mantiene las sesiones, guarda credenciales en `wa_session_state` (RLS sin policies: solo service role) y publica el QR en `wa_channels.qr`. La app le habla por HTTP (`src/lib/wa/worker.ts`), él le avisa de los entrantes en `POST /api/wa/baileys/events` firmado con HMAC.
4. **Las credenciales de Meta viven en la base, por agencia** (`wa_cloud_credentials`, migración 0018) y las carga el admin desde `/config/whatsapp`. NO son variables de entorno: una env es una sola cuenta de Meta por deploy, y esto es multi-tenant. Los tres secretos (access token, App Secret, verify token) van al **Vault de Supabase** — en la tabla queda solo el uuid, y las funciones que los descifran (`wa_cloud_config`, `wa_cloud_config_by_slug`, `wa_cloud_config_by_phone_number_id`, `wa_cloud_verify_token_matches`) son SECURITY DEFINER con EXECUTE **solo para `service_role`** (la 0019 le sacó el grant a `anon` y `authenticated`, que Supabase concede por default a toda función nueva de `public`). Cada canal madre nace con su fila y su `webhook_slug` por trigger. `WA_CLOUD_TOKEN` / `WA_CLOUD_APP_SECRET` / `WA_CLOUD_VERIFY_TOKEN` sobreviven **solo como fallback de transición** y **solo para la agencia nombrada en `WA_CLOUD_LEGACY_AGENCY_ID`**: sin esa env no se leen nunca. El App Secret es la llave con la que se valida la firma del webhook, así que un secreto compartido entre tenants haría que la firma pruebe conocimiento del secreto y no de qué agencia es el mensaje. No escribas código nuevo que las lea.

Contratos:
- Lógica de entrada compartida por los dos webhooks: `handleInboundMessage()` de `src/lib/wa/inbound.ts` (service role). Alerta a operadores: `alertBranchOperators()` — aviso in-app + WhatsApp al operador desde el número de la sucursal.
- **`src/lib/wa/cloud.ts` es cliente puro del Graph API** (v25.0, override con `WA_GRAPH_VERSION`): no importa Supabase, no sabe de sesiones ni de agencias. Recibe `CloudCreds` ya resueltas y devuelve `GraphResult<T>` / `CloudResult` — **nunca tira excepciones**. Envío (`sendCloudText`, `sendCloudTemplate`), alta (`registerCloudNumber`) y todo lo que consulta o configura Meta (`checkApp`, `debugToken`, `getWaba`, `listPhoneNumbers`, `getPhoneNumber`, `subscribeWaba`, `getWabaSubscription`, `unsubscribeWaba`, `subscribeAppWebhook`). Ahí NO va lógica de negocio ni lecturas de base — si te pinta agregar un `createClient()` en ese archivo, el código va en otro lado.
- **`src/lib/wa/cloud-credentials.ts` es el ÚNICO que resuelve credenciales.** Service role, base primero y envs como fallback acotado (ver arriba). Memoizado con `cache()` de React, que **solo memoiza donde hay render de React** (Server Components y server actions): en los Route Handlers —el webhook y el cron— no hay dispatcher y cada llamada re-ejecuta todo, así que ahí el caller memoiza a mano con un `Map` por agencia. Siempre **por agencia**, nunca una sola vez para todo el lote: es lo que evita que una mande con el token de otra. Entradas: `getCloudCreds(agencyId)`, `getCloudCredsByChannel(channelId)`, `getCloudCredsBySlug(slug)`, `getCloudCredsByPhoneNumberId(pnid)` → `ResolvedCloudCreds | null` (null = no hay token, que cada caller explique lo suyo). Escritura: `setCloudSecret` / `clearCloudSecrets`. **`hasCloudApi(agencyId)` es ASYNC y por agencia** — la versión sincrónica que miraba una env global ya no existe.
- **Los secretos nunca vuelven al navegador.** La pantalla recibe banderas (`hasToken`…), los últimos 4 del token y el diagnóstico. Única excepción: `revealVerifyToken()`, que se pide a propósito y aparte para pegarlo a mano en Meta si la suscripción por API falla.
- Asistente de conexión: `src/lib/actions/wa-cloud.ts`, admin-only y todo `ActionResult<T>` — `getCloudStatus`, `saveCloudCredentials` (valida contra Meta en el momento: app, token, permisos, alcance sobre la WABA), `selectCloudNumber`, `connectCloud` (suscribe el webhook con `override_callback_uri`, que es lo que hace posible el multi-tenant sin tocar la config de la app), `runCloudDiagnostics` (deja la foto en `checks` para pintar la pantalla sin volver a llamar al Graph), `registerMotherNumber` (**movida desde `branches.ts`**), `disconnectCloud`, `revealVerifyToken`.
- **Webhook: la firma se valida ANTES de cualquier escritura.** `/api/wa` es público (Meta no tiene cookie de sesión) y el handler escribe con service role: sin firma, cualquiera que adivine un `phone_number_id` inyecta contactos, leads y mensajes falsos. Con credenciales por agencia el App Secret depende de quién manda, así que hay que parsear el payload para resolver el tenant **antes** de poder verificar — parsear sí, escribir no: hasta que el HMAC no da, no se toca una fila. La ruta con slug resuelve por `getCloudCredsBySlug()` (el GET de verificación de Meta manda solo `hub.mode` / `hub.verify_token` / `hub.challenge`: el tenant tiene que venir en la URL); la vieja sin slug sigue viva y resuelve por `phone_number_id`, con `verifyTokenMatches()` para el handshake.
- Ya no hay edge functions: `supabase/functions/` se borró. El webhook, el envío y los seguimientos los hace la app de Next.
- Alta/vinculación de números de sucursal: `lib/actions/branches.ts` (`linkChannel` → QR, `unlinkChannel`, `syncChannel`, `getChannelState` para el polling). Todo lo del número madre vive en `wa-cloud.ts`.
- `members.branch_id` = sucursal del vendedor (null = ve todas, típico admin). **La asignación de vendedores y la derivación son admin-only.**
- Si falta el worker o la Cloud API, el envío **falla explícito**: `sendMessage`/`sendTemplate` devuelven el motivo (sin teléfono, sucursal no vinculada, worker caído, número madre sin configurar) y no se guarda ninguna fila. Nunca se registra un mensaje como enviado si no salió.
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
  - `files.review_status` (`pendiente` | `revisado`): las ventas que nacen del pipeline (`convertLeadToSale`) entran **pendiente** y un admin las cierra con `markFileReviewed`. Las cargadas a mano nacen revisadas.
  - `file_services.deadline_date` = fecha de caída de la reserva (hasta cuándo hay tiempo de pagarle al proveedor) → chips con `fmtDeadline()`.
  - `file_services.images` (jsonb `{path, name}[]`) = vouchers/comprobantes en el bucket privado `attachments`, path `{agency_id}/files/{file_id}/…` (`ServiceImagesField` / `ServiceImagesStrip`).
- `payments`: multimoneda. `amount` en la moneda pagada; `amount_in_file_currency` normalizado (si ARS→USD dividir por `exchange_rate`). Los cobros reciben `receipt_code` (R-0001) y `receipt_token` automáticamente (trigger). Direcciones: `cobro`, `pago_proveedor`, `pago_comision` (a un `member_id`, `file_id` opcional), `reembolso` — metadata visual en `PAYMENT_DIRECTIONS`.
- Numeración automática por triggers: files `F-0001`, quotes `P-0001`, recibos `R-0001`. NO setear number/code al insertar.
- `members.commission_pct` = % del vendedor sobre la UTILIDAD del file; se snapshotea en `files.commission_pct`. La venta puede tener **comisión plana**: `files.commission_type` (`utilidad_pct` | `monto_fijo`) + `commission_amount` + `commission_label` (ej. "Grupal Europa"). Calcular SIEMPRE con `fileCommission()` de domain.ts.
- Roles: admin (todo), vendedor (ve todo, la UI defaultea "míos"), freelance (RLS lo limita a lo suyo o sin asignar).
- Historial: `logActivity()` de core.ts en cada evento relevante (cambio de etapa, presupuesto enviado, cobro, nota).

## Contratos entre módulos (respetarlos EXACTO)

- Chat de un lead: `ensureConversation(contactId)` (core.ts) → redirect a `/crm?vista=chats&c={conversationId}`.
- Ganar un lead / aceptar presupuesto: `convertLeadToSale({ leadId, quoteId? })` (core.ts) → crea file + servicios + marca cliente. Después: toast éxito + link a `/files/{fileId}`.
- Nuevo presupuesto desde un lead: link a `/presupuestos/nuevo?lead={leadId}`.
- Detalle de lead: `/crm/{leadId}`. Detalle de contacto: `/clientes/{contactId}`. File: `/files/{fileId}`. Presupuesto: `/presupuestos/{quoteId}`. Chat: `/crm?vista=chats&c={conversationId}` (el chat es una subsección del CRM; las rutas `/chats` y `/chats/{id}` quedan como redirects legacy hacia ese destino).
- Página pública de presupuesto: `/p/{public_token}` · recibo: `/r/{public_token}`. Imagen PNG del presupuesto: `/api/public/quote-image/{token}` (og ImageResponse).
- Compartir por WhatsApp (sin Cloud API conectada): `waLink(phone, text)` de domain.ts abre wa.me con el texto + link público.

## Contratos de la operativa embebida (CRM ↔ Chats ↔ Presupuestos)

- `src/components/chats/bubble.tsx` exporta `Bubble({ m }: { m: MessageRow })` — la burbuja memoizada del hilo.
- `src/components/chats/embedded-chat.tsx` exporta:
  ```ts
  export function EmbeddedChat(props: {
    conversationId: string;
    meId: string;            // member.id actual
    waSend: WaSendCapability; // { worker, cloud }: infraestructura VIVA, no la preferencia guardada
    onQuoteRequest?: () => void; // si viene, muestra botón 🧾 para abrir el popup de presupuesto
    className?: string;
  })
  ```
  Client component AUTOCONTENIDO: carga mensajes + conversación + plantillas client-side,
  realtime, optimista, ventana de 24h con TemplatePicker, marca leída. Layout: flex column
  h-full min-h-0 (el padre define la altura), fondo chat-bg.
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
