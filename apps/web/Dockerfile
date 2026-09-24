# syntax=docker/dockerfile:1.7
#
# Образ витрины AULA (Next.js 15, SSR). Требует output: 'standalone' в apps/web/next.config.*
# (и outputFileTracingRoot = корень монорепозитория — тогда в образ попадёт @aula/api-client).
#
# Переменные NEXT_PUBLIC_* встраиваются в клиентский бандл ПРИ СБОРКЕ, поэтому образ собирается
# под окружение (staging/production) с build-args из ops/build-env/<env>.env — см. .github/workflows/deploy.yml.
# Серверные переменные (API_INTERNAL_URL и т.п.) читаются при запуске из env/web.env.
#
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://aula.kz --build-arg NEXT_PUBLIC_SITE_URL=https://aula.kz \
#     -t aula-web:dev .

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION=10.33.0
ENV PNPM_HOME=/pnpm \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
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
    pnpm install --frozen-lockfile --offline --store-dir /pnpm/store --filter "@aula/web..."

# Публичные параметры сборки (попадают в браузер; секретов здесь быть не может).
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_ENVIRONMENT
ARG NEXT_PUBLIC_GA_ID
ARG NEXT_PUBLIC_YM_ID
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_MAP_PROVIDER
ARG NEXT_PUBLIC_YANDEX_MAPS_API_KEY
ARG NEXT_PUBLIC_2GIS_API_KEY
ARG NEXT_PUBLIC_MAP_TILES_URL
ARG RELEASE=dev
ENV NEXT_PUBLIC_RELEASE=${RELEASE}

# SENTRY_AUTH_TOKEN (необязательно) — загрузка source maps в Sentry; передаётся как BuildKit-секрет
# и не остаётся в слоях образа: docker build --secret id=sentry_auth_token,env=SENTRY_AUTH_TOKEN ...
RUN --mount=type=secret,id=sentry_auth_token,required=false \
    mkdir -p apps/web/public \
 && SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" \
    pnpm --filter @aula/web build

# Раскладка standalone: при outputFileTracingRoot = корень монорепо сервер лежит в apps/web/server.js,
# иначе — в корне standalone. Нормализуем в /out с точкой входа /out/server.js.
RUN set -eu; \
    cd apps/web/.next/standalone; \
    if [ -f apps/web/server.js ]; then app_dir=apps/web; \
    elif [ -f server.js ]; then app_dir=.; \
    else echo "Нет .next/standalone/**/server.js: задайте output: 'standalone' в apps/web/next.config" >&2; exit 1; fi; \
    mkdir -p /out; \
    cp -a . /out/; \
    mkdir -p "/out/${app_dir}/.next"; \
    cp -a /repo/apps/web/.next/static "/out/${app_dir}/.next/static"; \
    cp -a /repo/apps/web/public "/out/${app_dir}/public"; \
    if [ "${app_dir}" != "." ]; then printf "require('./%s/server.js');\n" "${app_dir}" > /out/server.js; fi

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0

WORKDIR /app
COPY --from=build /out ./

USER node
EXPOSE 3001

# Сервер Next.js отвечает (любой статус < 500). Рекомендуемый лёгкий маршрут — GET /api/health в apps/web.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health',{redirect:'manual'}).then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"

ARG RELEASE=dev
ENV RELEASE=${RELEASE}
LABEL org.opencontainers.image.title="aula-web" \
      org.opencontainers.image.description="AULA: публичная витрина (Next.js SSR)" \
      org.opencontainers.image.version="${RELEASE}"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
