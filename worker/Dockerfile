# Worker de WhatsApp (Baileys) — viajerOS
#
# Por qué existe este archivo: Baileys mantiene un WebSocket abierto contra
# WhatsApp, así que el worker NO puede vivir en serverless. Necesita un proceso
# que no se apague, y para eso hay que empaquetarlo. Sin esto, la app tiene la
# variable WA_WORKER_URL apuntando a un lugar que no existe y toda vinculación
# de sucursal muere en "No se pudo hablar con el worker de WhatsApp".
#
# Build en dos etapas: la primera compila el TypeScript, la segunda se queda
# solo con dist/ y las dependencias de producción. Baileys arrastra `sharp`
# (binarios nativos), así que las dos etapas usan la misma base Debian slim:
# con Alpine habría que compilar libvips a mano.

# ── 1. compilar ──────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── 2. correr ────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# --omit=dev deja afuera tsx y typescript: en runtime solo se ejecuta dist/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# El usuario `node` viene en la imagen. Correr como root un proceso con un
# WebSocket abierto contra internet no hace falta.
USER node

# Informativo: la plataforma inyecta PORT y config.ts lo lee (default 8088).
EXPOSE 8088

# El health check es el mismo que usa el hosting: /health no pide bearer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8088)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
