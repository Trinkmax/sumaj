/**
 * Cliente del worker de Baileys (los números de las sucursales).
 *
 * SOLO SERVIDOR. El worker es un proceso aparte con las sesiones de WhatsApp
 * abiertas; acá solo le pedimos cosas por HTTP con un bearer compartido.
 * Si no está configurado, la app sigue andando: los mensajes se registran
 * igual y la UI avisa que el número no está vinculado.
 */

import { cache } from "react";

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

async function call<T>(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number },
): Promise<WorkerResult<T>> {
  if (!hasWorker()) {
    return { ok: false, error: NO_CONFIGURADO, kind: "sin-configurar" };
  }
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
    const payload = (await res.json().catch(() => null)) as
      | ({ ok?: boolean; error?: string } & Record<string, unknown>)
      | null;
    if (!res.ok || !payload?.ok) {
      /* Contestó: sea 401 o un error de la sesión, del otro lado hay alguien.
         Un 502/503 en cambio suele ser el proxy del hosting diciendo que el
         proceso no está: eso es lo mismo que no responder. */
      const proxyCaido = res.status === 502 || res.status === 503 || res.status === 504;
      return {
        ok: false,
        error: payload?.error ?? `El worker respondió ${res.status}.`,
        kind: proxyCaido ? "sin-respuesta" : "rechazado",
      };
    }
    return { ok: true, data: payload as T };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "El worker no respondió a tiempo.", kind: "sin-respuesta" };
    }
    return { ok: false, error: SIN_RESPUESTA, kind: "sin-respuesta" };
  } finally {
    clearTimeout(timeout);
  }
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
 */
export type WorkerState = "ok" | "sin-configurar" | "caido";

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
  if (!hasWorker()) return "sin-configurar";
  try {
    const res = await fetch(`${WORKER_URL}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok ? "ok" : "caido";
  } catch {
    return "caido";
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

/** Envía un texto por el número de la sucursal (sin ventana de 24 hs). */
export function sendViaBaileys(channelId: string, to: string, text: string) {
  return call<{ waMessageId: string | null }>(`/sessions/${channelId}/send`, {
    method: "POST",
    body: { to, text },
    timeoutMs: 20_000,
  });
}
