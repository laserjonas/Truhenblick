# syntax=docker/dockerfile:1
#
# Truhenblick – Sync-Backend (Node + SQLite)
# Der Build-Kontext ist das Projektverzeichnis, weil das Backend den Ordner shared/ mitbenutzt:
#
#   docker build -f server/Dockerfile -t truhenblick-api .
#
# Node führt die TypeScript-Dateien direkt aus – ein Übersetzungsschritt entfällt.
# better-sqlite3 bringt fertige Binärdateien für x64 und ARM64 mit, es wird nichts kompiliert.

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY shared/package.json shared/types.ts shared/sync.ts shared/validierung.ts shared/
COPY server/src server/src

RUN mkdir -p /data && chown node:node /data
USER node

ENV DATA_DIR=/data \
    PORT=3000 \
    HOST=0.0.0.0
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.ts"]
