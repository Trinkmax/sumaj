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
