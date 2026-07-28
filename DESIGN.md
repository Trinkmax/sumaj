# viajerOS — Lenguaje visual y microinteracciones v2 (LEER ANTES DE ESCRIBIR UI)

Sumaj significa "lindo, bueno" en quechua. La app tiene que sentirse así:
**cálida, liviana, artesanal y rapidísima**. El usuario es un vendedor de viajes
con el celular en la mano entre mensaje y mensaje de WhatsApp. Cada pantalla
responde en el acto, cada acción da feedback, nada requiere manual.

## Identidad y temas

- **Dos temas**: claro (crema editorial) y oscuro (carbón cálido). El tema vive en
  `<html data-theme="light|dark">` y lo maneja `src/components/shell/theme.tsx`
  (`ThemeScript`, `ThemeToggle`, `useThemePref`). **Ningún componente sabe del tema**:
  usa tokens semánticos y flipea solo.
- Superficies: fondo `bg-cream`, tarjetas `card` (utility: paper + line + radio 2xl + sombra),
  hover de tarjetas clickeables `card-hover`. Capas suaves `bg-sand-soft` / `bg-sand-deep`.
- Tinta `text-ink`, secundario `text-ink-soft`, terciario `text-ink-faint`. Bordes `border-line` / `border-line-strong`.
- Marca terracota: `brand-600` para acciones de marca y estados activos; el negro `ink` es
  el color de los botones primarios (elegancia > estridencia). Tintes que flipean:
  `bg-brand-tint` / `border-brand-tint-line` / `text-brand-text` (nunca `bg-brand-50 text-brand-700` a mano).
- Dinero: `money-700` para botones/acciones; tintes `bg-money-tint text-money-text` para chips/banners.
- Overlays: `bg-overlay` (nunca `bg-ink/40`).
- Titulares con `font-display` (Fraunces). Cuerpo Inter. Los presupuestos públicos usan su
  propio tema (QUOTE_COLORS/QUOTE_FONTS): papelería fina, siempre clara, no depende del tema de la app.

### Regla de oro de color (dark mode)

**PROHIBIDO** usar clases de paleta Tailwind cruda para superficies, texto o bordes de la UI
(`bg-white`, `text-stone-600`, `bg-amber-50`, `text-red-600`, `border-sky-200`, …): rompen el modo oscuro.

- Chips / badges / banners de estado → sistema de **tonos**: `bg-tone-{hue}-soft text-tone-{hue}-text border-tone-{hue}-line`
  con hues: red, orange, amber, yellow, green, emerald, teal, cyan, sky, blue, indigo, violet, fuchsia, pink, rose, stone.
  Los mapas de `domain.ts` (STAGES, FILE_STATUSES, QUOTE_STATUSES, TAG_COLORS) ya los usan: **consumirlos, no duplicar clases**.
- Acción destructiva: `text-tone-red-text hover:bg-tone-red-soft` (dropdown items ya lo hacen con `destructive`).
- Dots/acentos vivos (`bg-sky-500`, `bg-amber-500`, barras del funnel, swatches `TAG_DOTS`) están **permitidos**: los colores 400–600 funcionan en ambos temas.
- `text-white` solo sobre fondos vivos fijos (brand-600, red-600, wa-accent).
- Excepción puntual: existe la variante `dark:` (custom variant sobre `[data-theme="dark"]`) — usarla solo cuando un token no alcanza (ej. una imagen o un brillo).

## Iconografía (NUNCA emojis)

- **Cero emojis en la UI**: iconos `lucide-react`, `strokeWidth` 1.75–2, tamaño 16–20px en línea, 24px en ilustraciones.
  Única excepción: textos que se envían al CLIENTE por WhatsApp (waLink, plantillas) pueden llevar emojis.
- El vocabulario del dominio ya trae su icono: `STAGES[].icon`, `SERVICE_TYPES[t].icon`, `CHANNELS[c].icon`,
  `TRIP_TYPES[t].icon`, `PAYMENT_METHODS[m].icon`, `ACTIVITY_TYPES[a].icon`, `FILE_STATUSES[s].icon`, `QUOTE_STATUSES[s].icon`. Usarlos SIEMPRE (consistencia global).
- `EmptyState` recibe `icon` (LucideIcon), nunca string. Ilustración = icono en círculo `bg-sand-soft` con ring suave.
- Éxitos de venta: `Trophy` / `PartyPopper`; plata: `Banknote`; documentos: `IdCard`.

## Jerarquía y densidad

- Una pantalla = una intención. El CRM muestra el pipeline; los detalles viven en el detalle.
- Números importantes grandes y con `tabular-nums` (o `AnimatedNumber` para KPIs). Plata SIEMPRE con fmtMoney.
- **Presupuestos: el precio por persona es el protagonista** (26–38px); el total del paquete va chico y secundario, tanto en el cotizador como en la hoja del cliente y en la lista. Es el número con el que el vendedor habla.
- Cuando un presupuesto compara opciones (dos hoteles), cada opción es una tarjeta con su precio por persona: la comparación se ve de un vistazo, sin hacer cuentas.
- Comisiones: **solo el admin** ve el desglose. El vendedor ve una sola línea con su comisión estimada. Nunca mostrar plata que no le corresponde ver.
- Contadores de gente (pasajeros): steppers − [n] + con targets de 36–44px, nunca inputs numéricos pelados.
- Listas: filas de 56–64px en mobile, información en 2 líneas máx (título + meta gris).
- Vacíos SIEMPRE con `EmptyState` (icon + título + descripción + acción). Nunca una tabla vacía muda.
- Cargas SIEMPRE con `loading.tsx` de skeletons que replican el layout real.

## Selectores visuales (el estándar del rediseño)

- Opciones pocas y conocidas (tipo de servicio, forma de pago, tipo de viaje, canal, estado)
  → **`ChoiceGrid`** de `ui/misc` (tiles con icono + label, check animado), NO `<Select>`.
- Filtros de vista → `Segmented` (ahora con thumb deslizante).
- `<Select>` queda solo para listas largas/dinámicas (miembros, proveedores, monedas).
- Pickers de color (tags, temas de presupuesto): swatches redondos con ring al elegir (`TAG_DOTS` / `QUOTE_COLORS.swatch`).

## Microinteracciones (el alma del sistema)

- Entradas de contenido: `animate-slide-up` en bloques principales, `animate-fade-in` en secundarios,
  **`stagger-children`** en grillas/listas cortas (≤14 items). Listas largas: animar solo el contenedor.
- Modales/menús ya animan (Dialog/Dropdown/Popover, con salida). No duplicar.
- Botones: `active:scale-[0.98]` ya viene en Button. Estados `loading` en toda action.
- Cards clickeables: utility `card-hover` (borde + sombra + translate-y sutil).
- Optimista: drag del kanban, envío de mensajes, toggles — el estado cambia YA.
- Kanban drag: tarjeta levantada `rotate-2 shadow-xl scale-105`; columna destino `ring-2 ring-brand-300 bg-brand-tint/40`.
- Chat: burbujas nuevas con `animate-msg-in`; ticks con `animate-check-pop`; contadores con `animate-pop`.
- KPIs del inicio: `AnimatedNumber` (cuenta al entrar); progreso con `ProgressRing`.
- Éxitos importantes (lead ganado, cobro): toast claro y cálido, SIN emoji ("¡Lead ganado! Se creó el file F-0012").
- Focus visible siempre. Targets táctiles ≥ 44px. Transiciones 150–300ms, curvas ease-out. NUNCA > 500ms en flujos frecuentes.
- `prefers-reduced-motion` ya se respeta globalmente (globals.css) — no hace falta por-componente.

## CRM = WhatsApp Web (clon literal)

La vista de chats del CRM se ve y se siente como WhatsApp Web, con las herramientas de la
agencia integradas. Tokens dedicados (flipean con el tema): superficies `bg-wa-panel` /
`bg-wa-panel-alt` / `bg-wa-hover` / `bg-wa-active`, texto `text-wa-ink` / `-soft` / `-faint`,
bordes `border-wa-line`, verde `wa-accent`, burbujas `bg-wa-bubble-in` / `bg-wa-bubble-out`
con `text-wa-bubble-ink`, meta `text-wa-bubble-meta`, ticks leídos `text-wa-tick`.
Fondo del hilo: utility **`wa-wallpaper`** (wallpaper oficial claro/oscuro provisto en /public).
Colitas de burbuja: `bubble-tail-in` / `bubble-tail-out`. Dentro de la zona WhatsApp NO se usan
tokens cream/paper: es otro mundo visual, deliberadamente.

## Sucursales y números de WhatsApp

- Un chat siempre dice **por qué número** está saliendo: chip discreto con el nombre
  del número madre o de la sucursal. Es metadata: no compite con el nombre del contacto.
- Vincular un número es la pantalla más importante de Configuración: el **QR es el
  protagonista** (grande, centrado) con tres pasos en criollo al lado. El estado
  (conectado / vinculando / desconectado / error) siempre visible con punto de color
  y el número real en `fmtPhone`.
- Cuando falta infraestructura (worker sin levantar, Cloud API sin conectar) se dice
  con calma y sin dramatizar: qué falta, y que mientras tanto el sistema sigue
  andando con los mensajes registrados.
- Los colores de sucursal salen de `TAG_COLORS` / `TAG_DOTS`: la misma sucursal se
  ve del mismo color en el chat, en el kanban y en Configuración.

## Mobile-first (no negociable)

- Diseñar la vista de 390px PRIMERO, expandir a desktop después.
- Bottom tabs ya existen (64px + safe-area). El contenido de página ya tiene padding-bottom del layout.
- Kanban en mobile: columnas de 85vw con scroll-snap horizontal.
- Modales = bottom sheets automáticos (DialogContent, con asa de arrastre).
- Acciones primarias al alcance del pulgar: botón en PageHeader `actions` (desktop) y FAB si hace falta.

## Copys

Español rioplatense, voseo, directo y cálido. Nada de jerga técnica. Sin emojis (salvo mensajes al cliente).
- "Cargá el primer lead" no "No hay registros".
- Errores: qué pasó + qué hacer. "No se pudo enviar. Revisá tu conexión y probá de nuevo."
- Números es-AR: punto de miles, coma decimal (fmtMoney/fmtNumber).

## Charts (dashboard)

- Recharts. Gridlines `stroke="var(--color-line)"` dasharray 3 3, sin bordes de chart.
- Colores: `var(--color-brand-500)` principal, `var(--color-ink-faint)` comparativas, `var(--color-money-600)` plata.
  NUNCA hex hardcodeado: siempre `var(--…)` para que el tema flipee.
- Tooltips custom estilo card (`bg-paper border-line`). Ejes sin líneas, ticks `fill: var(--color-ink-faint)`.
- Funnel del CRM: barras horizontales con % de conversión entre etapas — protagonista, no decoración.
