#!/usr/bin/env bash
# Выкатка версии AULA на сервер (staging/production). Запускается из CI (.github/workflows/deploy.yml)
# по SSH или вручную на сервере:
#
#   ops/deploy/deploy.sh v1.4.0
#
# Шаги: pull образов → Redis/PostgreSQL → миграции (одноразовый контейнер migrate, только вперёд)
# → переключение api, worker, web, admin, backup → ожидание /api/v1/health/ready с нужной версией
# → перечитать Caddyfile → записать .deploy/current_tag и .deploy/previous_tag.
#
# Если новая версия не стала здоровой за DEPLOY_HEALTH_TIMEOUT секунд (по умолчанию 180),
# автоматически возвращается предыдущая версия (AUTO_ROLLBACK=false — отключить).
# Миграции при этом не откатываются: они обязаны быть совместимы с предыдущей версией
# (дисциплина expand/contract, см. docs/operations.md).

# shellcheck source-path=SCRIPTDIR
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

usage() {
  echo "Использование: $0 <тег>   например: $0 v1.4.0" >&2
  exit 2
}

main() {
  [[ $# -eq 1 ]] || usage
  local tag="$1" current
  validate_tag "$tag"
  cd "$APP_DIR"
  require_server_files
  acquire_lock

  current="$(read_state current_tag)"
  log "Деплой $tag (сейчас работает: ${current:-нет})"
  record_history deploy-start "$tag"
  export TAG="$tag"

  # Сначала образы: если тега нет в реестре, ничего не меняем (миграции не запускаются).
  if ! ensure_images; then
    record_history deploy-failed "$tag"
    die "не удалось скачать образы $tag (есть ли тег в реестре? выполнен ли docker login на сервере?)"
  fi

  log "Инфраструктура: Redis / PostgreSQL"
  ensure_infra

  log "Миграции (только вперёд)"
  if ! compose run --rm --no-deps migrate; then
    record_history deploy-failed "$tag"
    die "миграции не применились — версия не переключена, работает ${current:-прежняя версия}"
  fi

  if ! switch_release "$tag"; then
    record_history deploy-failed "$tag"
    if [[ -n "$current" && "$current" != "$tag" && "${AUTO_ROLLBACK:-true}" == "true" ]]; then
      log "Новая версия не поднялась — автоматический возврат на $current (миграции остаются: expand/contract)"
      if switch_release "$current"; then
        record_history auto-rollback-ok "$current"
        die "деплой $tag не удался, возвращена версия $current. Разберите логи: ops/deploy/compose.sh logs api worker web"
      fi
      record_history auto-rollback-failed "$current"
      die "деплой $tag не удался и возврат на $current тоже — нужна ручная диагностика (docs/operations.md, «Инциденты»)"
    fi
    die "деплой $tag не удался"
  fi

  log "Reverse proxy: перечитать Caddyfile"
  reload_proxy

  if [[ -n "$current" && "$current" != "$tag" ]]; then
    write_state previous_tag "$current"
  fi
  write_state current_tag "$tag"
  printf '%s\n' "$tag" >>"$STATE_DIR/releases"
  record_history deploy-ok "$tag"

  # Удаляем только «висячие» слои; образы предыдущих тегов остаются для быстрого отката.
  docker image prune -f >/dev/null || true

  log "Готово: работает $tag, предыдущая версия: $(read_state previous_tag || true). Откат: ops/deploy/rollback.sh"
}

main "$@"
