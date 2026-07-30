/**
 * Cliente Supabase con SERVICE ROLE.
 *
 * IMPORTANTE: SOLO SERVIDOR. NUNCA importar este archivo desde un client component
 * (nada con "use client", nada que termine en el bundle del browser).
 * La service role key saltea TODAS las políticas RLS: si se filtra al browser,
 * cualquiera puede leer y escribir los datos de todas las agencias.
 *
 * Se usa desde server actions (`"use server"`) y desde los webhooks de WhatsApp,
 * para lo que la sesión del usuario no puede hacer: crear cuentas de auth del
 * equipo con email + contraseña (Configuración → Equipo), registrar los mensajes
 * entrantes sin sesión, despachar los seguimientos y leer el QR de vinculación de
 * una sucursal.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` es REQUERIDA en cualquier deploy real: sin ella el
 * WhatsApp entrante se rechaza (los webhooks devuelven 503), el seguimiento
 * automático no sale y el QR de las sucursales no se puede mostrar. Lo único que
 * degrada elegante es el alta del equipo, que cae al camino de invitación
 * (ver `createTeamMember`).
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/** ¿La instalación tiene service role key cargada? */
export function hasAdminClient(): boolean {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** Cliente admin (sin sesión, sin refresh). Chequeá `hasAdminClient()` antes. */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
