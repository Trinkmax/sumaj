# viajerOS (repo sumaj)

Producto: **viajerOS** — sistema multi-tenant para agencias de viaje. Primera agencia/tenant: Sumaj Viajes (logo en storage + agencies.logo_url). Logos del sistema en /public (viajerOS-2.png)  (CRM + WhatsApp + cotizador + files + caja).

- **Leer SIEMPRE**: `CONVENTIONS.md` (arquitectura, contratos, patrones) y `DESIGN.md` (UI/UX) antes de escribir código.
- Stack: Next.js 16 App Router + React 19 + Tailwind v4 + Supabase (proyecto `zgfquryagiuncndjbmhf`).
- Migraciones en `supabase/migrations/` (ya aplicadas al proyecto remoto vía MCP). **No hay seed**: se borró `supabase/seed.sql` para que nadie reinyecte la demo (queda en el historial de git).
- **La base remota es la de producción y está en blanco**: cero contactos, leads, files, presupuestos, pagos, actividades y mensajes; se conservan la agencia, la sucursal Casa central, las etiquetas, los proveedores, las plantillas y las reglas de seguimiento. NO insertar datos de ejemplo ni correr `supabase db reset` contra el proyecto remoto.
- Acceso: un único admin de respaldo (tomas@sumaj.tur.ar) + 5 invitaciones pendientes del equipo real (`@sumajviajes.com`), que se activan cuando cada persona se registra con su email. Las contraseñas no van en el repo.
- `npm run dev` / `npm run build`. Env en `.env.local` (referencia en `.env.example`; el set mínimo para que WhatsApp ande está en `README.md`).
