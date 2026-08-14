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
| `POST /sessions/:channelId/send` | `{ to, text }` → `{ waMessageId }` |
| `GET /health` | sin auth, para el health check del hosting |

Los mensajes entrantes se mandan a `POST {APP_URL}/api/wa/baileys/events`
firmados con HMAC-SHA256 en el header `x-wa-signature`.

## Aviso honesto

Baileys es una implementación no oficial del protocolo de WhatsApp Web. Usalo
con números propios de la agencia y con criterio: mandar spam o volúmenes raros
puede hacer que WhatsApp bloquee el número. Para eso está el número madre
oficial: recibe el primer contacto, y la sucursal sigue una charla humana.
