#!/usr/bin/env bash
# Откат AULA на предыдущую версию одной командой (на сервере или из .github/workflows/rollback.yml):
#
#   ops/deploy/rollback.sh            # на .deploy/previous_tag
#   ops/deploy/rollback.sh v1.3.2     # на конкретный тег (образы должны быть в реестре)
#
# Миграции НЕ выполняются и НЕ откатываются: они только вперёд (правило 9 ТЗ). Предыдущая версия
# приложения запускается на более новой схеме БД. Это безопасно, потому что каждая миграция обязана быть
# обратно совместимой с предыдущим релизом (expand/contract, см. docs/operations.md):
#   - релиз N добавляет (expand): новые таблицы, nullable-колонки или колонки с default, новые индексы;
#   - код релиза N пишет и в старую, и в новую структуру, читает новую;
#   - удаление/переименование старого (contract) — не раньше релиза N+1, когда код N-1 уже не нужен для отката.
# Повторный запуск без аргумента откатывает ещё на один успешный релиз назад.

# shellcheck source-path=SCRIPTDIR
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

usage() {
  echo "Использование: $0 [тег]   без аргумента — откат на .deploy/previous_tag" >&2
  exit 2
}

main() {
  [[ $# -le 1 ]] || usage
  cd "$APP_DIR"
  require_server_files
  acquire_lock

  local current previous target before
  current="$(read_state current_tag)"
  previous="$(read_state previous_tag)"
  target="${1:-$previous}"

  [[ -n "$target" ]] || die "нет предыдущей версии (.deploy/previous_tag пуст). Укажите тег явно: $0 vX.Y.Z"
  validate_tag "$target"
  [[ "$target" != "$current" ]] || die "версия $target уже работает"

  log "Откат: ${current:-?} → $target. Миграции не выполняются (только вперёд, expand/contract)."
  record_history rollback-start "$target"

  if ! switch_release "$target"; then
    record_history rollback-failed "$target"
    die "откат на $target не удался — см. docs/operations.md, «Инциденты»"
  fi

  write_state current_tag "$target"
  before="$(release_before "$target")"
  if [[ -n "$before" && "$before" != "$target" ]]; then
    write_state previous_tag "$before"
  else
    rm -f "$STATE_DIR/previous_tag"
  fi
  record_history rollback-ok "$target"

  log "Готово: работает $target (откачено с ${current:-?}). Следующий откат без аргумента: ${before:-недоступен}"
  log "Исправление выпускается новым тегом (vX.Y.Z+1) через обычный деплой."
}

main "$@"
