import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { listBaileysChannels } from "./supabase.js";
import {
  bootSessions,
  logoutSession,
  sessionState,
  shutdownAll,
  startSession,
  stopSession,
} from "./session.js";
import { failOrphanedSends, parseSendRequest, sendContent } from "./outbound.js";
import { scheduleOutboxDrain } from "./notify.js";
import { warnIfContractDiverged } from "./contract-check.js";
import type { BaileysSendErrorCode } from "./contract.js";

/**
 * Worker multitenant de WhatsApp para viajerOS.
 *
 * Una sesión de Baileys por canal (= por sucursal), todas en el mismo proceso.
 * La app se autentica con el bearer WA_WORKER_TOKEN; el worker le avisa de lo
 * que pasa en cada número (WorkerEvent, ver contract.ts) firmando con
 * WA_WEBHOOK_SECRET.
 *
 *   POST /sessions/:id/start    → vincular / reconectar (devuelve estado)
 *   POST /sessions/:id/logout   → desvincular (borra credenciales)
 *   POST /sessions/:id/stop     → cerrar sin desvincular
 *   GET  /sessions/:id/status   → { running, connected, phone }
 *   POST /sessions/:id/send     → BaileysSendRequest → BaileysSendResponse
 *                                 (200 resuelto · 202 media aceptada, termina
 *                                 con un evento send_result)
 *   GET  /health
 *
 * Errores de envío: { ok: false, error, code } con el código del contrato. Los
 * de infraestructura (401, 404, un 500 fuera de /send) van SIN `code`: la app
 * traduce cada código a un texto para el vendedor ("No se pudo armar el
 * mensaje"…) y con eso escondía el motivo real —un bearer mal cargado se veía
 * como un problema del mensaje. Sin `code` la app muestra `error` tal cual,
 * clasificado como "rechazado", que es lo que es.
 */

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function authorized(req: IncomingMessage): boolean {
  // Comparación en tiempo constante, igual que la del lado app
  // (src/app/api/wa/baileys/events/route.ts): con `===` el cortocircuito filtra
  // cuántos caracteres del bearer acertó quien prueba, y esta ruta es pública.
  const expected = Buffer.from(`Bearer ${config.workerToken}`, "utf8");
  const got = Buffer.from(req.headers.authorization ?? "", "utf8");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

async function readJson<T>(req: IncomingMessage): Promise<T | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // El body es JSON chico: los adjuntos viajan como URL firmada, nunca como bytes
    if (size > 256 * 1024) return null;
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Código HTTP por código del contrato. Ojo con 502/503/504: la app los lee como
 * "el worker no está" (src/lib/wa/worker.ts) y culpa al servicio en vez de al
 * número, así que ningún error de envío puede usar esos.
 */
const HTTP_BY_CODE: Record<BaileysSendErrorCode, number> = {
  bad_request: 400,
  invalid_media: 400,
  too_large: 413,
  no_whatsapp: 422,
  not_connected: 409,
  rate_limited: 429,
  timeout: 500,
  upload_failed: 500,
  send_failed: 500,
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
    return;
  }

  if (!authorized(req)) {
    json(res, 401, { ok: false, error: "El worker rechazó el bearer: WA_WORKER_TOKEN no coincide entre la app y el worker." });
    return;
  }

  // /sessions/:channelId/:action
  if (parts[0] !== "sessions" || parts.length < 3) {
    json(res, 404, { ok: false, error: `El worker no tiene la ruta ${url.pathname}.` });
    return;
  }

  const channelId = parts[1]!;
  const action = parts[2];

  try {
    if (req.method === "GET" && action === "status") {
      json(res, 200, { ok: true, ...sessionState(channelId) });
      return;
    }

    if (req.method === "POST" && action === "start") {
      // force: este endpoint solo lo llama la app cuando una persona tocó
      // "Vincular número" / "Vincular de nuevo". Ahí lo que se espera es un QR
      // nuevo YA, no que se respete el backoff de una sesión que viene fallando
      // (desde el sexto intento, 60 s fijos de espera).
      await startSession(channelId, { force: true });
      json(res, 200, { ok: true, ...sessionState(channelId) });
      return;
    }

    if (req.method === "POST" && action === "stop") {
      await stopSession(channelId);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && action === "logout") {
      await logoutSession(channelId);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && action === "send") {
      const body = await readJson<unknown>(req);
      const parsed = parseSendRequest(body);
      if (!parsed.ok) {
        json(res, 400, { ok: false, error: parsed.error, code: "bad_request" });
        return;
      }
      const result = await sendContent(channelId, parsed.req);
      if (!result.ok) {
        json(res, HTTP_BY_CODE[result.code], result);
        return;
      }
      json(res, result.pending ? 202 : 200, result);
      return;
    }

    json(res, 404, { ok: false, error: `El worker no tiene la ruta ${req.method} ${url.pathname}.` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error(`[http] ${req.method} ${url.pathname}:`, message);
    // solo /send lleva código: ahí la app espera uno del contrato para la burbuja
    json(res, 500, action === "send" ? { ok: false, error: message, code: "send_failed" } : { ok: false, error: message });
  }
});

server.listen(config.port, async () => {
  console.log(`[worker] escuchando en :${config.port} — app: ${config.appUrl}`);
  await warnIfContractDiverged();
  scheduleOutboxDrain();
  const channels = await listBaileysChannels();
  // 'error' es lo que deja un corte transitorio (session.ts: patchChannel con
  // "Se cortó la conexión… Reintentando"). Si el worker reinicia dentro de esa
  // ventana —un deploy, por ejemplo— la sesión tiene que volver sola igual que
  // una 'conectado': si no, la sucursal queda muda para siempre hasta que un
  // admin entre a Configuración a tocar el botón.
  // 'desconectado' y 'vinculando' NO se levantan a propósito: el primero es una
  // desvinculación deliberada (las credenciales ya se borraron) y el segundo es
  // un QR que nunca se escaneó y ya venció.
  const toBoot = channels
    .filter((c) => c.status === "conectado" || c.status === "error")
    .map((c) => c.id);
  if (toBoot.length > 0) {
    console.log(`[worker] levantando ${toBoot.length} sesión(es) ya vinculadas`);
    await bootSessions(toBoot);
  }
  // Media aceptada con 202 que el proceso anterior no llegó a cerrar: la app
  // tiene esas filas en "pendiente" y nadie más se lo va a decir.
  await failOrphanedSends().catch((e) => console.error("[worker] envíos huérfanos:", e instanceof Error ? e.message : e));
});

/**
 * Apagado ordenado. El orden importa: primero se deja de aceptar pedidos (si no,
 * la app puede pedir un envío mientras las sesiones se están cerrando y recibe
 * un error que no significa nada), después shutdownAll espera hasta 8 s a que
 * terminen las colas (descargas, uploads, avisos) y recién ahí cierra los
 * sockets de Baileys.
 *
 * El `exit` forzado a los 10 s queda como red: un socket colgado de Baileys
 * puede impedir que el proceso termine solo, y un contenedor que no muere en el
 * plazo del hosting (Railway: 10 s) se lleva un SIGKILL en el medio del cierre.
 */
let cerrando = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (cerrando) return;
    cerrando = true;
    console.log(`[worker] ${signal}: cerrando sesiones…`);
    const forzar = setTimeout(() => {
      console.warn("[worker] el cierre tardó demasiado: salgo igual");
      process.exit(0);
    }, 10_000);
    forzar.unref();
    server.close();
    shutdownAll().finally(() => process.exit(0));
  });
}
