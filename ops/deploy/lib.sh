#!/usr/bin/env bash
# shellcheck shell=bash
#
# Общие функции деплоя и отката AULA. Подключается из deploy.sh, rollback.sh, compose.sh
# и ops/backup/verify-restore.sh; самостоятельно не запускается.
#
# Раскладка на сервере (APP_DIR, по умолчанию /opt/aula — каталог, где лежит этот репозиторий ops/):
#   docker-compose.prod.yml   ops/            — синхронизируются из репозитория при деплое
#   .env  env/*.env  env/rclone.conf          — настройки сервера (создаёт администратор, в git не хранятся)
#   .deploy/current_tag  .deploy/previous_tag — состояние релизов (ведут скрипты)
#   .deploy/releases  .deploy/history.log     — успешные релизы по порядку, журнал действий

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
STATE_DIR="$APP_DIR/.deploy"
COMPOSE_FILE_PATH="${COMPOSE_FILE_PATH:-$APP_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
HEALTH_TIMEOUT="${DEPLOY_HEALTH_TIMEOUT:-180}"

# Сервисы приложения, которые переключаются на новую версию (migrate запускается отдельно).
APP_SERVICES=(api worker web admin backup)
# Образы, которые нужно скачать (worker и migrate используют образ api).
PULL_SERVICES=(api web admin backup)

TAG_RE='^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

die() {
  log "ОШИБКА: $*" >&2
  exit 1
}

validate_tag() {
  [[ "$1" =~ $TAG_RE ]] || die "некорректный тег '$1' (ожидается vMAJOR.MINOR.PATCH[-suffix], например v1.4.0)"
}

require_server_files() {
  local f
  for f in "$COMPOSE_FILE_PATH" "$ENV_FILE" "$APP_DIR/env/api.env" "$APP_DIR/env/web.env" \
    "$APP_DIR/env/backup.env" "$APP_DIR/env/rclone.conf"; do
    [[ -f "$f" ]] || die "нет файла $f (см. docs/operations.md, раздел «Подготовка сервера»)"
  done
}

# docker compose для production-стека. Тег образов берётся из переменной окружения TAG.
compose() {
  docker compose --project-directory "$APP_DIR" --env-file "$ENV_FILE" -f "$COMPOSE_FILE_PATH" "$@"
}

acquire_lock() {
  mkdir -p "$STATE_DIR"
  exec 9>"$STATE_DIR/lock"
  flock -n 9 || die "уже выполняется другой деплой или откат ($STATE_DIR/lock)"
}

read_state() {
  local file="$STATE_DIR/$1"
  if [[ -s "$file" ]]; then
    tr -d '[:space:]' <"$file"
  fi
}

write_state() {
  mkdir -p "$STATE_DIR"
  printf '%s\n' "$2" >"$STATE_DIR/$1.tmp"
  mv "$STATE_DIR/$1.tmp" "$STATE_DIR/$1"
}

record_history() {
  mkdir -p "$STATE_DIR"
  printf '%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "${SUDO_USER:-${USER:-unknown}}" \
    >>"$STATE_DIR/history.log"
}

# Релиз, успешно выкаченный перед последним выкатом тега $1 (для повторного отката «ещё на шаг назад»).
release_before() {
  local releases="$STATE_DIR/releases"
  [[ -f "$releases" ]] || return 0
  awk -v target="$1" '
    $0 == target { found = prev }
    $0 != target && $0 != "" { prev = $0 }
    END { if (found != "") print found }
  ' "$releases"
}

# Готовность API: /health/ready = 200 (БД и Redis доступны) и /health/live отдаёт нужную версию.
api_ready() {
  compose exec -T api node -e '
    const tag = process.argv[1];
    const base = "http://127.0.0.1:3000/api/v1/health";
    Promise.all([fetch(base + "/ready"), fetch(base + "/live").then((r) => r.json())])
      .then(([ready, live]) => process.exit(ready.ok && live.release === tag ? 0 : 1))
      .catch(() => process.exit(1));
  ' "$1" >/dev/null 2>&1
}

web_ready() {
  compose exec -T web node -e '
    fetch("http://127.0.0.1:3001/api/health", { redirect: "manual" })
      .then((r) => process.exit(r.status < 500 ? 0 : 1))
      .catch(() => process.exit(1));
  ' >/dev/null 2>&1
}

admin_ready() {
  compose exec -T admin wget -q -O /dev/null http://127.0.0.1:8080/healthz >/dev/null 2>&1
}

wait_healthy() {
  local tag="$1" deadline=$((SECONDS + HEALTH_TIMEOUT)) check
  for check in api_ready web_ready admin_ready; do
    log "Проверка готовности: ${check%_ready} ..."
    until "$check" "$tag"; do
      if ((SECONDS >= deadline)); then
        log "${check%_ready} не готов за ${HEALTH_TIMEOUT} с"
        compose ps >&2 || true
        compose logs --no-color --tail=80 api worker web >&2 || true
        return 1
      fi
      sleep 3
    done
  done
  log "Версия $tag работает: API /health/ready = ok, витрина и админка отвечают"
}

# Инфраструктура (Redis, PostgreSQL при профиле db) — поднять, если не запущена, и дождаться healthcheck.
ensure_infra() {
  local services=(redis)
  if compose config --services 2>/dev/null | grep -qx postgres; then
    services+=(postgres)
  fi
  compose up -d --wait --wait-timeout 120 "${services[@]}"
}

# Скачать образы тега, если их нет локально. Теги неизменяемы, поэтому локальный образ — тот же самый;
# откат на уже скачанную версию работает и при недоступном реестре.
ensure_images() {
  local image missing=0
  while IFS= read -r image; do
    [[ -n "$image" ]] || continue
    docker image inspect "$image" >/dev/null 2>&1 || missing=1
  done < <(compose config --images)
  if ((missing)); then
    log "Скачиваю образы $TAG"
    compose pull --quiet "${PULL_SERVICES[@]}"
  fi
}

# Переключить приложение на тег: образы, up без зависимостей, проверка здоровья.
# Миграции здесь НЕ выполняются — это делает deploy.sh до переключения.
switch_release() {
  local tag="$1"
  export TAG="$tag"
  # Функция вызывается в условии if — set -e внутри не действует, поэтому ошибки проверяем явно.
  ensure_images || {
    log "не удалось получить образы $tag (есть ли тег в реестре? выполнен ли docker login?)"
    return 1
  }
  log "Запускаю ${APP_SERVICES[*]} ($tag)"
  compose up -d --no-deps --remove-orphans "${APP_SERVICES[@]}" || return 1
  wait_healthy "$tag"
}

# Reverse proxy: запустить, если не запущен, и перечитать Caddyfile (обновляется вместе с ops/).
reload_proxy() {
  compose up -d --no-deps caddy
  if ! compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    log "caddy reload не удался — перезапускаю контейнер caddy"
    compose restart caddy
  fi
}
