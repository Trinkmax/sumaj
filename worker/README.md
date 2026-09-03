# viajerOS — worker de WhatsApp (Baileys)

Mantiene **una sesión de WhatsApp por sucursal** y le avisa a la app cuando entra
un mensaje. Es lo que permite que el seguimiento no cueste: por el número de la
sucursal no hay ventana de 24 hs ni plantillas pagas de Meta.

```
cliente ──▶ NÚMERO MADRE (Cloud API)          la app contesta sola y deriva
                    │
                    ▼
            SUCURSAL (este worker)            el operador sigue la charla, gratis
```

## Por qué es un proceso aparte

Baileys mantiene un WebSocket abierto contra WhatsApp. Eso **no funciona en
serverless** (Vercel): necesita un proceso que no se apague. Se despliega en
Railway / Fly / Render / un VPS con pm2 o Docker.

El estado de cada sesión (las credenciales del número vinculado) se guarda en
Postgres, en la tabla `wa_session_state`. Si el worker se reinicia, levanta las
sesiones solo: **no hay que volver a escanear el QR**.

La misma tabla es la memoria de trabajo del worker, para que un reinicio no
pierda nada (ver el comentario largo en `src/supabase.ts`):

| Clave | Qué es |
|---|---|
| `lid-<lid>` | LID → teléfono. Se escribe por canal y se lee en cualquiera: el LID de una persona es el mismo para todos los números |
| `outbox-<uuid>` | avisos a la app que no salieron. FIFO por `stashed_at`; se drenan al reconectar y cada 60 s |
| `inbox-<id>` | entrantes a medio procesar (write-ahead). Se anotan antes de bajar el adjunto y se borran al confirmar; al reconectar se reponen |
| `pending-<id>` | media aceptada con 202 y sin resultado todavía. Al arrancar, lo que quedó se avisa como fallido |
| `dead-<uuid>` | lo que se rindió (30 intentos o 24 h): no se reintenta, queda para mirarlo |

## Configuración

```bash
cd worker
npm install
cp .env.example .env   # completá las variables
npm run dev            # o: npm run build && npm start
```

| Variable | Para qué |
|---|---|
| `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` | guardar el estado de las sesiones |
| `APP_URL` | adónde avisarle de los mensajes entrantes |
| `WA_WEBHOOK_SECRET` | firma HMAC de los eventos worker → app |
| `WA_WORKER_TOKEN` | bearer con el que la app le habla al worker |
| `WA_DEVICE_NAME` | nombre que ve el operador en "Dispositivos vinculados" |

Los dos secretos tienen que ser **los mismos** que en el `.env.local` de la app
(`WA_WEBHOOK_SECRET` y `WA_WORKER_TOKEN`), y la app tiene que apuntar acá con
`WA_WORKER_URL`.

## Desplegarlo (esto es lo que falta si "no anda el worker")

El síntoma clásico —la app dice *"El servicio que maneja los números de las
sucursales no está respondiendo"* al tocar **Vincular número**— casi siempre es
uno de estos dos, y ninguno se arregla desde la app:

1. **`WA_WORKER_URL` quedó en `http://localhost:8088`** (el valor de ejemplo).
   Desde un deploy en Vercel, `localhost` es la propia función serverless: no hay
   nada escuchando ahí. Tiene que ser la dirección pública del worker.
2. **El worker nunca se desplegó.** Es un proceso aparte: no viaja con la app.

### Railway (lo más corto)

```bash
railway init            # dentro de /worker
railway up              # usa el Dockerfile de esta carpeta
```

En **Settings → Root Directory** poné `worker` si el repo es el monorepo entero.
El `railway.json` ya deja armado el health check contra `/health` y el reinicio
automático. Después, en **Variables**, cargá las cinco de la tabla de arriba
(`APP_URL` es la URL pública de la app, **no** localhost) y copiá el dominio que
te da Railway a la `WA_WORKER_URL` de la app. **Redeploy de la app**: las envs se
leen en el servidor y sin redeploy no toman efecto.

### Cualquier otro lado (Fly, Render, un VPS)

```bash
docker build -t viajeros-wa-worker .
docker run -p 8088:8088 --env-file .env viajeros-wa-worker
```

### Una sola instancia, siempre

`numReplicas: 1` no es una economía: cada sesión de Baileys es **un dispositivo
vinculado** con estado en memoria. Dos réplicas levantando la misma sesión se
pelean por el socket y WhatsApp termina cerrando las dos. Si algún día hace falta
escalar, se escala por sharding de canales, no por réplicas.

### Apagado

Ante `SIGTERM` el worker deja de aceptar pedidos, espera hasta 8 s a que
terminen las colas (descargas, uploads, avisos) y recién ahí cierra los
sockets; a los 10 s sale igual. Lo que no llegó a terminar no se pierde: los
entrantes a medias (`inbox-`) y la media pendiente (`pending-`) se resuelven en
el próximo arranque.

### Cómo saber si está vivo

```bash
curl https://TU-WORKER/health     # -> {"ok":true,"uptime":123}
```

`/health` es la única ruta sin bearer, justamente para esto. La pantalla de
**Configuración → Sucursales** la consulta en cada carga: si no contesta en 3
segundos, muestra el aviso de servicio caído en vez de ofrecer el QR.

## Cómo se vincula una sucursal

1. En la app: **Configuración → Sucursales → Vincular número**.
2. La app le pide al worker que abra la sesión; el worker publica el QR en
   `wa_channels.qr` y la pantalla lo muestra.
3. El operador lo escanea desde el celular de la sucursal
   (WhatsApp → Dispositivos vinculados → Vincular un dispositivo).
4. El canal queda `conectado` y ya se puede escribir desde el CRM.

## API

Todas las rutas piden `Authorization: Bearer $WA_WORKER_TOKEN`.

| Ruta | Qué hace |
|---|---|
| `POST /sessions/:channelId/start` | vincula o reconecta (publica el QR) |
| `POST /sessions/:channelId/logout` | desvincula y borra credenciales |
| `POST /sessions/:channelId/stop` | cierra la sesión sin desvincular |
| `GET /sessions/:channelId/status` | `{ running, connected, phone }` |
| `POST /sessions/:channelId/send` | `BaileysSendRequest` → `BaileysSendResponse` (ver abajo) |
| `GET /health` | sin auth, para el health check del hosting |

Los eventos (mensaje entrante, reacción, borrado, edición, recibo, resultado de
un envío pendiente: `WorkerEvent`) se mandan a `POST {APP_URL}/api/wa/baileys/events`
firmados con HMAC-SHA256 en el header `x-wa-signature`.

### `/send`

El body es un `BaileysSendRequest` del contrato (`src/contract.ts`, copia byte
a byte de `src/lib/wa/worker-contract.ts` de la app):

```jsonc
{
  "to": "5493511234567",        // dígitos; puede ir vacío si hay toLid
  "toLid": "24623097851954",    // el chat llegó por LID sin número: se manda a <lid>@lid
  "clientRef": "…",             // opcional, solo para logs
  "quoted": { "id": "…", "fromMe": false, "text": "…" },   // opcional
  "content": { "type": "text", "text": "Hola" }
}
```

`content` es discriminado por `type`: `text`, `image`, `video`, `audio`,
`document`, `sticker` (con `url` firmada del bucket `attachments`), `location`,
`contact` y `reaction`. Dos velocidades:

- **texto, reacción, ubicación, contacto** se resuelven en la misma request:
  `200 { ok, waMessageId, pending: false }`. El worker espera hasta 15 s
  (la app corta a los 20); un `timeout` **no cancela** el envío en Baileys, el
  mensaje puede salir igual.
- **media** se acepta y se termina en background: `202 { ok, waMessageId,
  pending: true }`, y el resultado llega después como evento `send_result`.
  Un upload por vez por sesión, 5 minutos de presupuesto desde el 202.

Errores de envío: `{ ok: false, error, code }` con `code` del contrato
(`not_connected`, `no_whatsapp`, `invalid_media`, `too_large`, `upload_failed`,
`send_failed`, `timeout`, `rate_limited`, `bad_request`). Un 401 (bearer mal
cargado) o un 404 van sin `code`, con el motivo en `error`.

## Aviso honesto

Baileys es una implementación no oficial del protocolo de WhatsApp Web. Usalo
con números propios de la agencia y con criterio: mandar spam o volúmenes raros
puede hacer que WhatsApp bloquee el número. Para eso está el número madre
oficial: recibe el primer contacto, y la sucursal sigue una charla humana.
