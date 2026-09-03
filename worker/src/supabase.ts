import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

/**
 * Cliente con service role: el worker no tiene sesión de usuario.
 * Toca solo `wa_channels` (estado/QR), `wa_session_state` (credenciales,
 * mapa LID→teléfono y la cola de avisos pendientes) y el bucket `attachments`
 * (los adjuntos que bajan de WhatsApp). Las dos tablas tienen RLS activo sin
 * policies justamente para que nadie más entre.
 */
export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export type ChannelRow = {
  id: string;
  agency_id: string;
  branch_id: string | null;
  kind: "cloud_api" | "baileys";
  is_mother: boolean;
  label: string;
  phone: string | null;
  status: "desconectado" | "vinculando" | "conectado" | "error";
};

/** Canales de Baileys que el worker tiene que levantar al arrancar. */
export async function listBaileysChannels(): Promise<ChannelRow[]> {
  const { data, error } = await supabase
    .from("wa_channels")
    .select("id, agency_id, branch_id, kind, is_mother, label, phone, status")
    .eq("kind", "baileys");
  if (error) {
    console.error("[supabase] no se pudieron listar los canales:", error.message);
    return [];
  }
  return (data ?? []) as ChannelRow[];
}

export async function getChannel(channelId: string): Promise<ChannelRow | null> {
  const { data } = await supabase
    .from("wa_channels")
    .select("id, agency_id, branch_id, kind, is_mother, label, phone, status")
    .eq("id", channelId)
    .maybeSingle();
  return (data as ChannelRow | null) ?? null;
}

/** Estado visible en la UI: la app lo lee de la tabla (y por realtime). */
export async function patchChannel(
  channelId: string,
  patch: Partial<{
    status: ChannelRow["status"];
    qr: string | null;
    qr_expires_at: string | null;
    phone: string | null;
    last_connected_at: string | null;
    last_error: string | null;
  }>,
): Promise<void> {
  const { error } = await supabase
    .from("wa_channels")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", channelId);
  if (error) console.error(`[supabase] patchChannel(${channelId}):`, error.message);
}

/**
 * Borra `last_error` SOLO si el que está empieza con `prefix`. La cola de
 * avisos deja un error cuando se atasca y lo saca cuando se vacía; pero entre
 * una cosa y la otra la sesión pudo haber escrito el suyo ("Se cortó la
 * conexión…"), y ese no es nuestro para borrarlo. El filtro va en el UPDATE
 * para no leer-y-escribir con una carrera en el medio.
 */
export async function clearChannelError(channelId: string, prefix: string): Promise<void> {
  const { error } = await supabase
    .from("wa_channels")
    .update({ last_error: null, updated_at: new Date().toISOString() })
    .eq("id", channelId)
    .like("last_error", `${prefix}%`);
  if (error) console.error(`[supabase] clearChannelError(${channelId}):`, error.message);
}

/* ═══════════════════════════════════════════════════════════
   wa_session_state como almacén clave/valor del worker
   ═══════════════════════════════════════════════════════════ */

/**
 * Además de las credenciales de Baileys (auth-state.ts, que serializa Buffers
 * con BufferJSON), la misma tabla guarda JSON plano del worker:
 *
 *   · `lid-<lid>`        mapa LID→teléfono
 *   · `outbox-<uuid>`    avisos que no llegaron a la app (notify.ts)
 *   · `inbox-<id>`       mensajes entrantes a medio procesar (session.ts):
 *                        se anotan ANTES de bajar el adjunto y avisar, y se
 *                        borran al confirmar. Un corte en el medio los repone
 *                        al reconectar.
 *   · `pending-<id>`     envíos de media aceptados con 202 y todavía sin
 *                        resultado (outbound.ts). Si el worker reinicia en el
 *                        medio, al arrancar se le avisa a la app que fallaron.
 *   · `dead-<uuid>`      lo que se rindió: una fila de la cola que la app
 *                        rechazó 30 veces o que lleva un día sin salir. No se
 *                        reintenta; queda para que alguien la mire.
 *
 * Es a propósito: ya existe, ya es solo service role, y `clear()` de
 * auth-state la vacía entera al desvincular, que es exactamente lo que
 * corresponde para esos datos también. Ninguna clave de Baileys empieza con
 * esos prefijos (ver SignalDataTypeMap: pre-key, session, sender-key,
 * app-state-sync-…), así que no hay choque.
 */
export type StateRow = { channel_id: string; key: string; value: unknown; updated_at: string };

export async function readState<T>(channelId: string, key: string): Promise<T | null> {
  const { data, error } = await supabase
    .from("wa_session_state")
    .select("value")
    .eq("channel_id", channelId)
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return null;
  return data.value as T;
}

export async function writeState(channelId: string, key: string, value: unknown): Promise<boolean> {
  const { error } = await supabase
    .from("wa_session_state")
    .upsert(
      { channel_id: channelId, key, value, updated_at: new Date().toISOString() },
      { onConflict: "channel_id,key" },
    );
  if (error) {
    console.error(`[supabase] writeState(${key}):`, error.message);
    return false;
  }
  return true;
}

/**
 * Varias filas en un solo viaje. Para el mapa LID→teléfono: `contacts.upsert`
 * al abrir la sesión trae la agenda entera, y un upsert por contacto eran
 * cientos de requests concurrentes contra Supabase. Se parte en tandas para
 * no armar un body gigante.
 */
export async function writeStateMany(
  rows: { channel_id: string; key: string; value: unknown }[],
): Promise<void> {
  const TANDA = 200;
  const updated_at = new Date().toISOString();
  for (let i = 0; i < rows.length; i += TANDA) {
    const { error } = await supabase
      .from("wa_session_state")
      .upsert(
        rows.slice(i, i + TANDA).map((r) => ({ ...r, updated_at })),
        { onConflict: "channel_id,key" },
      );
    if (error) console.error(`[supabase] writeStateMany(${rows.length}):`, error.message);
  }
}

/**
 * Cambia solo `value`, sin tocar `updated_at`. Para anotar un fallo en una
 * fila de la cola: la cola es FIFO y `updated_at` es parte del orden, así que
 * reescribir la fila entera mandaba la cabeza al final en cada intento.
 */
export async function patchStateValue(channelId: string, key: string, value: unknown): Promise<void> {
  const { error } = await supabase
    .from("wa_session_state")
    .update({ value })
    .eq("channel_id", channelId)
    .eq("key", key);
  if (error) console.error(`[supabase] patchStateValue(${key}):`, error.message);
}

/**
 * Una clave en CUALQUIER canal. El LID de una persona es el mismo la mire
 * quien la mire, así que si otra sucursal ya juntó LID y teléfono, esta lo
 * puede aprovechar. Devuelve la fila más nueva.
 */
export async function readStateAnyChannel<T>(key: string): Promise<T | null> {
  const { data, error } = await supabase
    .from("wa_session_state")
    .select("value")
    .eq("key", key)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.value as T;
}

export async function deleteState(channelId: string, key: string): Promise<void> {
  const { error } = await supabase
    .from("wa_session_state")
    .delete()
    .eq("channel_id", channelId)
    .eq("key", key);
  if (error) console.error(`[supabase] deleteState(${key}):`, error.message);
}

/**
 * Filas cuya clave empieza con `prefix`, más viejas primero. Sin canal = todos.
 *
 * `orderBy` acepta un path de JSON de PostgREST (`value->>stashed_at`): el
 * orden de una cola tiene que salir de algo que NO cambie cuando se anota un
 * reintento, y `updated_at` cambia. Siempre desempata por `updated_at`.
 */
export async function listState(
  prefix: string,
  channelId?: string,
  opts: { limit?: number; orderBy?: string } = {},
): Promise<StateRow[]> {
  let query = supabase
    .from("wa_session_state")
    .select("channel_id, key, value, updated_at")
    .like("key", `${prefix}%`);
  if (opts.orderBy) query = query.order(opts.orderBy, { ascending: true, nullsFirst: true });
  query = query.order("updated_at", { ascending: true }).limit(opts.limit ?? 200);
  if (channelId) query = query.eq("channel_id", channelId);
  const { data, error } = await query;
  if (error) {
    console.error(`[supabase] listState(${prefix}):`, error.message);
    return [];
  }
  return (data ?? []) as StateRow[];
}

/** Cuántas filas con ese prefijo tiene el canal. null = no se pudo contar. */
export async function countState(prefix: string, channelId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from("wa_session_state")
    .select("key", { count: "exact", head: true })
    .eq("channel_id", channelId)
    .like("key", `${prefix}%`);
  if (error) {
    console.error(`[supabase] countState(${prefix}):`, error.message);
    return null;
  }
  return count ?? 0;
}

/* ═══════════════════════════════════════════════════════════
   Storage
   ═══════════════════════════════════════════════════════════ */

const BUCKET = "attachments";

/**
 * Sube un binario al bucket privado de adjuntos. La RLS del bucket exige que la
 * primera carpeta del path sea el agency_id (misma convención que
 * src/lib/media/store.ts en la app): el worker arma el path, acá solo se sube.
 */
export async function uploadAttachment(
  path: string,
  body: Buffer,
  contentType: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, { contentType, upsert: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
