/**
 * Cliente del worker de Baileys (los números de las sucursales).
 *
 * SOLO SERVIDOR. El worker es un proceso aparte con las sesiones de WhatsApp
 * abiertas; acá solo le pedimos cosas por HTTP con un bearer compartido.
 * Si no está configurado, la app sigue andando: los mensajes se registran
 * igual y la UI avisa que el número no está vinculado.
 */

import { cache } from "react";
import {
  BAILEYS_SYNC_TYPES,
  type BaileysQuoted,
  type BaileysSendContent,
  type BaileysSendErrorCode,
  type BaileysSendRequest,
  type BaileysSendResponse,
} from "@/lib/wa/worker-contract";

const WORKER_URL = process.env.WA_WORKER_URL?.replace(/\/$/, "") ?? "";
const WORKER_TOKEN = process.env.WA_WORKER_TOKEN ?? "";

export function hasWorker(): boolean {
  return !!WORKER_URL && !!WORKER_TOKEN;
}

/**
 * Por qué falló, no solo que falló.
 *
 *   · `sin-configurar` — faltan las variables. Lo arregla quien deploya.
 *   · `sin-respuesta`  — hay URL pero del otro lado no hay nadie (proceso
 *                        caído, host mal escrito, timeout). Lo arregla quien
 *                        deploya, y NO es un problema del número.
 *   · `rechazado`      — el worker CONTESTÓ y dijo que no (bearer equivocado,
 *                        error de la sesión de Baileys). Eso sí es del canal.
 *
 * La distinción no es cosmética: `linkChannel` marcaba el canal como "con
 * problemas" cuando el que estaba caído era el servicio, y la sucursal quedaba
 * en rojo por algo que no tenía nada que ver con su número.
 */
export type WorkerFailure = "sin-configurar" | "sin-respuesta" | "rechazado";

export type WorkerResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; kind: WorkerFailure };

/* Los textos hablan del SERVICIO, no del "worker": del otro lado hay un
   vendedor que no deployó nada y solo quiere saber si el mensaje sale. El
   detalle técnico vive en la pantalla de Sucursales, que es donde el admin
   puede hacer algo al respecto. */
const NO_CONFIGURADO =
  "El servicio que maneja los números de las sucursales todavía no está configurado. Avisale a quien administra el sistema.";
const SIN_RESPUESTA =
  "El servicio que maneja los números de las sucursales no está respondiendo. Avisale a quien administra el sistema.";

type RawPayload = ({ ok?: boolean; error?: string } & Record<string, unknown>) | null;

/**
 * Lo que devuelve el HTTP crudo, antes de decidir qué significa. Está separado
 * de `call` porque el envío (`sendViaBaileys`) necesita leer el `code` que
 * manda el worker en un error y `call` lo aplastaba en un string.
 */
type RawResult =
  | { reached: true; status: number; payload: RawPayload }
  | { reached: false; timedOut: boolean };

async function request(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number },
): Promise<RawResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? 15_000);
  try {
    const res = await fetch(`${WORKER_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${WORKER_TOKEN}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    const payload = (await res.json().catch(() => null)) as RawPayload;
    return { reached: true, status: res.status, payload };
  } catch (error) {
    return {
      reached: false,
      timedOut: error instanceof Error && error.name === "AbortError",
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Un 502/503/504 suele ser el proxy del hosting diciendo que el proceso no
    está: a los fines del operador es lo mismo que no responder. */
function proxyCaido(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

async function call<T>(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number },
): Promise<WorkerResult<T>> {
  if (!hasWorker()) {
    return { ok: false, error: NO_CONFIGURADO, kind: "sin-configurar" };
  }
  const raw = await request(path, init);
  if (!raw.reached) {
    return raw.timedOut
      ? { ok: false, error: "El worker no respondió a tiempo.", kind: "sin-respuesta" }
      : { ok: false, error: SIN_RESPUESTA, kind: "sin-respuesta" };
  }
  if (raw.status >= 300 || !raw.payload?.ok) {
    /* Contestó: sea 401 o un error de la sesión, del otro lado hay alguien. */
    return {
      ok: false,
      error: raw.payload?.error ?? `El worker respondió ${raw.status}.`,
      kind: proxyCaido(raw.status) ? "sin-respuesta" : "rechazado",
    };
  }
  return { ok: true, data: raw.payload as T };
}

/* ═══════════════════════════════════════════════════════════
   ESTADO DEL SERVICIO
   ═══════════════════════════════════════════════════════════ */

/**
 * En qué anda el worker, de verdad.
 *
 * `hasWorker()` solo mira que existan dos variables de entorno, así que una URL
 * apuntando a un proceso que nunca se desplegó daba "listo": la pantalla ofrecía
 * "Vincular número" y el toque moría en un toast rojo. Esto pregunta.
 *
 * Cuando está caído se devuelve TAMBIÉN a dónde se intentó y qué pasó. Sin eso,
 * "el worker no responde" deja al admin adivinando entre tres cosas que se
 * arreglan en lugares distintos: el proceso apagado, la dirección mal cargada, o
 * la dirección apuntando a algo que no es el worker. Con el origen a la vista se
 * resuelve mirando.
 */
export type WorkerState =
  | { kind: "ok" }
  | { kind: "sin-configurar" }
  | { kind: "caido"; origen: string | null; motivo: string };

/** Solo esquema + host + puerto. El token NUNCA sale de acá. */
function origenDe(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * `localhost` en `WA_WORKER_URL` es el error más común y el más difícil de ver:
 * es el valor de ejemplo del `.env.example`, y desde un deploy en Vercel apunta
 * a la propia función serverless, donde no hay ningún worker escuchando.
 */
function esLocal(origen: string | null): boolean {
  if (!origen) return false;
  const host = new URL(origen).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
}

/**
 * Memoizado por render: la página de sucursales lo consulta una vez y todas las
 * cards comparten la respuesta. `cache()` de React solo dedupe dentro del mismo
 * render, que es exactamente lo que hace falta acá.
 *
 * El timeout es corto A PROPÓSITO: esto corre dentro de un Server Component y un
 * worker colgado no puede quedarse con el render de la pantalla. Si tarda más de
 * tres segundos en decir "estoy vivo", a los fines del operador está caído.
 */
export const workerState = cache(async function workerState(): Promise<WorkerState> {
  if (!hasWorker()) return { kind: "sin-configurar" };

  const origen = origenDe(WORKER_URL);
  if (!origen) {
    return {
      kind: "caido",
      origen: null,
      motivo: `La dirección cargada no es una URL válida: "${WORKER_URL.slice(0, 80)}". Tiene que ser completa y con https://.`,
    };
  }
  if (esLocal(origen)) {
    return {
      kind: "caido",
      origen,
      motivo:
        "Apunta a localhost, que desde el servidor de la app es el servidor mismo: ahí no hay ningún worker. Es el valor de ejemplo — hay que reemplazarlo por la dirección pública del worker.",
    };
  }

  try {
    const res = await fetch(`${WORKER_URL}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (res.ok) return { kind: "ok" };
    return {
      kind: "caido",
      origen,
      motivo: `Esa dirección contestó HTTP ${res.status} en /health. Existe algo ahí, pero no es el worker: revisá que la URL sea la del servicio del worker y no la de otra cosa.`,
    };
  } catch (error) {
    const tarde = error instanceof Error && error.name === "TimeoutError";
    return {
      kind: "caido",
      origen,
      motivo: tarde
        ? "No contestó en 3 segundos. El proceso puede estar arrancando o trabado."
        : "No se pudo conectar. O el proceso está apagado, o esa dirección no existe.",
    };
  }
});

/* ═══════════════════════════════════════════════════════════
   SESIONES
   ═══════════════════════════════════════════════════════════ */

export type SessionStatus = { running: boolean; connected: boolean; phone: string | null };

/** Arranca la sesión: si el número no está vinculado, el worker publica el QR. */
export function startChannel(channelId: string) {
  return call<SessionStatus>(`/sessions/${channelId}/start`, { method: "POST", timeoutMs: 25_000 });
}

/** Desvincula el número y borra las credenciales guardadas. */
export function logoutChannel(channelId: string) {
  return call<Record<string, never>>(`/sessions/${channelId}/logout`, { method: "POST" });
}

export function channelStatus(channelId: string) {
  return call<SessionStatus>(`/sessions/${channelId}/status`);
}

/* ═══════════════════════════════════════════════════════════
   ENVÍO
   ═══════════════════════════════════════════════════════════ */

/**
 * El envío que el worker aceptó. Es la mitad `ok: true` de
 * `BaileysSendResponse`: la otra mitad nunca sale de acá como dato, sale como
 * `fail(...)` con el texto ya traducido para el vendedor.
 */
export type BaileysSendAccepted = Extract<BaileysSendResponse, { ok: true }>;

/**
 * Resultado del envío. Tiene la forma de `ActionResult<BaileysSendAccepted>`
 * (las actions lo devuelven tal cual) con un dato más en el error: el `code`,
 * para quien quiera guardarlo o decidir por él. Los textos del `error` son
 * para el vendedor, no para el log.
 */
export type BaileysSendResult =
  | { ok: true; data: BaileysSendAccepted }
  | { ok: false; error: string; code: BaileysSendErrorCode | WorkerFailure };

/**
 * Qué le decimos al vendedor por cada motivo. Hablan de lo que él puede hacer
 * (revisar el celular, achicar el archivo) y no de lo que pasó adentro del
 * worker, que a él no le sirve de nada.
 */
const COPY_BY_CODE: Record<BaileysSendErrorCode, string> = {
  not_connected: "El número de la sucursal no está conectado.",
  no_whatsapp: "Ese número no tiene WhatsApp.",
  too_large: "El archivo es demasiado pesado para WhatsApp.",
  invalid_media: "WhatsApp no acepta ese tipo de archivo.",
  upload_failed: "No se pudo subir el archivo a WhatsApp. Probá de nuevo.",
  // el genérico del camino síncrono: WhatsApp dijo que no y el worker no supo
  // clasificarlo mejor
  send_failed: "WhatsApp no aceptó el mensaje. Probá de nuevo en un momento.",
  timeout: "No supimos si salió. Revisá el celular de la sucursal.",
  rate_limited:
    "WhatsApp está frenando los envíos de este número. Esperá un momento y probá de nuevo.",
  bad_request:
    "No se pudo armar el mensaje. Si sigue pasando, avisale a quien administra el sistema.",
};

const KNOWN_CODES = new Set<string>(Object.keys(COPY_BY_CODE));

function isSendErrorCode(code: unknown): code is BaileysSendErrorCode {
  return typeof code === "string" && KNOWN_CODES.has(code);
}

/** El texto en criollo de un código del worker (o el que venga, si no lo conocemos). */
export function baileysErrorCopy(
  code: BaileysSendErrorCode | string | null | undefined,
  fallback?: string | null,
): string {
  if (isSendErrorCode(code)) return COPY_BY_CODE[code];
  return fallback?.trim() || "WhatsApp rechazó el mensaje. Probá de nuevo.";
}

/**
 * Manda algo por el número de una sucursal (sin ventana de 24 hs).
 *
 * El timeout depende de lo que va: un texto, una reacción, una ubicación o un
 * contacto el worker los resuelve en la misma request (20 s). Un archivo lo
 * ACEPTA y lo termina en background —contesta 202 con `pending: true` y el
 * resultado llega después como evento `send_result`—, así que la espera acá es
 * por la aceptación, no por la subida; se le da un poco más porque antes de
 * aceptar valida el tamaño contra la URL firmada.
 *
 * Un timeout NO significa que no salió: significa que no lo sabemos. El texto
 * lo dice así para que el vendedor mire el celular antes de mandar de nuevo.
 */
export async function sendViaBaileys(
  channelId: string,
  req: BaileysSendRequest,
): Promise<BaileysSendResult> {
  if (!hasWorker()) return { ok: false, error: NO_CONFIGURADO, code: "sin-configurar" };

  const sync = BAILEYS_SYNC_TYPES.has(req.content.type);
  const raw = await request(`/sessions/${channelId}/send`, {
    method: "POST",
    body: req,
    timeoutMs: sync ? 20_000 : 25_000,
  });

  if (!raw.reached) {
    return raw.timedOut
      ? { ok: false, error: COPY_BY_CODE.timeout, code: "timeout" }
      : { ok: false, error: SIN_RESPUESTA, code: "sin-respuesta" };
  }

  /* El payload se lee campo por campo y no se castea entero al contrato: del
     otro lado hay otro deploy, y un worker viejo (o uno a medio actualizar)
     contesta con otra forma. Lo que no cierra se trata como rechazo. */
  const payload = raw.payload as {
    ok?: boolean;
    waMessageId?: unknown;
    pending?: unknown;
    error?: string;
    code?: unknown;
  } | null;

  if (raw.status < 300 && payload?.ok === true && typeof payload.waMessageId === "string") {
    return {
      ok: true,
      data: { ok: true, waMessageId: payload.waMessageId, pending: payload.pending === true },
    };
  }

  /* Contestó que no. Si trae un código del contrato se traduce; si no (un 401
     por bearer equivocado, un 500 de la sesión, el proxy diciendo que el
     proceso no está), vale lo que diga y se clasifica como antes. */
  const code = payload?.code;
  if (isSendErrorCode(code)) {
    return { ok: false, error: COPY_BY_CODE[code], code };
  }
  if (proxyCaido(raw.status)) {
    return { ok: false, error: SIN_RESPUESTA, code: "sin-respuesta" };
  }
  return {
    ok: false,
    error: payload?.error?.trim() || `El worker respondió ${raw.status}.`,
    code: "rechazado",
  };
}

/**
 * Un texto por el número de la sucursal: el caso de todos los días. Arma el
 * request para que los cuatro lugares que mandan texto (el chat, el puente
 * desde Instagram, el seguimiento automático y el aviso al operador) no
 * repitan la forma del contrato.
 *
 * `toLid` es para los hilos que WhatsApp entregó por LID sin número: ahí `to`
 * va vacío y el worker manda al Linked ID (ver `BaileysSendRequest.toLid`).
 * Los caminos que siempre tienen teléfono no lo usan.
 */
export function sendBaileysText(
  channelId: string,
  to: string,
  text: string,
  opts?: { quoted?: BaileysQuoted; clientRef?: string; toLid?: string | null },
): Promise<BaileysSendResult> {
  const content: BaileysSendContent = { type: "text", text };
  return sendViaBaileys(channelId, {
    to,
    content,
    ...(opts?.toLid ? { toLid: opts.toLid } : {}),
    ...(opts?.quoted ? { quoted: opts.quoted } : {}),
    ...(opts?.clientRef ? { clientRef: opts.clientRef } : {}),
  });
}
