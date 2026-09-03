import { createHmac, randomUUID } from "node:crypto";
import { config } from "./config.js";
import type { WorkerEvent } from "./contract.js";
import {
  clearChannelError,
  countState,
  deleteState,
  listState,
  patchChannel,
  patchStateValue,
  writeState,
} from "./supabase.js";

/**
 * Avisos worker → app (POST /api/wa/baileys/events, firmados con HMAC).
 *
 * Un aviso que no llega es una consulta perdida, y la app vive en Vercel: se
 * redeploya, tiene cold starts, a veces contesta 502 un segundo. Por eso:
 *
 *   1. cada intento tiene 15 s de tope (AbortSignal.timeout);
 *   2. sobre 5xx o error de red se reintenta 3 veces (1 s, 5 s, 20 s);
 *   3. si igual no sale, el evento se PERSISTE en wa_session_state bajo
 *      "outbox-<uuid>" y se drena al reconectar la sesión y cada 60 s.
 *
 * Un 4xx no se reintenta ni se guarda: es un pedido que la app entendió y
 * rechazó (firma inválida, JSON roto). Repetirlo daría lo mismo, y encolarlo
 * acumularía basura que nunca va a salir. Se deja en `last_error` del canal
 * para que alguien lo vea.
 *
 * Mientras la app está caída NO se sube la escalera por cada evento: la
 * primera falla la marca como caída por un minuto y lo que llega en ese rato
 * va derecho a la cola (si no, veinte mensajes en una caída de diez minutos
 * son veinte escaleras de 86 s, una atrás de la otra, en la cola de la
 * sesión). Y mientras haya cosas encoladas para un canal, lo nuevo también se
 * encola: la cola es FIFO y un evento nuevo no puede pasar por encima de uno
 * viejo — el lead se abre con el primer mensaje, no con el último.
 *
 * El orden de la cola sale de `stashed_at` (adentro del value), que no cambia
 * nunca. NO de `updated_at`: anotar un reintento tocaba esa columna y mandaba
 * la cabeza al final, así que después de una caída larga los mensajes
 * llegaban rotados.
 *
 * Y la cola no puede quedar trabada para siempre por una fila que la app
 * rechaza con 500 una y otra vez (un `send_result` de un mensaje que nunca se
 * guardó, por ejemplo): a los 30 intentos o a las 24 h la fila se retira a
 * "dead-<uuid>", se anota en el canal, y lo que venía atrás sigue.
 */

const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [1_000, 5_000, 20_000];
const DRAIN_EVERY_MS = 60_000;
const OUTBOX_PREFIX = "outbox-";
const DEAD_PREFIX = "dead-";

/** Después de una falla de red/5xx, cuánto tiempo se da por caída a la app. */
const APP_DOWN_MS = 60_000;
/** Tope por fila: más que esto, la fila está envenenada y se retira. */
const MAX_ROW_ATTEMPTS = 30;
const MAX_ROW_AGE_MS = 24 * 60 * 60_000;

/** Prefijo de TODOS los last_error que escribe este módulo (clearChannelError filtra por él). */
const ERROR_PREFIX = "No se pudo avisarle a la app de un evento de WhatsApp";

type Attempt = { ok: true } | { ok: false; retryable: boolean; detail: string };

/** hasta cuándo se asume que la app no responde (0 = responde) */
let appDownUntil = 0;
/** cuántas filas encoladas hay por canal (lo que este proceso sabe) */
const queued = new Map<string, number>();
/**
 * Canales cuyo `last_error` vigente es "la cola está atascada" (puesto por
 * nosotros y transitorio). Cuando la cola se vacía se limpia; los errores
 * permanentes (una fila rechazada o retirada) no entran acá y quedan hasta
 * que la sesión reconecte o alguien vuelva a vincular.
 */
const transientFlag = new Set<string>();

type OutboxRow = {
  event: WorkerEvent;
  /** cuándo entró a la cola: es el orden, y no cambia nunca */
  stashed_at: string;
  last_error: string;
  /** cuántas veces se intentó mandar y falló (la escalera inicial cuenta) */
  attempts: number;
};

function sign(body: string): string {
  return createHmac("sha256", config.webhookSecret).update(body).digest("hex");
}

async function post(body: string): Promise<Attempt> {
  try {
    const res = await fetch(`${config.appUrl}/api/wa/baileys/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-wa-signature": sign(body),
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => "");
    const detail = `la app respondió ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`;
    return { ok: false, retryable: res.status >= 500, detail };
  } catch (error) {
    const detail =
      error instanceof Error && error.name === "TimeoutError"
        ? "la app no respondió en 15 s"
        : error instanceof Error
          ? error.message
          : "error desconocido";
    return { ok: false, retryable: true, detail };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Un intento más los reintentos con espera creciente; devuelve el último resultado. */
async function deliver(body: string, label: string): Promise<Attempt> {
  let last: Attempt = { ok: false, retryable: true, detail: "sin intentos" };
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    if (i > 0) {
      console.warn(`[notify] ${label}: ${(last as { detail: string }).detail} — reintento ${i} en ${RETRY_DELAYS_MS[i - 1]} ms`);
      await sleep(RETRY_DELAYS_MS[i - 1]!);
    }
    last = await post(body);
    if (last.ok || !last.retryable) return last;
  }
  return last;
}

/**
 * Un mensaje que no llega a la app es una consulta perdida: dejamos el motivo en
 * la fila del canal para que no muera en el stdout del worker.
 *
 * `transient` = "está encolado y se reintenta solo": ese aviso se borra cuando
 * la cola se vacía (queueEmptied). Los otros (rechazado por la app, retirado
 * de la cola) quedan hasta que la sesión reconecte o alguien vuelva a vincular.
 */
async function flagChannel(channelId: string, detail: string, opts: { transient?: boolean } = {}): Promise<void> {
  if (opts.transient) transientFlag.add(channelId);
  else transientFlag.delete(channelId);
  try {
    await patchChannel(channelId, { last_error: `${ERROR_PREFIX}: ${detail}` });
  } catch {
    // si tampoco se puede escribir en la base, ya lo dijimos por consola
  }
}

/** La cola del canal quedó vacía: si el último error del canal era nuestro y transitorio, se saca. */
async function queueEmptied(channelId: string): Promise<void> {
  queued.delete(channelId);
  if (!transientFlag.delete(channelId)) return;
  await clearChannelError(channelId, ERROR_PREFIX).catch(() => {});
}

function labelOf(event: WorkerEvent): string {
  const id = "waMessageId" in event ? event.waMessageId : "targetMessageId" in event ? event.targetMessageId : null;
  return `${event.type}${id ? ` ${id}` : ""} (canal ${event.channelId})`;
}

/**
 * Avisa a la app de un evento. La lógica de negocio (crear el lead, derivar a
 * la sucursal, avisarle al operador) vive allá, no acá.
 *
 * Devuelve true si la app lo aceptó; false si quedó encolado o se descartó.
 */
export async function notifyApp(event: WorkerEvent): Promise<boolean> {
  const body = JSON.stringify(event);
  const label = labelOf(event);

  const appDown = Date.now() < appDownUntil;
  const behindOthers = (queued.get(event.channelId) ?? 0) > 0;
  if (appDown || behindOthers) {
    await stash(event, appDown ? "la app sigue caída" : "hay eventos anteriores en cola", 0);
    // si la app ya volvió, que salga todo ahora y en orden
    if (!appDown) drainOutbox(event.channelId).catch(() => {});
    return false;
  }

  const result = await deliver(body, label);
  if (result.ok) return true;

  console.error(`[notify] ${label}: ${result.detail}`);
  if (result.retryable) {
    appDownUntil = Date.now() + APP_DOWN_MS;
    await stash(event, result.detail, RETRY_DELAYS_MS.length + 1);
    await flagChannel(event.channelId, `${result.detail}. Queda encolado y se reintenta solo.`, { transient: true });
  } else {
    await flagChannel(event.channelId, result.detail);
  }
  return false;
}

async function stash(event: WorkerEvent, detail: string, attempts: number): Promise<void> {
  const row: OutboxRow = {
    event,
    stashed_at: new Date().toISOString(),
    last_error: detail,
    attempts,
  };
  const ok = await writeState(event.channelId, `${OUTBOX_PREFIX}${randomUUID()}`, row);
  if (ok) {
    queued.set(event.channelId, (queued.get(event.channelId) ?? 0) + 1);
    console.warn(`[notify] ${labelOf(event)}: encolado (${detail})`);
  }
}

/**
 * Antes de abrir el socket de un canal: cuántas filas viejas tiene en la cola.
 * `queued` nace vacío en cada arranque, y si el socket abre antes de que el
 * primer drenaje corrija el contador, los `append` que WhatsApp entrega al
 * conectar pasan por encima de lo que quedó encolado del proceso anterior.
 */
export async function primeQueue(channelId: string): Promise<void> {
  const n = await countState(OUTBOX_PREFIX, channelId);
  // si no se pudo contar, mejor no tocar lo que ya sabemos
  if (n == null) return;
  if (n > 0) queued.set(channelId, Math.max(queued.get(channelId) ?? 0, n));
}

/* ═══════════════════════════════════════════════════════════
   Drenaje de la cola
   ═══════════════════════════════════════════════════════════ */

/** Canales que se están drenando ahora: el timer y el "open" no se pisan. */
const draining = new Set<string>();
/** Canales a los que les entró algo mientras se drenaban: repasar al terminar. */
const redrain = new Set<string>();

function decrement(canal: string): void {
  queued.set(canal, Math.max(0, (queued.get(canal) ?? 1) - 1));
}

/**
 * Una fila que no va a salir nunca se saca del camino: se copia a
 * "dead-<uuid>" (con el motivo) y se borra la original. Si no se pudo copiar
 * no se borra: mejor una fila que traba la cola que una consulta que
 * desaparece sin rastro.
 */
async function bury(canal: string, key: string, value: OutboxRow, why: string): Promise<boolean> {
  const copied = await writeState(canal, `${DEAD_PREFIX}${randomUUID()}`, {
    ...value,
    original_key: key,
    dead_at: new Date().toISOString(),
    dead_reason: why,
  });
  if (!copied) return false;
  await deleteState(canal, key);
  decrement(canal);
  console.error(`[notify] ${labelOf(value.event)}: retirado de la cola (${why}); último error: ${value.last_error}`);
  await flagChannel(
    canal,
    `un evento (${value.event.type}) se retiró de la cola después de ${value.attempts} intentos: ${value.last_error}`,
  );
  return true;
}

/** Filas por vuelta de drenaje. Es el tope del listado global, no por canal. */
const OUTBOX_PAGE = 200;

/**
 * Manda lo que quedó encolado, en orden. Sin canal = todos los canales.
 *
 * Cada fila se intenta UNA vez (sin la escalera de reintentos): si la app sigue
 * caída no tiene sentido colgarse 26 s por evento; el próximo tick vuelve a
 * probar. Un 4xx acá sí borra la fila: si la app la rechaza por su forma, no va
 * a salir nunca, y una fila envenenada al principio de la cola frenaría todo lo
 * que viene atrás. Un 5xx repetido también tiene tope (bury).
 */
export async function drainOutbox(channelId?: string): Promise<void> {
  const rows = await listState(OUTBOX_PREFIX, channelId, { orderBy: "value->>stashed_at", limit: OUTBOX_PAGE });
  /* El listado es GLOBAL (todos los canales) y tiene tope: si vino lleno, lo
     que un canal ve como "su cola" puede ser solo la primera parte. Ahí no se
     puede declarar la cola vacía —rompería el FIFO justo en la caída larga—:
     se entrega lo listado y el próximo tick sigue. */
  const truncated = rows.length >= OUTBOX_PAGE;
  if (rows.length === 0) {
    if (channelId) {
      await queueEmptied(channelId);
    } else {
      queued.clear();
      for (const canal of [...transientFlag]) await queueEmptied(canal);
    }
    return;
  }

  const porCanal = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = porCanal.get(row.channel_id) ?? [];
    list.push(row);
    porCanal.set(row.channel_id, list);
  }

  await Promise.all(
    [...porCanal.entries()].map(async ([canal, pendientes]) => {
      if (draining.has(canal)) {
        // el drenaje en curso listó las filas antes de que entrara esta: que repase
        redrain.add(canal);
        return;
      }
      draining.add(canal);
      try {
        // lo que este proceso sabe de la cola se corrige con lo que hay en la base
        // (después de un reinicio el contador arranca en cero y las filas no)
        queued.set(canal, Math.max(queued.get(canal) ?? 0, pendientes.length));
        let enviados = 0;
        for (const row of pendientes) {
          const value = row.value as Partial<OutboxRow> | null;
          if (!value?.event) {
            await deleteState(canal, row.key);
            decrement(canal);
            continue;
          }
          const attempts = value.attempts ?? 0;
          const stashedAt = Date.parse(value.stashed_at ?? "");
          const age = Number.isFinite(stashedAt) ? Date.now() - stashedAt : 0;
          const why =
            attempts > MAX_ROW_ATTEMPTS
              ? `${attempts} intentos fallidos`
              : age > MAX_ROW_AGE_MS
                ? `lleva ${Math.round(age / 3_600_000)} h en la cola`
                : null;
          if (why) {
            const normalized: OutboxRow = {
              event: value.event,
              stashed_at: value.stashed_at ?? "",
              last_error: value.last_error ?? "",
              attempts,
            };
            if (await bury(canal, row.key, normalized, why)) continue;
            // no se pudo retirar: se intenta igual, y si no sale se para acá
          }

          const result = await post(JSON.stringify(value.event));
          if (result.ok) {
            await deleteState(canal, row.key);
            decrement(canal);
            appDownUntil = 0;
            enviados += 1;
            continue;
          }
          if (!result.retryable) {
            console.error(`[notify] ${labelOf(value.event)}: la app lo rechazó (${result.detail}); se descarta`);
            await deleteState(canal, row.key);
            decrement(canal);
            continue;
          }
          /* Sigue sin salir: se deja el resto para el próximo tick, en orden.
             La app se da por caída solo cuando la fila falla POR PRIMERA VEZ:
             una que ya venía fallando puede ser una fila envenenada con la app
             sana, y no puede mandar a la cola lo nuevo de los otros canales. */
          if (attempts === 0) appDownUntil = Date.now() + APP_DOWN_MS;
          await patchStateValue(canal, row.key, {
            ...value,
            last_error: result.detail,
            attempts: attempts + 1,
          });
          console.warn(`[notify] canal ${canal}: la app sigue sin responder (${result.detail}); ${pendientes.length - enviados} en cola`);
          return;
        }
        if (enviados > 0) console.log(`[notify] canal ${canal}: ${enviados} evento(s) encolado(s) entregados`);
        // se vació todo lo listado y nada entró mientras tanto: la cola está limpia
        if (!redrain.has(canal) && !truncated) await queueEmptied(canal);
      } finally {
        draining.delete(canal);
      }
      if (redrain.delete(canal)) await drainOutbox(canal);
    }),
  );
}

/** Cada 60 s, lo que haya quedado. `unref` para no retener el proceso al cerrar. */
export function scheduleOutboxDrain(): void {
  const timer = setInterval(() => {
    drainOutbox().catch((e) => console.error("[notify] drenaje:", e instanceof Error ? e.message : e));
  }, DRAIN_EVERY_MS);
  timer.unref();
}
