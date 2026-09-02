import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { listBaileysChannels } from "./supabase.js";
import {
  bootSessions,
  logoutSession,
  sendText,
  sessionState,
  shutdownAll,
  startSession,
  stopSession,
} from "./session.js";

/**
 * Worker multitenant de WhatsApp para viajerOS.
 *
 * Una sesión de Baileys por canal (= por sucursal), todas en el mismo proceso.
 * La app se autentica con el bearer WA_WORKER_TOKEN; el worker le avisa de los
 * mensajes entrantes firmando con WA_WEBHOOK_SECRET.
 *
 *   POST /sessions/:id/start    → vincular / reconectar (devuelve estado)
 *   POST /sessions/:id/logout   → desvincular (borra credenciales)
 *   POST /sessions/:id/stop     → cerrar sin desvincular
 *   GET  /sessions/:id/status   → { running, connected, phone }
 *   POST /sessions/:id/send     → { to, text } → { waMessageId }
 *   GET  /health
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
    if (size > 256 * 1024) return null; // un mensaje de WhatsApp nunca pesa esto
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
    return;
  }

  if (!authorized(req)) {
    json(res, 401, { ok: false, error: "No autorizado" });
    return;
  }

  // /sessions/:channelId/:action
  if (parts[0] !== "sessions" || parts.length < 3) {
    json(res, 404, { ok: false, error: "Ruta inexistente" });
    return;
  }

  const channelId = parts[1];
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
      const body = await readJson<{ to?: string; text?: string }>(req);
      if (!body?.to || !body?.text) {
        json(res, 400, { ok: false, error: "Faltan `to` o `text`" });
        return;
      }
      const result = await sendText(channelId, body.to, body.text);
      json(res, 200, { ok: true, ...result });
      return;
    }

    json(res, 404, { ok: false, error: "Ruta inexistente" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error(`[http] ${req.method} ${url.pathname}:`, message);
    json(res, 500, { ok: false, error: message });
  }
});

server.listen(config.port, async () => {
  console.log(`[worker] escuchando en :${config.port} — app: ${config.appUrl}`);
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
});

/**
 * Apagado ordenado. El orden importa: primero se deja de aceptar pedidos (si no,
 * la app puede pedir un envío mientras las sesiones se están cerrando y recibe
 * un error que no significa nada), después se cierran las sesiones de Baileys.
 *
 * El `exit` forzado queda como red: un socket colgado de Baileys puede impedir
 * que el proceso termine solo, y un contenedor que no muere en el plazo del
 * hosting se lleva un SIGKILL en el medio del cierre.
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
