# syntax=docker/dockerfile:1
#
# Truhenblick – Web-App (statisch, ausgeliefert von Caddy)
#
#   docker build -t truhenblick-web .
#   docker buildx build --platform linux/amd64,linux/arm64 -t truhenblick-web .

# --- Bauen -------------------------------------------------------------------
# Läuft immer auf der Architektur des Build-Rechners: Das Ergebnis sind statische
# Dateien, die auf jeder Zielarchitektur gleich sind. So bleibt auch der Bau für
# ARM64 schnell und kommt ohne Emulation aus.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# --- Ausliefern --------------------------------------------------------------
FROM caddy:2-alpine
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv

# SITE_ADDRESS: „:80“ (Standard, hinter eigenem Reverse Proxy) oder eine Domain –
#               dann besorgt Caddy selbst ein HTTPS-Zertifikat.
# API_UPSTREAM: Adresse des Sync-Backends für /api/*
ENV SITE_ADDRESS=:80 \
    API_UPSTREAM=api:3000

EXPOSE 80 443
# Caddys Verwaltungsschnittstelle ist nur im Container erreichbar und antwortet, solange Caddy läuft.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:2019/config/ || exit 1
