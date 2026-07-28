/**
 * Cliente del worker de Baileys (los números de las sucursales).
 *
 * SOLO SERVIDOR. El worker es un proceso aparte con las sesiones de WhatsApp
 * abiertas; acá solo le pedimos cosas por HTTP con un bearer compartido.
 * Si no está configurado, la app sigue andando: los mensajes se registran
 * igual y la UI avisa que el número no está vinculado.
 */

const WORKER_URL = process.env.WA_WORKER_URL?.replace(/\/$/, "") ?? "";
const WORKER_TOKEN = process.env.WA_WORKER_TOKEN ?? "";

export function hasWorker(): boolean {
  return !!WORKER_URL && !!WORKER_TOKEN;
}

export type WorkerResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number },
): Promise<WorkerResult<T>> {
  if (!hasWorker()) {
    return { ok: false, error: "El worker de WhatsApp no está configurado." };
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
      return { ok: false, error: payload?.error ?? `El worker respondió ${res.status}.` };
    }
    return { ok: true, data: payload as T };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "El worker no respondió a tiempo." };
    }
    return { ok: false, error: "No se pudo hablar con el worker de WhatsApp." };
  } finally {
    clearTimeout(timeout);
  }
}

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
