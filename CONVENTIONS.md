# Sumaj — Convenciones de arquitectura (LEER ANTES DE ESCRIBIR CÓDIGO)

Sistema de gestión para agencias de viaje. Next.js 16 (App Router, React 19) + Supabase.
Multi-tenant: TODA fila tiene `agency_id`; RLS lo garantiza — nunca filtrar por agency_id "a mano" es obligatorio, pero incluí `agency_id` en cada INSERT.

## Stack y reglas duras

- **Next.js 16**: `params` y `searchParams` son **Promise** en páginas/layouts → `const { id } = await params`.
- **Tailwind CSS v4** (config en `src/app/globals.css` con `@theme`). NO existe tailwind.config.
- **TypeScript estricto**. Tipos de DB en `src/lib/database.types.ts`; helpers `Tables<"leads">`, `Enums<"lead_stage">` en `src/lib/types.ts`.
- Server Components para data fetching; Client Components solo donde hay interacción.
- **Server Actions** en `src/lib/actions/<modulo>.ts` con `"use server"` arriba del archivo. Validar entrada con **zod**. Retornar `ActionResult<T>` de `src/lib/actions/core.ts` — NUNCA lanzar excepciones hacia el cliente.
- Toasts con `sonner` (`toast.success("...")` / `toast.error(...)`). Textos SIEMPRE en español rioplatense (vos), cortos y humanos.
- Iconos: `lucide-react`. Fechas: helpers de `src/lib/format.ts` (NO date-fns directo en UI).
- NO ejecutar `npm run build` ni `npm run dev` (la integración se verifica después). NO tocar archivos fuera de los que te asignaron.

## Supabase

- Server: `import { createClient } from "@/lib/supabase/server"` (async).
- Browser: `import { createClient } from "@/lib/supabase/client"`.
- Público sin sesión (páginas /p/, /r/): `createAnonClient()` de server.ts + RPC `quote_public(token)` / `receipt_public(token)`.
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
- `conversations` (1 por contacto+canal) + `messages`. Trigger de DB ya actualiza `last_message_at`, `last_message_preview`, `unread_count` y cancela followups al recibir mensaje entrante — NO duplicar esa lógica.
- `quotes` + `quote_items`: el cotizador. Ítem: `cost` (Final = lo que se paga), `gross` (Bruto comisionable), `commission_pct` (comisión mayorista). Totales SIEMPRE con `computeQuoteTotals()` de `src/lib/domain.ts` — única fuente de verdad, replica la planilla del cliente. Al guardar, persistir `total_cost`, `total_price`, `commission_total` en la fila.
- `files` + `file_services` (cost/price por servicio) + `payments`. Vista `file_totals` (file_id, total_cost, total_sale, utility, paid_total, balance) — usarla para saldos, no recalcular.
- `payments`: multimoneda. `amount` en la moneda pagada; `amount_in_file_currency` normalizado (si ARS→USD dividir por `exchange_rate`). Los cobros reciben `receipt_code` (R-0001) y `receipt_token` automáticamente (trigger).
- Numeración automática por triggers: files `F-0001`, quotes `P-0001`, recibos `R-0001`. NO setear number/code al insertar.
- `members.commission_pct` = % del vendedor sobre la UTILIDAD del file; se snapshotea en `files.commission_pct`.
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
    waConnected: boolean;    // agency.settings.whatsapp.connected
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
- `Input, Textarea, Label, Select` de `@/components/ui/input`
- `Dialog + DialogContent` (`title`, `description`, `size`: md/lg/xl — en mobile es bottom-sheet automático)
- `Dropdown*` de ui/dropdown · `Popover, Tooltip, Switch, Checkbox, Segmented, Skeleton, EmptyState` de ui/misc
- `Badge` (prop `color` = key de TAG_COLORS para etiquetas) · `Avatar` (prop `name`, genera iniciales+color)
- `PageHeader` de `@/components/shell/page-header` en el tope de CADA página
- Dinero: `fmtMoney(n, "USD")` → "USD 1.386". Fechas: `fmtDate/fmtDateFull/fmtDateLong/fmtRelative/fmtDue`. Teléfono: `fmtPhone`.
- Dominio: `STAGES, STAGE_BY_KEY, CHANNELS, SERVICE_TYPES, SERVICE_ORDER, FILE_STATUSES, QUOTE_STATUSES, PAYMENT_METHODS, TRIP_TYPES, TAG_COLORS, TAG_CATEGORIES, computeQuoteTotals, QUOTE_COLORS, QUOTE_FONTS, quoteColor, quoteFont, fillTemplate, waLink` — todo en `src/lib/domain.ts`.

## Estructura de un módulo

```
src/app/(app)/<modulo>/page.tsx        ← RSC: fetch + render
src/app/(app)/<modulo>/loading.tsx     ← skeleton fiel al layout real
src/app/(app)/<modulo>/[id]/page.tsx   ← detalle (si aplica)
src/components/<modulo>/*.tsx          ← client components del módulo
src/lib/actions/<modulo>.ts            ← server actions
```

Leé DESIGN.md antes de escribir UI. Mobile-first: todo usable con un pulgar.
