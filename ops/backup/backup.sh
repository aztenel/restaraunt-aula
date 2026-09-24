#!/usr/bin/env bash
# Ежедневный полный бэкап AULA (ТЗ: база и файлы, хранение 30 дней, копия у другого провайдера,
# RPO ≤ 24 ч). Запускается cron в контейнере backup (ops/backup/crontab) или вручную:
#
#   ops/deploy/compose.sh run --rm backup backup.sh
#
# 1. pg_dump -Fc → проверка архива (pg_restore --list) → sha256 → манифест.
# 2. Дамп загружается в ОСНОВНОЕ (BACKUP_PRIMARY_REMOTE) и ВНЕШНЕЕ (BACKUP_OFFSITE_REMOTE, другой провайдер) хранилище.
# 3. Файлы S3-бакета (BACKUP_FILES_SOURCE) синхронизируются в оба хранилища: files/current + files/archive/<время>
#    (изменённые и удалённые файлы сохраняются в архиве дня).
# 4. Удаляются дампы и архивы старше BACKUP_RETENTION_DAYS (но не последние BACKUP_MIN_KEEP дампов).
# 5. Метрики для Prometheus (textfile collector) и пинг BACKUP_HEARTBEAT_URL при успехе.
# Любая ошибка → код выхода ≠ 0, метрика aula_backup_last_status = 0 (алерт AulaBackupFailed).
#
# Переменные (env/backup.env): BACKUP_DATABASE_URL, BACKUP_PRIMARY_REMOTE, BACKUP_OFFSITE_REMOTE,
# BACKUP_FILES_SOURCE, BACKUP_RETENTION_DAYS, BACKUP_MIN_KEEP, BACKUP_WORK_DIR, BACKUP_METRICS_DIR,
# BACKUP_HEARTBEAT_URL, BACKUP_ENV_NAME, RCLONE_CONFIG — см. ops/backup/backup.env.example.

# shellcheck source-path=SCRIPTDIR
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL не задан}"
: "${BACKUP_PRIMARY_REMOTE:?BACKUP_PRIMARY_REMOTE не задан (например backup-primary:aula-backups/production)}"
: "${BACKUP_OFFSITE_REMOTE:?BACKUP_OFFSITE_REMOTE не задан (копия у другого провайдера)}"
: "${BACKUP_FILES_SOURCE:?BACKUP_FILES_SOURCE не задан (rclone-путь бакета, например app-s3:aula; none — без файлов)}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
MIN_KEEP="${BACKUP_MIN_KEEP:-7}"
WORK_DIR="${BACKUP_WORK_DIR:-/var/backups/aula}"
METRICS_DIR="${BACKUP_METRICS_DIR:-}"
HEARTBEAT_URL="${BACKUP_HEARTBEAT_URL:-}"
ENV_NAME="${BACKUP_ENV_NAME:-unknown}"
REMOTES=("$BACKUP_PRIMARY_REMOTE" "$BACKUP_OFFSITE_REMOTE")

TS="$(date -u +%Y%m%dT%H%M%SZ)"
START_EPOCH="$(date +%s)"
DUMP_NAME="aula-db-$TS.dump"
OUT_DIR="$WORK_DIR/out/$TS"

write_metric_file() {
  local name="$1" tmp
  [[ -n "$METRICS_DIR" ]] || return 0
  mkdir -p "$METRICS_DIR"
  tmp="$METRICS_DIR/.$name.$$"
  cat >"$tmp"
  mv "$tmp" "$METRICS_DIR/$name"
}

write_status_metrics() {
  local status="$1" now
  now="$(date +%s)"
  write_metric_file aula_backup_status.prom <<EOF
# HELP aula_backup_last_run_timestamp_seconds Время последнего запуска бэкапа.
# TYPE aula_backup_last_run_timestamp_seconds gauge
aula_backup_last_run_timestamp_seconds{env="$ENV_NAME"} $now
# HELP aula_backup_last_status Результат последнего запуска: 1 — успех, 0 — ошибка.
# TYPE aula_backup_last_status gauge
aula_backup_last_status{env="$ENV_NAME"} $status
EOF
}

write_success_metrics() {
  local duration="$1" db_bytes="$2" now
  now="$(date +%s)"
  write_metric_file aula_backup_success.prom <<EOF
# HELP aula_backup_last_success_timestamp_seconds Время последнего успешного бэкапа (RPO).
# TYPE aula_backup_last_success_timestamp_seconds gauge
aula_backup_last_success_timestamp_seconds{env="$ENV_NAME"} $now
# HELP aula_backup_last_duration_seconds Длительность последнего успешного бэкапа.
# TYPE aula_backup_last_duration_seconds gauge
aula_backup_last_duration_seconds{env="$ENV_NAME"} $duration
# HELP aula_backup_last_db_size_bytes Размер последнего дампа БД.
# TYPE aula_backup_last_db_size_bytes gauge
aula_backup_last_db_size_bytes{env="$ENV_NAME"} $db_bytes
EOF
}

on_error() {
  local rc=$? line="$1"
  trap - ERR
  log "БЭКАП НЕ ВЫПОЛНЕН (код $rc, строка $line)"
  write_status_metrics 0 || true
  exit "$rc"
}
trap 'on_error $LINENO' ERR

prune_remote() {
  local remote="$1" cutoff name ts keep_from
  cutoff="$(ts_days_ago "$RETENTION_DAYS")"

  # Дампы: удаляем старше cutoff, но всегда оставляем MIN_KEEP последних.
  mapfile -t dumps < <(rclone_cmd lsf --files-only "$remote/db/" | grep -E "$DUMP_ONLY_RE" | sort)
  keep_from=$((${#dumps[@]} - MIN_KEEP))
  local i
  for ((i = 0; i < keep_from; i++)); do
    name="${dumps[$i]}"
    ts="${name#aula-db-}"
    ts="${ts%.dump}"
    if [[ "$ts" < "$cutoff" ]]; then
      log "Удаляю устаревший дамп $name из $remote"
      rclone_cmd delete "$remote/db/" --include "aula-db-$ts.*"
    fi
  done

  # Архивы версий файлов: каталоги files/archive/<время> старше cutoff.
  while IFS= read -r name; do
    [[ "$name" =~ $TS_DIR_RE ]] || continue
    ts="${BASH_REMATCH[1]}"
    if [[ "$ts" < "$cutoff" ]]; then
      log "Удаляю архив файлов $ts из $remote"
      rclone_cmd purge "$remote/files/archive/$ts"
    fi
  done < <(rclone_cmd lsf --dirs-only "$remote/files/archive/" 2>/dev/null || true)
}

main() {
  mkdir -p "$WORK_DIR" "$OUT_DIR"
  exec 8>"$WORK_DIR/.lock"
  flock -n 8 || die "бэкап уже выполняется"

  log "Бэкап AULA ($ENV_NAME) $TS: база $(redact_url "$BACKUP_DATABASE_URL")"

  # 1. Дамп базы: согласованный снимок, сжатый custom-формат (восстановление — pg_restore, в т.ч. параллельно).
  local tmp_dump="$OUT_DIR/.$DUMP_NAME.partial"
  pg_dump --dbname="$BACKUP_DATABASE_URL" --format=custom --lock-wait-timeout=120s --file="$tmp_dump"
  pg_restore --list "$tmp_dump" >/dev/null
  mv "$tmp_dump" "$OUT_DIR/$DUMP_NAME"
  (cd "$OUT_DIR" && sha256sum "$DUMP_NAME" >"$DUMP_NAME.sha256")

  local db_bytes last_migration sha
  db_bytes="$(stat -c %s "$OUT_DIR/$DUMP_NAME")"
  sha="$(cut -d' ' -f1 "$OUT_DIR/$DUMP_NAME.sha256")"
  last_migration="$(psql "$BACKUP_DATABASE_URL" -X -At -c \
    "select coalesce(max(id), '') from platform.schema_migrations" 2>/dev/null || true)"
  cat >"$OUT_DIR/aula-db-$TS.json" <<EOF
{
  "timestamp": "$TS",
  "environment": "$ENV_NAME",
  "release": "${RELEASE:-unknown}",
  "lastMigration": "$last_migration",
  "dump": "$DUMP_NAME",
  "sizeBytes": $db_bytes,
  "sha256": "$sha",
  "pgDump": "$(pg_dump --version | awk '{print $3}')"
}
EOF
  log "Дамп готов: $DUMP_NAME, $((db_bytes / 1024)) КиБ, последняя миграция: ${last_migration:-?}"

  # 2. Дамп → основное и внешнее хранилище.
  local remote
  for remote in "${REMOTES[@]}"; do
    log "Загружаю дамп в $remote/db/"
    rclone_cmd copy "$OUT_DIR/" "$remote/db/"
  done

  # 3. Файлы (фото блюд, PDF документов) → оба хранилища, с архивом изменённых/удалённых версий.
  if [[ "$BACKUP_FILES_SOURCE" == "none" ]]; then
    log "BACKUP_FILES_SOURCE=none — файлы не копируются (допустимо только без S3-хранилища)"
  else
    for remote in "${REMOTES[@]}"; do
      log "Синхронизирую файлы $BACKUP_FILES_SOURCE → $remote/files/current"
      rclone_cmd sync "$BACKUP_FILES_SOURCE" "$remote/files/current" \
        --backup-dir "$remote/files/archive/$TS" --fast-list --checkers 16 --transfers 8
    done
  fi

  # 4. Хранение: 30 дней.
  for remote in "${REMOTES[@]}"; do
    prune_remote "$remote"
  done

  # Локально держим только последний дамп (для быстрого восстановления на этом же сервере).
  find "$WORK_DIR/out" -mindepth 1 -maxdepth 1 -type d ! -name "$TS" -exec rm -rf {} +

  # 5. Отчёт.
  local duration=$(($(date +%s) - START_EPOCH))
  write_status_metrics 1
  write_success_metrics "$duration" "$db_bytes"
  if [[ -n "$HEARTBEAT_URL" ]]; then
    curl -fsS -m 10 --retry 3 "$HEARTBEAT_URL" >/dev/null || log "Предупреждение: heartbeat $HEARTBEAT_URL недоступен"
  fi
  log "Бэкап $TS завершён за ${duration} с (основное + внешнее хранилище)"
}

main "$@"
