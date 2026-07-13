# Sistema Sumaj — Descripción del producto a construir

La agencia de Tomás es **minorista**, recién arranca, va a **traer clientes pauteando en Meta**, y tiene un equipo chico (≈5-6 personas: socios + vendedores + algún freelance). Todo el sistema se ordena alrededor de una regla:

> **Si no es rápido y fácil, los vendedores no cargan los datos y el sistema muere.**

Por eso Sumaj se diseña sobre dos pilares y nada más:

1. **Vender** → capturar el lead de Meta, seguirlo y cerrarlo.
2. **Organizar** → una vez vendido, saber quién viaja, quién debe qué y cuánto ganamos.

Todo lo que no sirva directamente a esos dos objetivos, no entra en la primera versión.

---

## Principios de diseño (no negociables)

- **Mínima fricción de carga.** Un lead o un contacto se registra en menos de 30 segundos, con el mínimo de campos obligatorios. Todo lo demás es opcional y se completa después.
- **Mobile-first.** El vendedor carga y responde desde el celular. La versión de escritorio es para gestión/socios.
- **El dato entra una vez y fluye.** Lead → consulta → presupuesto → venta → cliente, sin volver a tipear nada. Un lead ganado ya es un cliente con su ficha.
- **Automatizá el seguimiento.** El sistema recuerda solo cuándo hay que volver a contactar —y **reabre la charla por WhatsApp solo**. El vendedor no tiene que acordarse de nada.
- **Un incentivo integrado a cargar datos:** las comisiones salen del sistema → "si no está cargado, no se paga". Esto resuelve el miedo de Tomás.

---

## Módulo 1 — CRM + Captura de leads de Meta ⭐ (el corazón)

Este es el módulo que justifica todo el proyecto, porque es donde entra la plata de la pauta.

### Captura automática de leads
- Integración con **Meta API**: formularios de **Instagram/Facebook Lead Ads**, y mensajes de **WhatsApp (Cloud API oficial)**, Instagram Direct y Messenger.
- Cada lead entra solo, con: nombre, contacto, **canal y campaña de origen** (qué anuncio, qué destino publicado: Caribe, Europa, Brasil, Turquía/Egipto…) y el mensaje inicial.
- **Asignación a vendedor** automática (round-robin o por regla) o manual.
- *(Opcional fase 2)* Formulario de la web y carga manual para leads que llegan por otros lados.

### Pipeline / embudo visual (kanban)
- Etapas claras: **Nuevo → Contactado → Presupuestado → En negociación → Ganado / Perdido.**
- Cada lead muestra su **próxima acción + fecha de seguimiento**, con recordatorio automático.
- Historial de cada contacto (llamados, notas, mensajes) — la "historia" del cliente.
- **Bandeja de WhatsApp embebida** en cada lead: el vendedor charla sin salir del CRM (ver abajo).

### WhatsApp — el canal de venta

**Un solo número**, conectado a la **Cloud API oficial de Meta**, integrada **directo** (sin BSP → sin markup por mensaje ni abono mensual).

- El lead entra por **Click-to-WhatsApp** desde la pauta → el CRM lo crea con su campaña de origen.
- **Respuesta automática instantánea** que ya califica (destino, fechas, cuántos son) para no enfriarlo.
- Se asigna vendedor y sigue **en el mismo chat**, desde la bandeja del CRM. El cliente nunca cambia de número ni espera.
- Mientras el cliente conteste, la charla es **texto libre y sin costo** (la ventana de 24h se renueva con cada mensaje suyo). Ahí entran los 15 días de cotizaciones y PDFs de hoteles.

**Seguimiento automático — biblioteca de plantillas**

Si el lead se enfría (>24h sin responder), el CRM **reabre la charla solo**, con una plantilla pre-aprobada por Meta elegida según la **etapa del pipeline**:

| Etapa | Plantilla de reenganche |
|---|---|
| Contactado | *"Hola {{nombre}}, soy {{vendedor}} de Sumaj 👋 Te escribo por tu consulta de {{destino}}. ¿Seguís buscando para esas fechas?"* |
| Presupuestado | *"Hola {{nombre}}, ¿pudiste ver la propuesta de {{destino}}? Cualquier ajuste lo vemos por acá."* |
| En negociación | *"Hola {{nombre}}, la tarifa de {{destino}} vence el {{fecha}}. ¿Avanzamos?"* |

**Cadencia de reenganche:**
- **48h** de silencio → primer toque. Es **gratis** (cae dentro de las 72h bonificadas del anuncio) y el lead todavía está caliente.
- **Día 7** → segundo toque a los que siguen mudos.
- **Día 21** → tercer toque, **solo** a los que llegaron a *Presupuestado* o *En negociación*.

Segmentar así deja el costo mensual en unos pocos dólares y cuida el *quality rating* del número (menos bloqueos → Meta no limita el envío).

### Etiquetado y segmentación
- Etiquetas libres + categorías configurables: **destino de interés, presupuesto estimado, tipo de viaje** (familiar, pareja, grupal, corporativo), **temporada, origen del lead**.
- Filtros por cualquier combinación de etiquetas → listas para **remarketing y campañas** (ej. "todos los que consultaron Caribe y no compraron").

### Presupuestos
- Armar una cotización rápida (destino, servicios, costo/venta) y **enviarla por WhatsApp/mail** en un click.
- Al aceptar → **con un botón se convierte en venta (file)**, sin recargar datos.

---

## Módulo 2 — Clientes

Ficha **simple**, no un formulario eterno:

- Datos básicos: nombre, contacto, documento (para facturar), fecha de nacimiento.
- **Pasajeros relacionados** (grupo familiar) para no recargar en cada venta.
- **Documentos de viaje con fecha de vencimiento** → aviso automático (ej. pasaporte por vencer).
- Adjuntos (foto del pasaporte/DNI).
- Notas de contexto libre.
- Hereda las **etiquetas** del CRM y muestra su historial: qué consultó, qué compró, cuánto gastó.

Un lead ganado se transforma en cliente automáticamente.

---

## Módulo 3 — Ventas / Files (organización de la agencia)

Cada venta es un **file** — la unidad que ordena a la agencia:

- Datos: cliente, pasajero(s), **vendedor**, destino, fechas de viaje.
- **Servicios** cargados de forma uniforme y simple (aéreo, hotel, paquete, excursión, traslado, asistencia): proveedor, fechas, **costo** y **precio de venta**.
- **Utilidad automática** por file (venta − costo), y acumulada por vendedor y por mes.
- **Estado del viaje:** Cotizado → Vendido → Pagado → En curso → Finalizado.
- Voucher/confirmación básica para enviar al cliente.
- Buscador de files por cliente, destino, fecha o estado.

---

## Módulo 4 — Cobros y caja (liviano, sin contabilidad pesada)

- Registrar **pagos del cliente**: efectivo, transferencia, tarjeta. **Multimoneda ARS/USD** con cotización.
- **Cuenta corriente por cliente/file:** cuánto se vendió, cuánto pagó, **saldo pendiente**.
- **Recibo** generado y enviable por WhatsApp/mail en el momento.
- *(Opcional)* registro simple de pagos a proveedores.
- **Vista de caja / flujo:** qué entró, qué salió, qué falta cobrar.
- **Facturación:** integración con **ARCA/AFIP** para factura electrónica cuando corresponda — mantenida simple y opcional. La contabilidad completa la sigue haciendo el contador; el sistema solo le entrega la información.

---

## Módulo 5 — Comisiones

- Cálculo automático de **comisión por vendedor/promotor** en cada file (incluye freelancers).
- Liquidación clara por período.
- Es el incentivo que hace que todos carguen los datos.

---

## Módulo 6 — Dashboard / gestión

Dos vistas: **vendedor** (lo suyo) y **socio/admin** (todo):

- Leads nuevos sin atender y **seguimientos del día**.
- Ventas del mes y **ranking por vendedor**.
- Cobros pendientes / saldos.
- Próximas salidas y vencimientos (viajes y documentos).
- Origen de los leads / rendimiento por campaña de Meta → **cuánto rinde la pauta**.

---

## Módulo 7 — Usuarios, roles y avisos

- **Roles:** Socio/Admin (ve todo, configura), Vendedor (ve sus leads/clientes/files), Freelance (acceso limitado a lo propio).
- Registro de quién hizo cada cosa.
- **Agenda y notificaciones** (push/WhatsApp): seguimientos de leads, vencimientos de documentos, próximas salidas, y cumpleaños de clientes para remarketing.

---

## Roadmap — Cómo cortarlo para llegar a septiembre/octubre

### MVP (Fase 1) — lo que le da ROI a la pauta desde el día uno
> Captura de leads de Meta + **WhatsApp embebido con seguimiento automático** + pipeline + etiquetado → Clientes → Files con costo/venta/utilidad → Cobros y cuenta corriente simple → Dashboard. Todo mobile-first.

### Fase 2 (post-temporada)
> Facturación ARCA, comisiones detalladas, bandeja unificada (sumar Instagram Direct y Messenger), reportes avanzados, pagos a proveedores, formulario web.

---

**En una frase:** un sistema **simple**, centrado en **vender y organizar**, con el **CRM + Meta + etiquetado** como núcleo, y sin arrastrar la complejidad que no se necesita todavía.
