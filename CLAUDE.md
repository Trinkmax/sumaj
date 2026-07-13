# viajerOS (repo sumaj)

Producto: **viajerOS** — sistema multi-tenant para agencias de viaje. Primera agencia/tenant: Sumaj Viajes (logo en storage + agencies.logo_url). Logos del sistema en /public (viajerOS-2.png)  (CRM + WhatsApp + cotizador + files + caja).

- **Leer SIEMPRE**: `CONVENTIONS.md` (arquitectura, contratos, patrones) y `DESIGN.md` (UI/UX) antes de escribir código.
- Stack: Next.js 16 App Router + React 19 + Tailwind v4 + Supabase (proyecto `zgfquryagiuncndjbmhf`).
- Migraciones en `supabase/migrations/` (ya aplicadas al proyecto remoto vía MCP). Seed demo en `supabase/seed.sql`.
- Usuarios demo (password `sumaj2026`): tomas@sumaj.tur.ar (admin), carla@sumaj.tur.ar (vendedora), luca@sumaj.tur.ar (freelance).
- `npm run dev` / `npm run build`. Env en `.env.local`.
