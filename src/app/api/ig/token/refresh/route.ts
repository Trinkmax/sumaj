import { NextResponse } from "next/server";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { refreshIgToken } from "@/lib/ig/graph";
import { getIgCredsByChannel, setIgSecret } from "@/lib/ig/credentials";

/**
 * Renueva los tokens de Instagram que están por vencer.
 *
 * EL TOKEN DE INSTAGRAM VENCE A LOS 60 DÍAS. No existe el equivalente al token
 * permanente del usuario del sistema de WhatsApp: si nadie lo renueva, un
 * martes cualquiera la agencia deja de recibir DMs y no hay nada roto que
 * mirar — simplemente venció. Este cron es lo que hace que eso no pase.
 *
 * Se renueva con margen (15 días) y no sobre la hora: Meta exige que el token
 * tenga al menos 24 hs de vida y esté vigente, así que apurarse al último día
 * deja sin red al primer error de la API.
 *
 * El lote mezcla agencias: cada fila usa SU token y escribe SU secreto. Nunca se
 * resuelven credenciales una sola vez para todas.
 *
 * Lo llama el cron de Postgres con el header x-cron-secret, igual que los
 * seguimientos. Una vez por día alcanza y sobra.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Con cuántos días de anticipación se renueva. */
const MARGIN_DAYS = 15;

export async function POST(request: Request) {
  const secret = process.env.WA_CRON_SECRET;
  if (!secret || request.headers.get("x-cron-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }
  if (!hasAdminClient()) {
    return NextResponse.json(
      { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 },
    );
  }

  const supabase = createAdminClient();
  const deadline = new Date(Date.now() + MARGIN_DAYS * 86_400_000).toISOString();

  const { data: accounts, error } = await supabase
    .from("ig_accounts")
    .select("channel_id, token_expires_at")
    .not("token_secret_id", "is", null)
    // Sin fecha de vencimiento tampoco se sabe cuánto le queda: se renueva igual
    // y así queda con una fecha conocida.
    .or(`token_expires_at.is.null,token_expires_at.lte.${deadline}`);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let renewed = 0;
  let failed = 0;

  for (const account of accounts ?? []) {
    const creds = await getIgCredsByChannel(account.channel_id);
    if (!creds) {
      failed++;
      continue;
    }

    const res = await refreshIgToken(creds.token);
    if (!res.ok) {
      failed++;
      // Queda escrito en el DIAGNÓSTICO, no solo en un log que nadie mira: es
      // la única forma de que la agencia se entere antes de quedarse sin recibir
      // mensajes. Con `check_ok = false` la pantalla ya avisa arriba de todo.
      await supabase
        .from("ig_accounts")
        .update({
          check_ok: false,
          checked_at: new Date().toISOString(),
          checks: [
            {
              key: "token",
              label: "Token de acceso",
              level: "error",
              detail: `No se pudo renovar el token: ${res.error}`,
              action:
                "Generá uno nuevo en Meta (Instagram, API setup with Instagram login, Generate token) y pegalo arriba. Si no, cuando venza dejan de entrar los mensajes.",
            },
          ],
          updated_at: new Date().toISOString(),
        })
        .eq("channel_id", account.channel_id);
      console.error(`[ig/token] ${account.channel_id}: ${res.error}`);
      continue;
    }

    const saved = await setIgSecret(account.channel_id, "token", res.data.token);
    if (!saved.ok) {
      failed++;
      continue;
    }

    await supabase
      .from("ig_accounts")
      .update({
        token_tail: res.data.token.slice(-4),
        token_expires_at: res.data.expiresAt?.toISOString() ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("channel_id", account.channel_id);
    renewed++;
  }

  return NextResponse.json({ ok: true, renewed, failed });
}
