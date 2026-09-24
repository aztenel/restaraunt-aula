#!/usr/bin/env bash
# shellcheck shell=bash
#
# Общие функции бэкапа и восстановления AULA (backup.sh, restore.sh, verify-restore.sh).
#
# Раскладка в хранилище бэкапов (одинаковая в основном и во внешнем remote rclone):
#   <remote>/db/aula-db-YYYYMMDDTHHMMSSZ.dump          pg_dump -Fc (сжатый custom-формат)
#   <remote>/db/aula-db-YYYYMMDDTHHMMSSZ.dump.sha256   контрольная сумма
#   <remote>/db/aula-db-YYYYMMDDTHHMMSSZ.json          манифест: размер, релиз, последняя миграция
#   <remote>/files/current/                            зеркало S3-бакета на момент последнего бэкапа
#   <remote>/files/archive/YYYYMMDDTHHMMSSZ/           версии файлов, изменённых/удалённых в этот день
# Хранение 30 дней (BACKUP_RETENTION_DAYS) по времени в имени, не менее BACKUP_MIN_KEEP последних дампов.

# Имена дампов и каталогов архива (используются подключающими скриптами).
DUMP_ONLY_RE='^aula-db-[0-9]{8}T[0-9]{6}Z\.dump$'
# shellcheck disable=SC2034
TS_DIR_RE='^([0-9]{8}T[0-9]{6}Z)/?$'

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

die() {
  log "ОШИБКА: $*" >&2
  exit 1
}

rclone_cmd() {
  rclone --config "${RCLONE_CONFIG:-/config/rclone.conf}" --retries 5 --low-level-retries 10 \
    --stats 0 --log-level NOTICE "$@"
}

# Имя базы из URL postgres://user:pass@host:port/db?params
db_name_of() {
  local url="${1%%\?*}"
  printf '%s' "${url##*/}"
}

# Тот же URL с другим именем базы (параметры ?sslmode=... сохраняются).
db_url_with_name() {
  local url="$1" name="$2" base query=""
  base="${url%%\?*}"
  if [[ "$url" == *\?* ]]; then
    query="?${url#*\?}"
  fi
  printf '%s/%s%s' "${base%/*}" "$name" "$query"
}

# URL без пароля — для логов.
redact_url() {
  printf '%s' "$1" | sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#'
}

# Отметка времени (UTC) N дней назад в формате имён бэкапов — строки сравниваются лексикографически.
ts_days_ago() {
  date -u -d "-$1 days" +%Y%m%dT%H%M%SZ
}

# Время из имени в секундах Unix: 20260924T033000Z → 1790307000
ts_to_epoch() {
  local ts="$1"
  date -u -d "${ts:0:4}-${ts:4:2}-${ts:6:2}T${ts:9:2}:${ts:11:2}:${ts:13:2}Z" +%s
}

# Последний дамп в <remote>/db/ (имя файла) или пусто.
latest_dump() {
  rclone_cmd lsf --files-only "$1/db/" | grep -E "$DUMP_ONLY_RE" | sort | tail -n 1 || true
}
