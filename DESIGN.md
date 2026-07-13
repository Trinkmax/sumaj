# Sumaj — Lenguaje visual y microinteracciones (LEER ANTES DE ESCRIBIR UI)

Sumaj significa "lindo, bueno" en quechua. La app tiene que sentirse así:
**cálida, liviana, artesanal y rapidísima**. El usuario es un vendedor de viajes
con el celular en la mano entre mensaje y mensaje de WhatsApp. Cada pantalla
responde en el acto, cada acción da feedback, nada requiere manual.

## Identidad

- Fondo general `bg-cream` (#faf8f4). Tarjetas `card` (blanco, borde `line`, radio 2xl, sombra sutil).
- Tinta `text-ink`, secundario `text-ink-soft`, terciario `text-ink-faint`.
- Marca terracota: `brand-600` para acciones de marca, acentos y estados activos. El negro `ink` es el color de los botones primarios (elegancia > estridencia).
- Verde dinero `money-700` SOLO para plata que entra / éxito financiero. Rojo solo para peligro real.
- WhatsApp verde `#25d366` exclusivamente en acciones de WhatsApp (variant="whatsapp").
- Titulares con `font-display` (Fraunces): PageHeader ya lo hace. El cuerpo es Inter.
- Los presupuestos públicos usan su propio tema (QUOTE_COLORS/QUOTE_FONTS) — estética de papelería fina, tipo invitación: márgenes generosos, serif, líneas finas con puntito central (ver referencia peluquerOS).

## Jerarquía y densidad

- Una pantalla = una intención. El CRM muestra el pipeline; los detalles viven en el detalle.
- Números importantes grandes y con `tabular-nums`. Plata SIEMPRE con fmtMoney.
- Listas: filas de 56–64px en mobile, información en 2 líneas máx (título + meta gris).
- Vacíos SIEMPRE con `EmptyState` (emoji + título + descripción + acción). Nunca una tabla vacía muda.
- Cargas SIEMPRE con `loading.tsx` de skeletons que replican el layout real (no spinners a pantalla completa).

## Microinteracciones (el alma del sistema)

- Entradas de contenido: `animate-slide-up` en bloques principales, `animate-fade-in` en secundarios. Listas largas: animar solo el contenedor (no 100 items).
- Aparición de modales/menus: ya lo hacen Dialog/Dropdown/Popover. No duplicar.
- Botones: `active:scale-[0.98]` ya viene en Button. Estados `loading` en toda action.
- Hover en cards clickeables: `transition-all hover:border-line-strong hover:shadow-md hover:-translate-y-px`.
- Optimista: drag del kanban, envío de mensajes, toggles — el estado cambia YA, el server confirma después.
- Kanban drag: la tarjeta levantada rota levemente (`rotate-2 shadow-xl scale-105`), la columna destino se ilumina (`ring-2 ring-brand-300 bg-brand-50/40`).
- Éxitos importantes (lead ganado, cobro registrado): toast con emoji (🎉, 💵). Momentos de alegría, no solo "OK".
- Badges que aparecen (contadores no leídos): `animate-pop`.
- Focus visible siempre (ya global). Targets táctiles ≥ 44px en mobile.
- Transiciones 150–300ms con curvas suaves. NUNCA animaciones > 500ms en flujos frecuentes.

## Mobile-first (no negociable)

- Diseñar la vista de 390px PRIMERO, expandir a desktop después.
- Bottom tabs ya existen (64px + safe-area). El contenido de página ya tiene padding-bottom del layout: no agregar más.
- Kanban en mobile: columnas de 85vw con scroll-snap horizontal (`snap-x snap-mandatory`), o vista lista agrupada — elegí snap horizontal.
- Modales = bottom sheets automáticos (DialogContent ya lo hace).
- Acciones primarias de página al alcance del pulgar: botón en PageHeader `actions` (desktop) y si hace falta FAB `fixed bottom-[calc(64px+env(safe-area-inset-bottom)+16px)] right-4 md:hidden`.

## Copys

Español rioplatense, voseo, directo y cálido. Nada de jerga técnica.
- "Cargá el primer lead" no "No hay registros".
- "¿Seguro que querés eliminar este presupuesto?" con Cancelar/Eliminar.
- Errores: qué pasó + qué hacer. "No se pudo enviar. Revisá tu conexión y probá de nuevo."
- Números es-AR: punto de miles, coma decimal (fmtMoney/fmtNumber ya lo hacen).

## Charts (dashboard)

- Recharts. Sin gridlines pesadas (stroke `#e8e2d8`, dasharray 3 3), sin bordes de chart.
- Colores: brand-500 (#d96c2e) principal, ink-faint para comparativas, money-600 para plata.
- Tooltips custom estilo card. Ejes sin líneas (axisLine={false} tickLine={false}), ticks `text-xs fill-ink-faint`.
- Funnel del CRM: barras horizontales con % de conversión entre etapas — protagonista, no decoración.
