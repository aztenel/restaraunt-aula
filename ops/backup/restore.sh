#!/usr/bin/env bash
# Восстановление AULA из бэкапа: дамп PostgreSQL в ПУСТУЮ базу и (опционально) файлы в S3-бакет.
# Выполняется в контейнере backup (есть pg_restore 16 и rclone) — см. docs/operations.md, «Восстановление».
#
#   restore.sh --from <rclone-путь бэкапов> --target-db <postgres URL> [опции]
#
# Опции:
#   --from REMOTE         где лежат бэкапы: $BACKUP_PRIMARY_REMOTE, $BACKUP_OFFSITE_REMOTE или другой rclone-путь
#   --dump NAME|latest    какой дамп (имя файла из <remote>/db/), по умолчанию latest
#   --target-db URL       база назначения (должна быть пустой или создаётся с --create-db)
#   --create-db           создать базу назначения, если её нет (нужно право CREATEDB)
#   --drop-existing       удалить и создать базу назначения заново (ОПАСНО; требует --yes)
#   --files-target REMOTE восстановить файлы (<remote>/files/current) в этот rclone-путь бакета (rclone sync)
#   --no-db               только файлы
#   --jobs N              параллельность pg_restore (по умолчанию 4)
#   --yes                 не спрашивать подтверждение
#
# Пример полного восстановления production на новом сервере (RTO ≤ 4 ч):
#   restore.sh --from "$BACKUP_PRIMARY_REMOTE" --target-db "$BACKUP_DATABASE_URL" --create-db \
#              --files-target app-s3:aula-production --yes

# shellcheck source-path=SCRIPTDIR
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

usage() {
  sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

FROM=""
DUMP="latest"
TARGET_DB=""
CREATE_DB=false
DROP_EXISTING=false
FILES_TARGET=""
RESTORE_DB=true
JOBS=4
ASSUME_YES=false
WORK_DIR="${RESTORE_WORK_DIR:-${BACKUP_WORK_DIR:-/var/backups/aula}/restore}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM="${2:?}"; shift 2 ;;
    --dump) DUMP="${2:?}"; shift 2 ;;
    --target-db) TARGET_DB="${2:?}"; shift 2 ;;
    --create-db) CREATE_DB=true; shift ;;
    --drop-existing) DROP_EXISTING=true; shift ;;
    --files-target) FILES_TARGET="${2:?}"; shift 2 ;;
    --no-db) RESTORE_DB=false; shift ;;
    --jobs) JOBS="${2:?}"; shift 2 ;;
    --yes | -y) ASSUME_YES=true; shift ;;
    -h | --help) usage ;;
    *) echo "Неизвестный параметр: $1" >&2; usage ;;
  esac
done

[[ -n "$FROM" ]] || usage
if $RESTORE_DB; then
  [[ -n "$TARGET_DB" ]] || die "--target-db обязателен (или --no-db)"
fi
if $DROP_EXISTING && ! $ASSUME_YES; then
  die "--drop-existing удаляет базу назначения — нужен явный --yes"
fi
$RESTORE_DB || [[ -n "$FILES_TARGET" ]] || die "нечего восстанавливать: --no-db без --files-target"

confirm() {
  $ASSUME_YES && return 0
  [[ -t 0 ]] || die "подтверждение невозможно без терминала — добавьте --yes"
  local answer
  read -r -p "$1 Введите yes: " answer
  [[ "$answer" == "yes" ]] || die "отменено"
}

psql_admin() {
  psql "$(db_url_with_name "$TARGET_DB" postgres)" -X -v ON_ERROR_STOP=1 -At "$@"
}

prepare_target_db() {
  local name exists tables
  name="$(db_name_of "$TARGET_DB")"
  [[ "$name" =~ ^[A-Za-z0-9_-]+$ ]] || die "недопустимое имя базы: $name"
  exists="$(psql_admin -c "select 1 from pg_database where datname = '$name'")"
  if $DROP_EXISTING && [[ "$exists" == "1" ]]; then
    log "Удаляю базу $name"
    psql_admin -c "drop database \"$name\" with (force)" >/dev/null
    exists=""
  fi
  if [[ "$exists" != "1" ]]; then
    if $CREATE_DB || $DROP_EXISTING; then
      log "Создаю базу $name"
      psql_admin -c "create database \"$name\"" >/dev/null
    else
      die "базы $name нет — добавьте --create-db"
    fi
  fi
  tables="$(psql "$TARGET_DB" -X -At -c "select count(*) from information_schema.tables
    where table_schema not in ('pg_catalog', 'information_schema')")"
  [[ "$tables" == "0" ]] || die "база $name не пустая ($tables таблиц). Восстановление — только в пустую базу (--drop-existing пересоздаст её)"
}

restore_db() {
  local dump="$1" started
  mkdir -p "$WORK_DIR"
  log "Скачиваю $FROM/db/$dump"
  rclone_cmd copyto "$FROM/db/$dump" "$WORK_DIR/$dump"
  if rclone_cmd copyto "$FROM/db/$dump.sha256" "$WORK_DIR/$dump.sha256" 2>/dev/null; then
    (cd "$WORK_DIR" && sha256sum --check --quiet "$dump.sha256") || die "контрольная сумма $dump не совпала"
    log "Контрольная сумма совпала"
  else
    log "Предупреждение: нет $dump.sha256 — проверяю только целостность архива"
  fi
  pg_restore --list "$WORK_DIR/$dump" >/dev/null

  prepare_target_db
  started="$(date +%s)"
  log "pg_restore → $(redact_url "$TARGET_DB") (параллельно: $JOBS)"
  pg_restore --dbname="$TARGET_DB" --no-owner --no-privileges --exit-on-error --jobs="$JOBS" "$WORK_DIR/$dump"
  psql "$TARGET_DB" -X -q -c "analyze" >/dev/null
  log "База восстановлена за $(($(date +%s) - started)) с"
  rm -f "$WORK_DIR/$dump" "$WORK_DIR/$dump.sha256"
}

restore_files() {
  local started
  started="$(date +%s)"
  log "Файлы: $FROM/files/current → $FILES_TARGET (rclone sync)"
  rclone_cmd sync "$FROM/files/current" "$FILES_TARGET" --fast-list --checkers 16 --transfers 16
  log "Файлы восстановлены за $(($(date +%s) - started)) с"
}

main() {
  local dump="$DUMP" started
  started="$(date +%s)"
  if $RESTORE_DB; then
    if [[ "$dump" == "latest" ]]; then
      dump="$(latest_dump "$FROM")"
      [[ -n "$dump" ]] || die "в $FROM/db/ нет дампов"
    fi
    [[ "$dump" =~ $DUMP_ONLY_RE ]] || die "некорректное имя дампа: $dump"
  fi

  log "План восстановления:"
  log "  источник: $FROM"
  $RESTORE_DB && log "  дамп:     $dump → $(redact_url "$TARGET_DB")$($DROP_EXISTING && echo ' (база будет ПЕРЕСОЗДАНА)')"
  [[ -n "$FILES_TARGET" ]] && log "  файлы:    files/current → $FILES_TARGET (лишние файлы в назначении будут удалены)"
  confirm "Продолжить восстановление?"

  if $RESTORE_DB; then
    restore_db "$dump"
  fi
  if [[ -n "$FILES_TARGET" ]]; then
    restore_files
  fi
  log "Восстановление завершено за $(($(date +%s) - started)) с"
}

main
