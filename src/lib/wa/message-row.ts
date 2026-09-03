/**
 * La fila de `messages` cuando la escriben dos manos a la vez.
 *
 * Todo lo que mandamos por un número de sucursal (Baileys) o por Instagram
 * vuelve como un ECO: el worker emite el `messages.upsert` fromMe de nuestro
 * propio envío, y Meta manda el eco del DM. Ese eco trae el MISMO id externo
 * que la app está por guardar, y `messages.wa_message_id` es único. Cuando el
 * eco gana la carrera, la fila la inserta `handleInboundMessage` sin autor
 * (`sent_by` null), sin `is_automated` y sin nuestra metadata —y el insert de
 * la action choca con 23505.
 *
 * Acá vive lo que comparten las actions del chat, el puente desde Instagram y
 * el despachador de seguimientos para que el choque no signifique perder al
 * autor ni el motivo del mensaje. SIN `"use server"`: lo importan route
 * handlers y módulos con service role.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type {
  MessageMetadata,
  MessageStatus,
  TablesInsert,
  TablesUpdate,
} from "@/lib/types";

/** Sirve tanto el cliente de la sesión (actions) como el de service role (webhooks, cron). */
type AnyClient = SupabaseClient<Database>;

export type SentMessage = { id: string; status: MessageStatus; createdAt: string };

/* ───────────────────────── estados de entrega ───────────────────────── */

/**
 * Qué tan lejos llegó un mensaje. Los recibos de WhatsApp no vienen en orden
 * (un "entregado" puede llegar después del "leído") y el worker reintenta:
 * sin esto un tilde viejo pisaría uno nuevo y el vendedor dejaría de creerles.
 */
export const MESSAGE_STATUS_RANK: Record<MessageStatus, number> = {
  pendiente: 0,
  enviado: 1,
  entregado: 2,
  leido: 3,
  // fuera de la escala: se decide aparte
  fallido: -1,
};

/**
 * ¿`next` avanza sobre `current`? Lo mismo que `aplicarEstadoAlDestinatario`
 * hace con los destinatarios de una difusión (`wa/cloud-webhook.ts`), pero
 * sobre la fila del mensaje.
 *
 *   · `fallido` es pegajoso: una vez que un mensaje falló, ningún recibo tardío
 *     lo "cura" —si de verdad salió, sale con otro id.
 *   · Un `fallido` que llega cuando el mensaje YA está en el teléfono del
 *     cliente (entregado/leído) es una señal vieja: se ignora.
 *   · El resto solo sube: pendiente → enviado → entregado → leído.
 */
export function statusAdvances(current: MessageStatus, next: MessageStatus): boolean {
  if (current === "fallido") return false;
  if (next === "fallido") return MESSAGE_STATUS_RANK[current] < MESSAGE_STATUS_RANK.entregado;
  return MESSAGE_STATUS_RANK[next] > MESSAGE_STATUS_RANK[current];
}

/** `metadata` es jsonb y PostgREST no concatena: se lee, se mezcla y se escribe. */
export function mergeMetadata(current: unknown, patch: unknown): MessageMetadata {
  const base = current && typeof current === "object" ? (current as MessageMetadata) : {};
  const extra = patch && typeof patch === "object" ? (patch as MessageMetadata) : {};
  return { ...base, ...extra };
}

/* ───────────────────────── guardar lo que salió ───────────────────────── */

/**
 * Guarda el mensaje que ACABA de salir, tolerando que el eco nos haya ganado
 * de mano.
 *
 * Ante el 23505 no alcanza con leer la fila ganadora y devolverla tal cual: esa
 * fila la escribió el webhook y no sabe quién mandó el mensaje ni por qué. Se
 * le completa lo que solo la app sabe —`sent_by`, `is_automated`, nuestra
 * `metadata` (mezclada sobre la del eco, que trae lo de WhatsApp) y el
 * `template_name`— y el estado solo si AVANZA: el eco ya llegó "enviado" y un
 * "pendiente" nuestro no lo puede devolver atrás.
 *
 * Devuelve null solo si no se pudo escribir nada: el caller lo traduce a "no se
 * pudo enviar". Nunca tira.
 */
export async function saveOutboundMessage(
  supabase: AnyClient,
  values: TablesInsert<"messages">,
): Promise<SentMessage | null> {
  const { data, error } = await supabase
    .from("messages")
    .insert(values)
    .select("id, status, created_at")
    .single();

  if (data) return { id: data.id, status: data.status, createdAt: data.created_at };

  // 23505 = unique_violation de wa_message_id: el eco llegó primero.
  if (error?.code !== "23505" || !values.wa_message_id) return null;

  const { data: winner } = await supabase
    .from("messages")
    .select("id, status, created_at, metadata, media")
    .eq("wa_message_id", values.wa_message_id)
    // Con service role no hay RLS que ponga el límite: el agency_id lo pone acá.
    .eq("agency_id", values.agency_id)
    .maybeSingle();
  if (!winner) return null;

  const patch: TablesUpdate<"messages"> = {
    metadata: mergeMetadata(winner.metadata, values.metadata) as TablesUpdate<"messages">["metadata"],
  };
  if (values.sent_by !== undefined) patch.sent_by = values.sent_by;
  if (values.is_automated !== undefined) patch.is_automated = values.is_automated;
  // El eco de un adjunto que mandó el worker viene SIN media (no vuelve a bajar
  // lo que acaba de subir): el archivo lo conoce la app, que lo firmó. Sin esto
  // la burbuja queda como una foto sin foto.
  if (values.media && !winner.media) patch.media = values.media;
  if (values.template_name) patch.template_name = values.template_name;
  if (values.status && statusAdvances(winner.status, values.status)) {
    patch.status = values.status;
    if (values.status === "fallido") patch.error_detail = values.error_detail ?? null;
  }

  const { data: updated, error: updateError } = await supabase
    .from("messages")
    .update(patch)
    .eq("id", winner.id)
    .eq("agency_id", values.agency_id)
    .select("id, status, created_at")
    .maybeSingle();

  if (updateError || !updated) {
    // El mensaje está (lo guardó el eco): perder el autor es peor que nada,
    // pero no es motivo para decirle al vendedor que no salió.
    console.warn(
      `[wa] eco ganador sin completar (${values.wa_message_id}): ${updateError?.message ?? "sin fila"}`,
    );
    return { id: winner.id, status: winner.status, createdAt: winner.created_at };
  }
  return { id: updated.id, status: updated.status, createdAt: updated.created_at };
}
