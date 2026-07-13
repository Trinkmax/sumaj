# Product

## Register

product

## Users

- **Vendedores de agencia de viajes** (Sumaj Viajes y futuros tenants): con el celular en la mano, entre mensaje y mensaje de WhatsApp. Cargan leads, responden consultas, cotizan y cobran. Si algo tarda o pide muchos campos, no lo usan.
- **Dueños / socios (admin)**: miran el negocio desde el escritorio — pipeline, caja, comisiones, ranking de vendedores. Necesitan leer el estado del negocio en una pantalla.
- **Freelancers**: acceso limitado a lo suyo.

## Product Purpose

viajerOS es el sistema operativo de una agencia de viajes minorista: captura leads de Meta, los sigue por WhatsApp (canal de venta #1), cotiza, convierte en venta (file), cobra y liquida comisiones. Éxito = el vendedor vive dentro del CRM-WhatsApp sin cambiar de app, y el dueño confía en los números sin pedir planillas.

## Brand Personality

Cálido, artesanal, rapidísimo. "Sumaj" = lindo/bueno en quechua: papelería fina de agencia boutique, no SaaS corporativo. La interfaz responde en el acto (optimista siempre), celebra los momentos de venta, y habla español rioplatense directo y humano.

## Anti-references

- Emojis como iconografía de la UI (prohibidos: todo icono es lucide, trazo consistente).
- Admin genérico tipo Bootstrap/shadcn sin personalizar: tablas grises, selects nativos, cards idénticas con icono+título+texto.
- Dashboards sobrecargados de KPIs que nadie lee; el inicio es un centro de control de UNA pantalla.
- CRM "de formulario": la referencia del CRM es WhatsApp Web literal (lista de chats + hilo + panel contextual), no una tabla de leads.
- Gradientes violeta/azul "AI", glassmorphism decorativo, hero-metrics.

## Design Principles

1. **WhatsApp es casa.** El vendedor trabaja donde ya vive: el CRM se ve y se siente como WhatsApp Web, con las herramientas de la agencia (etapas, seguimiento, presupuesto, file) integradas al costado del hilo, nunca en otra página.
2. **Mínima fricción de carga.** Todo dato se carga una vez y fluye (lead → presupuesto → file → cliente → pasajeros relacionados). Formularios cortos, defaults inteligentes, opcional todo lo que se pueda completar después.
3. **Todo conectado, a un toque.** Personas relacionadas, files, presupuestos y chats se navegan entre sí sin volver atrás: cada entidad muestra sus vecinas y linkea.
4. **Feedback en el acto.** Optimista por defecto; micro-interacciones de 150–300ms que confirman cada gesto; los éxitos de plata se celebran.
5. **Una pantalla, una intención.** Densidad donde el dato lo pide (caja, cotizador), aire donde se decide (inicio, pipeline).

## Accessibility & Inclusion

- Targets táctiles ≥44px (mobile-first, 390px primero).
- Focus visible global, contraste AA (≥4.5:1 cuerpo), `prefers-reduced-motion` respetado en toda animación.
- Números tabulares para plata; es-AR en fechas y montos.
