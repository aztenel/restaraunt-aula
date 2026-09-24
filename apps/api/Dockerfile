# syntax=docker/dockerfile:1.7
#
# Образ backend AULA. Один образ — четыре роли (выбираются командой контейнера):
#   api      node dist/main.js         (по умолчанию, порт 3000)
#   worker   node dist/worker.js       (очереди BullMQ, outbox, расписания; HTTP не слушает)
#   migrate  node dist/cli/migrate.js  (миграции только вперёд; одноразовый контейнер перед api)
#   seed     node dist/cli/seed.js     (стартовые данные; SEED_DEMO=true — демо для dev/staging)
#
# Сборка из корня репозитория:
#   docker build -f apps/api/Dockerfile -t aula-api:dev .

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------
# base: Node.js + pnpm той же версии, что в packageManager корневого package.json
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION=10.33.0
ENV PNPM_HOME=/pnpm \
    CI=true
RUN npm install --global --no-fund --no-audit "pnpm@${PNPM_VERSION}" \
 && npm cache clean --force
WORKDIR /repo

# ---------------------------------------------------------------------------
# build: зависимости строго по lockfile, компиляция tsc, prod-сборка через pnpm deploy
# ---------------------------------------------------------------------------
FROM base AS build
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# 1) Скачать пакеты только по lockfile: слой кэшируется, пока не меняется pnpm-lock.yaml.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch --store-dir /pnpm/store

# 2) Исходники (см. .dockerignore) и установка офлайн с --frozen-lockfile:
#    расхождение package.json и lockfile валит сборку.
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --store-dir /pnpm/store --filter "@aula/api..."

# 3) tsc + копирование SQL-миграций и шрифтов в dist (scripts/copy-assets.mjs).
RUN pnpm --filter @aula/api build \
 && test -f apps/api/dist/main.js \
 && test -f apps/api/dist/worker.js \
 && test -f apps/api/dist/cli/migrate.js \
 && test -f apps/api/dist/cli/seed.js \
 && test -n "$(find apps/api/dist -path '*/migrations/*.sql' -print -quit)" \
 && test -d apps/api/dist/assets/fonts

# 4) Только production-зависимости в отдельный каталог.
#    --legacy: воркспейс не использует inject-workspace-packages (pnpm 10).
#    dist копируем явно: pnpm deploy берёт файлы пакета по правилам npm pack (dist в .gitignore).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @aula/api deploy --prod --legacy --store-dir /pnpm/store /out \
 && rm -rf /out/src /out/test /out/scripts /out/dist /out/.swcrc /out/nest-cli.json \
           /out/eslint.config.mjs /out/vitest.config.ts /out/tsconfig*.json /out/Dockerfile /out/.env.example \
 && cp -a apps/api/dist /out/dist

# ---------------------------------------------------------------------------
# runtime: slim-образ, непривилегированный пользователь, только dist + prod node_modules
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS=--enable-source-maps

WORKDIR /app
# Файлы принадлежат root и доступны процессу только на чтение.
COPY --from=build /out ./

# Пользователь node (uid 1000) из базового образа.
USER 1000:1000
EXPOSE 3000

# Жив ли процесс API. Готовность (БД + Redis) — /api/v1/health/ready, её проверяют деплой и мониторинг.
# Для worker/migrate/seed healthcheck отключается в docker-compose (HTTP они не слушают).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# Версия релиза (тег git) — для Sentry и /health/live. docker-compose.prod.yml также задаёт RELEASE=${TAG}.
ARG RELEASE=dev
ENV RELEASE=${RELEASE}
LABEL org.opencontainers.image.title="aula-api" \
      org.opencontainers.image.description="AULA backend: API, worker, миграции, сиды" \
      org.opencontainers.image.version="${RELEASE}"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
