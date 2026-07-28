import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { supabase } from "./supabase.js";

/**
 * Auth state de Baileys guardado en Postgres (tabla `wa_session_state`),
 * una fila por clave. Es el equivalente a `useMultiFileAuthState` pero
 * multitenant y sin disco: el worker puede reiniciarse o escalar sin perder
 * las sesiones vinculadas.
 *
 * Los Buffer se serializan con BufferJSON (el mismo formato que usa Baileys).
 */
export async function useSupabaseAuthState(channelId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clear: () => Promise<void>;
}> {
  async function writeData(key: string, data: unknown): Promise<void> {
    const value = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
    const { error } = await supabase
      .from("wa_session_state")
      .upsert(
        { channel_id: channelId, key, value, updated_at: new Date().toISOString() },
        { onConflict: "channel_id,key" },
      );
    if (error) console.error(`[auth-state] write ${key}:`, error.message);
  }

  async function readData<T>(key: string): Promise<T | null> {
    const { data, error } = await supabase
      .from("wa_session_state")
      .select("value")
      .eq("channel_id", channelId)
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return null;
    // el jsonb vuelve como objeto: re-serializar para que el reviver rearme los Buffer
    return JSON.parse(JSON.stringify(data.value), BufferJSON.reviver) as T;
  }

  async function removeData(key: string): Promise<void> {
    await supabase
      .from("wa_session_state")
      .delete()
      .eq("channel_id", channelId)
      .eq("key", key);
  }

  const creds: AuthenticationCreds = (await readData<AuthenticationCreds>("creds")) ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out: { [id: string]: SignalDataTypeMap[typeof type] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData<SignalDataTypeMap[typeof type]>(`${type}-${id}`);
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(
                  value as never,
                ) as unknown as SignalDataTypeMap[typeof type];
              }
              if (value) out[id] = value;
            }),
          );
          return out;
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            const entries = data[category as keyof typeof data];
            if (!entries) continue;
            for (const id in entries) {
              const value = (entries as Record<string, unknown>)[id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(key, value) : removeData(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData("creds", creds),
    /** Al desvincular: borrar TODO el estado, si no el próximo start reusa la sesión muerta. */
    clear: async () => {
      const { error } = await supabase
        .from("wa_session_state")
        .delete()
        .eq("channel_id", channelId);
      if (error) console.error("[auth-state] clear:", error.message);
    },
  };
}
