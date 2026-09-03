import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { applyReaction, handleInboundMessage } from "@/lib/wa/inbound";
import { baileysErrorCopy } from "@/lib/wa/worker";
import { mergeMetadata, statusAdvances } from "@/lib/wa/message-row";
import type { WorkerEvent } from "@/lib/wa/worker-contract";
import type { Database } from "@/lib/database.types";
import type { Enums, TablesUpdate } from "@/lib/types";

/**
 * Eventos del worker de Baileys (los números de las sucursales).
 *
 * El worker firma el body con HMAC-SHA256 y el mismo secreto compartido. Sin
 * WA_WEBHOOK_SECRET no se acepta nada: /api/wa es público en el proxy y este
 * handler escribe con service role.
 *
 * Llega UN evento por POST (`WorkerEvent`, ver `wa/worker-contract.ts`): el
 * mensaje que entró o que el operador mandó desde el celular, una reacción,
 * un borrado, una edición, un recibo de entrega/lectura o el resultado de un
 * envío de media que había quedado pendiente.
 *
 * Qué se contesta importa: el worker reintenta ante un 500 y da por avisado
 * ante un 200. Así que 500 SOLO cuando no se pudo guardar; lo que no aplica
 * (canal desconocido, mensaje que no tenemos, estado que no avanza) es 200 con
 * `ignored`, porque reintentarlo no va a cambiar nada.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Admin = SupabaseClient<Database>;

function validSignature(raw: string, signature: string | null): boolean {
  const secret = process.env.WA_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Lo que cada handler le devuelve al POST. */
type Outcome =
  | { ok: true; ignored?: boolean }
  | { ok: false; error: string };

const ok = (ignored = false): Outcome => (ignored ? { ok: true, ignored: true } : { ok: true });
const saveFailed = (error: string): Outcome => ({ ok: false, error });

export async function POST(request: Request) {
  const raw = await request.text();
  if (!validSignature(raw, request.headers.get("x-wa-signature"))) {
    return NextResponse.json({ ok: false, error: "Firma inválida" }, { status: 401 });
  }

  if (!hasAdminClient()) {
    return NextResponse.json(
      { ok: false, error: "Falta SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 },
    );
  }

  let event: WorkerEvent;
  try {
    event = JSON.parse(raw) as WorkerEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  if (!event || typeof event !== "object" || typeof event.type !== "string" || !event.channelId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  /* El tenant sale del canal, nunca del payload: con service role no hay RLS,
     así que cada UPDATE de acá abajo filtra por agency_id. Un canal que no
     existe no es un error del worker: es 200 para que deje de insistir. */
  const supabase = createAdminClient();
  const { data: channel } = await supabase
    .from("wa_channels")
    .select("id, agency_id")
    .eq("id", event.channelId)
    .maybeSingle();
  if (!channel) return NextResponse.json({ ok: true, ignored: true });
  const agencyId = channel.agency_id;

  let outcome: Outcome;
  switch (event.type) {
    case "message": {
      const result = await handleInboundMessage(
        {
          channelId: channel.id,
          from: event.from ?? null,
          lid: event.lid ?? null,
          direction: event.direction === "out" ? "out" : "in",
          text: event.text ?? "",
          kind: (event.kind ?? "texto") as Enums<"message_kind">,
          waMessageId: event.waMessageId ?? null,
          pushName: event.pushName ?? null,
          timestamp: event.timestamp ?? Date.now(),
          storedMedia: event.media ?? null,
          contextMessageId: event.contextMessageId ?? null,
          metadata: event.metadata ?? {},
        },
        // Sin credenciales de Meta a propósito: por acá entran los mensajes de
        // las sucursales (Baileys). La respuesta automática es del número madre
        // y sale por la Cloud API, así que en este camino nunca hace falta.
        null,
      );
      outcome = result.ok ? ok() : saveFailed(result.error ?? "No se pudo guardar el mensaje.");
      break;
    }
    case "reaction":
      // Nunca falla: reaccionar a un mensaje que no tenemos no es un error.
      await applyReaction(supabase, agencyId, {
        messageId: event.targetMessageId,
        emoji: event.emoji ?? null,
        direction: event.direction === "out" ? "out" : "in",
      });
      outcome = ok();
      break;
    case "revoke":
      outcome = await revokeMessage(supabase, agencyId, event.waMessageId);
      break;
    case "edit":
      outcome = await editMessage(supabase, agencyId, event.waMessageId, event.text ?? "");
      break;
    case "status":
      outcome = await advanceStatus(supabase, agencyId, {
        waMessageId: event.waMessageId,
        status: event.status,
        errorDetail: null,
      });
      break;
    case "send_result":
      /* El envío de media que el worker había aceptado (202) terminó. Si salió,
         la fila pasa de pendiente a enviado; si no, queda fallida con el motivo
         ya traducido para el vendedor —es lo que ve en la burbuja.
         Este id lo generó un envío NUESTRO, así que la fila tiene que existir:
         si todavía no está es que el worker terminó antes de que la action la
         guardara (una subida chica gana la carrera). Se la espera un par de
         segundos ACÁ, no con un 500: el worker trata el 500 como "la app está
         caída", marca appDownUntil y frena los eventos de TODOS los canales
         por una carrera de milisegundos. */
      outcome = await advanceStatus(supabase, agencyId, {
        waMessageId: event.waMessageId,
        status: event.ok ? "enviado" : "fallido",
        errorDetail: event.ok ? null : baileysErrorCopy(event.code, event.error),
        waitForRow: true,
      });
      break;
    default:
      outcome = ok(true);
  }

  if (!outcome.ok) {
    // Con un 200 el worker daría el evento por avisado y la consulta se
    // perdería en silencio; con el error a la vista lo escribe en el canal
    // (last_error) y reintenta.
    console.error(`[wa/baileys] ${event.type}: ${outcome.error}`);
    return NextResponse.json({ ok: false, error: outcome.error }, { status: 500 });
  }
  return NextResponse.json(outcome);
}

/* ───────────────────────── mensajes que cambian ───────────────────────── */

/** La fila del mensaje, por su id externo. Con service role el tenant lo pone el caller. */
async function findByWaId(supabase: Admin, agencyId: string, waMessageId: string) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, status, metadata, conversation_id, created_at")
    .eq("wa_message_id", waMessageId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  return { row: data, error };
}

/**
 * Si el mensaje que cambió era el ÚLTIMO del hilo, la bandeja lo sigue
 * mostrando como estaba: `last_message_preview` lo escribe el trigger al
 * insertar y nadie lo toca después. Se compara `created_at` con
 * `last_message_at` (es lo que el trigger copia) y se rehace el preview con
 * la misma regla que él: `left(coalesce(body, '[kind]'), 120)`.
 * Best-effort: un preview viejo no es motivo para reintentar el evento.
 */
async function refreshPreviewIfLast(
  supabase: Admin,
  agencyId: string,
  row: { conversation_id: string; created_at: string },
  body: string | null,
  kind: Enums<"message_kind">,
): Promise<void> {
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, last_message_at")
    .eq("id", row.conversation_id)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!conversation?.last_message_at) return;
  if (new Date(conversation.last_message_at).getTime() !== new Date(row.created_at).getTime()) return;

  const { error } = await supabase
    .from("conversations")
    .update({ last_message_preview: (body ?? `[${kind}]`).slice(0, 120) })
    .eq("id", conversation.id)
    .eq("agency_id", agencyId);
  if (error) console.warn(`[wa/baileys] preview sin actualizar: ${error.message}`);
}

/**
 * La persona lo borró para todos. Se vacía el contenido y queda la marca: el
 * hilo tiene que mostrar que ahí hubo algo, sin mostrar qué. Mismo criterio
 * que el borrado de Instagram (`lib/ig/webhook.ts`).
 */
async function revokeMessage(
  supabase: Admin,
  agencyId: string,
  waMessageId: string,
): Promise<Outcome> {
  const { row, error: readError } = await findByWaId(supabase, agencyId, waMessageId);
  if (readError) return saveFailed(`No se pudo leer el mensaje borrado: ${readError.message}`);
  // Borrar algo anterior a la conexión, o que nunca entró, no es un error.
  if (!row) return ok(true);

  const body = "Se eliminó este mensaje";
  const { data: updated, error } = await supabase
    .from("messages")
    .update({
      body,
      media: null,
      metadata: mergeMetadata(row.metadata, { revoked: true }) as TablesUpdate<"messages">["metadata"],
    })
    .eq("id", row.id)
    .eq("agency_id", agencyId)
    .select("kind")
    .maybeSingle();
  if (error) return saveFailed(`No se pudo marcar el mensaje borrado: ${error.message}`);
  await refreshPreviewIfLast(supabase, agencyId, row, body, updated?.kind ?? "texto");
  return ok();
}

/** La persona lo editó: `body` pasa a ser la versión nueva y queda cuándo. */
async function editMessage(
  supabase: Admin,
  agencyId: string,
  waMessageId: string,
  text: string,
): Promise<Outcome> {
  const { row, error: readError } = await findByWaId(supabase, agencyId, waMessageId);
  if (readError) return saveFailed(`No se pudo leer el mensaje editado: ${readError.message}`);
  if (!row) return ok(true);

  const { data: updated, error } = await supabase
    .from("messages")
    .update({
      body: text || null,
      metadata: mergeMetadata(row.metadata, {
        edited_at: new Date().toISOString(),
      }) as TablesUpdate<"messages">["metadata"],
    })
    .eq("id", row.id)
    .eq("agency_id", agencyId)
    .select("kind")
    .maybeSingle();
  if (error) return saveFailed(`No se pudo guardar la edición: ${error.message}`);
  await refreshPreviewIfLast(supabase, agencyId, row, text || null, updated?.kind ?? "texto");
  return ok();
}

/* ───────────────────────── estados de entrega ───────────────────────── */

/** Cuántas veces (y cada cuánto) se espera la fila de un envío nuestro. */
const ROW_WAIT_ATTEMPTS = 3;
const ROW_WAIT_MS = 1_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Aplica un estado solo si AVANZA (`statusAdvances`, compartido con
 * `saveOutboundMessage`: fallido es pegajoso, un fallido tardío no pisa un
 * entregado, y el resto solo sube).
 *
 * `waitForRow`: la fila es de un envío NUESTRO y tiene que existir. Si no está,
 * la action todavía no la guardó (el worker terminó antes): se relee hasta
 * tres veces con un segundo entre medio. Si sigue sin aparecer se contesta 200
 * con `ignored` y se deja rastro — NUNCA un 500 por una fila ausente, porque
 * el worker lo lee como "la app está caída" y frena todos los canales. El 500
 * queda solo para cuando la base no contestó.
 */
async function advanceStatus(
  supabase: Admin,
  agencyId: string,
  input: {
    waMessageId: string;
    status: Enums<"message_status">;
    errorDetail: string | null;
    waitForRow?: boolean;
  },
): Promise<Outcome> {
  let row: Awaited<ReturnType<typeof findByWaId>>["row"] = null;
  const attempts = input.waitForRow ? ROW_WAIT_ATTEMPTS : 1;
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) await sleep(ROW_WAIT_MS);
    const found = await findByWaId(supabase, agencyId, input.waMessageId);
    if (found.error) {
      return saveFailed(`No se pudo leer el estado del mensaje: ${found.error.message}`);
    }
    row = found.row;
    if (row) break;
  }

  if (!row) {
    if (input.waitForRow) {
      // Un recibo de un mensaje que no tenemos (anterior a la conexión, o de
      // otro dispositivo) no es un error; este sí debería estar, así que
      // queda en el log para poder rastrearlo.
      console.warn(
        `[wa/baileys] send_result de ${input.waMessageId} sin fila después de ${ROW_WAIT_ATTEMPTS} lecturas: se ignora (${input.status}).`,
      );
    }
    return ok(true);
  }

  if (!statusAdvances(row.status, input.status)) return ok(true);

  const patch: TablesUpdate<"messages"> =
    input.status === "fallido"
      ? { status: "fallido", error_detail: input.errorDetail }
      : { status: input.status };

  const { error } = await supabase
    .from("messages")
    .update(patch)
    .eq("id", row.id)
    .eq("agency_id", agencyId);
  if (error) return saveFailed(`No se pudo actualizar el estado: ${error.message}`);
  return ok();
}
