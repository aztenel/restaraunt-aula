# syntax=docker/dockerfile:1.7
#
# Образ админ-панели AULA: vite build → статика, раздаётся Caddy (непривилегированный пользователь, порт 8080).
# SPA-fallback на index.html, долгий кэш для хэшированных /assets/*, index.html — no-cache.
#
# Переменные VITE_* встраиваются при сборке, поэтому образ собирается под окружение
# с build-args из ops/build-env/<env>.env (см. .github/workflows/deploy.yml).
#
#   docker build -f apps/admin/Dockerfile --build-arg VITE_API_URL=https://admin.aula.kz -t aula-admin:dev .

ARG NODE_IMAGE=node:22-bookworm-slim
ARG CADDY_IMAGE=caddy:2.11-alpine

FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION=10.33.0
ENV PNPM_HOME=/pnpm \
    CI=true
RUN npm install --global --no-fund --no-audit "pnpm@${PNPM_VERSION}" \
 && npm cache clean --force
WORKDIR /repo

# ---------------------------------------------------------------------------
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch --store-dir /pnpm/store

COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --store-dir /pnpm/store --filter "@aula/admin..."

# Публичные параметры сборки (попадают в браузер).
ARG VITE_API_URL
ARG VITE_SENTRY_DSN
ARG VITE_MAP_TILES_URL
ARG VITE_ENVIRONMENT
ARG RELEASE=dev
ENV VITE_RELEASE=${RELEASE}

RUN pnpm --filter @aula/admin build \
 && test -f apps/admin/dist/index.html

# ---------------------------------------------------------------------------
FROM ${CADDY_IMAGE} AS runtime
# Убираем file capability у бинарника caddy: порт 8080 не требует привилегий,
# а без неё контейнер запускается и с cap_drop: [ALL] / no-new-privileges.
RUN apk add --no-cache libcap \
 && setcap -r /usr/bin/caddy \
 && apk del libcap \
 && addgroup -S -g 10001 app \
 && adduser -S -D -H -u 10001 -G app app \
 && mkdir -p /data /config \
 && chown -R app:app /data /config

COPY ops/caddy/admin-static.Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/admin/dist /srv

USER app
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

ARG RELEASE=dev
LABEL org.opencontainers.image.title="aula-admin" \
      org.opencontainers.image.description="AULA: админ-панель (React SPA, статика)" \
      org.opencontainers.image.version="${RELEASE}"

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
