#!/usr/bin/env bash
# Проверка восстановления из бэкапа (ТЗ: «восстановление проверяется на тестовом стенде минимум раз
# в квартал; точка восстановления не старше 24 часов, время восстановления — до 4 часов»).
# Запускается на STAGING-сервере из каталога /opt/aula:
#
#   ops/backup/verify-restore.sh                     # последний бэкап из основного хранилища
#   ops/backup/verify-restore.sh --source offsite    # из внешнего хранилища (чередуйте по кварталам)
#   ops/backup/verify-restore.sh --dump aula-db-20260901T213000Z.dump
#   ops/backup/verify-restore.sh --keep              # оставить временную базу для ручной проверки
#
# Шаги:
#   1. Контейнер backup: скачивает дамп (rclone), сверяет sha256 и восстанавливает его во временную
#      базу aula_restore_check_<время> на PostgreSQL staging (restore.sh).
#   2. Контейнер migrate текущей версии: применяет миграции к восстановленной базе — бэкап совместим с кодом.
#   3. Smoke-запросы: журнал миграций, число строк ключевых таблиц, свежесть данных.
#   4. Итог: длительность (RTO ≤ 4 ч), возраст бэкапа (RPO ≤ 24 ч), запись в .deploy/restore-checks.log.
#   5. Временная база удаляется (кроме --keep).
#
# Источник бэкапов и права — в env/backup.env staging (VERIFY_* в ops/backup/backup.env.example):
# для проверки бэкапов PRODUCTION укажите VERIFY_SOURCE_PRIMARY / VERIFY_SOURCE_OFFSITE — rclone-пути
# к хранилищам production с ключами ТОЛЬКО НА ЧТЕНИЕ. Пароли на хост не выводятся: всё, что их требует,
# выполняется внутри контейнеров.
#
# Режим --inside <шаг> используется самим скриптом внутри контейнера backup.

# shellcheck source-path=SCRIPTDIR
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

DEFAULT_KEY_TABLES="platform.schema_migrations platform.audit_log identity.legal_entities identity.branches identity.users \
catalog.categories catalog.dishes catalog.branch_menu_items customers.customers ordering.orders \
payments.payments payments.gift_certificates reservation.venues reservation.reservations banquet.requests banquet.quotes"

# ---------------------------------------------------------------------------
# Шаги внутри контейнера backup (есть rclone, pg_restore, psql и переменные env/backup.env)
# ---------------------------------------------------------------------------
admin_url() {
  printf '%s' "${VERIFY_ADMIN_DATABASE_URL:-${BACKUP_DATABASE_URL:?}}"
}

scratch_url() {
  db_url_with_name "$(admin_url)" "$1"
}

source_remote() {
  case "$1" in
    primary) printf '%s' "${VERIFY_SOURCE_PRIMARY:-${BACKUP_PRIMARY_REMOTE:?}}" ;;
    offsite) printf '%s' "${VERIFY_SOURCE_OFFSITE:-${BACKUP_OFFSITE_REMOTE:?}}" ;;
    *) die "неизвестный источник: $1 (primary|offsite)" ;;
  esac
}

inside_restore() {
  local scratch="$1" source="$2" dump="$3" remote
  remote="$(source_remote "$source")"
  if [[ "$dump" == "latest" ]]; then
    dump="$(latest_dump "$remote")"
    [[ -n "$dump" ]] || die "в $remote/db/ нет дампов"
  fi
  log "Источник: $remote ($source), дамп: $dump"
  "$SCRIPT_DIR/restore.sh" --from "$remote" --dump "$dump" --target-db "$(scratch_url "$scratch")" --create-db --yes
  echo "RESULT dump=$dump"
}

inside_smoke() {
  local url tables failed=0 row table count
  url="$(scratch_url "$1")"
  tables="${VERIFY_KEY_TABLES:-$DEFAULT_KEY_TABLES}"
  log "Smoke-проверка восстановленной базы"
  for table in $tables; do
    if [[ "$(psql "$url" -X -At -c "select to_regclass('$table') is not null")" != "t" ]]; then
      printf '  %-40s нет таблицы (модуль ещё не создан или переименован)\n' "$table"
      continue
    fi
    count="$(psql "$url" -X -At -v ON_ERROR_STOP=1 -c "select count(*) from $table")"
    printf '  %-40s %s строк\n' "$table" "$count"
  done
  # Обязательные условия: схема на месте, есть филиалы и сотрудники.
  for table in platform.schema_migrations identity.branches identity.users; do
    row="$(psql "$url" -X -At -c "select count(*) from $table" 2>/dev/null || echo 0)"
    if [[ "$row" == "0" ]]; then
      log "ПРОВАЛ: таблица $table пуста или отсутствует"
      failed=1
    fi
  done
  row="$(psql "$url" -X -At -c "select coalesce(max(id), '-') from platform.schema_migrations" 2>/dev/null || echo '-')"
  log "Последняя миграция: $row"
  row="$(psql "$url" -X -At -c "select coalesce(to_char(max(occurred_at) at time zone 'Asia/Almaty', 'YYYY-MM-DD HH24:MI'), '-') from platform.audit_log" 2>/dev/null || echo '-')"
  log "Последняя запись журнала действий (Asia/Almaty): $row"
  return "$failed"
}

inside_drop() {
  local name="$1"
  [[ "$name" =~ ^aula_restore_check_[0-9]+$ ]] || die "отказ удалять базу $name: не временная база проверки"
  psql "$(db_url_with_name "$(admin_url)" postgres)" -X -q -v ON_ERROR_STOP=1 \
    -c "drop database if exists \"$name\" with (force)"
  log "Временная база $name удалена"
}

if [[ "${1:-}" == "--inside" ]]; then
  step="${2:?шаг}"
  shift 2
  case "$step" in
    restore) inside_restore "$@" ;;
    smoke) inside_smoke "$@" ;;
    drop) inside_drop "$@" ;;
    *) die "неизвестный шаг $step" ;;
  esac
  exit 0
fi

# ---------------------------------------------------------------------------
# Хост staging: оркестрация через docker compose
# ---------------------------------------------------------------------------
# shellcheck source=../deploy/lib.sh
source "$SCRIPT_DIR/../deploy/lib.sh"

SOURCE=primary
DUMP=latest
KEEP=false
RTO_SECONDS="${RTO_SECONDS:-14400}"
RPO_SECONDS="${RPO_SECONDS:-86400}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) SOURCE="${2:?}"; shift 2 ;;
    --dump) DUMP="${2:?}"; shift 2 ;;
    --keep) KEEP=true; shift ;;
    -h | --help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "неизвестный параметр $1" ;;
  esac
done
[[ "$SOURCE" == primary || "$SOURCE" == offsite ]] || die "--source primary|offsite"

cd "$APP_DIR"
TAG="$(read_state current_tag)"
[[ -n "$TAG" ]] || die "на сервере нет развёрнутой версии (.deploy/current_tag) — сначала деплой staging"
export TAG

SCRATCH="aula_restore_check_$(date -u +%Y%m%d%H%M%S)"

in_backup() {
  compose run --rm --no-deps -T backup /opt/backup/verify-restore.sh --inside "$@"
}

cleanup() {
  if $KEEP; then
    log "Временная база $SCRATCH оставлена (--keep). Удалить:"
    log "  ops/deploy/compose.sh run --rm --no-deps backup /opt/backup/verify-restore.sh --inside drop $SCRATCH"
  else
    in_backup drop "$SCRATCH" || log "Предупреждение: не удалось удалить $SCRATCH — удалите вручную"
  fi
}
trap cleanup EXIT

log "Проверка восстановления: источник $SOURCE, дамп $DUMP, временная база $SCRATCH, код приложения $TAG"
t0="$(date +%s)"

output="$(in_backup restore "$SCRATCH" "$SOURCE" "$DUMP" | tee /dev/stderr)"
dump_used="$(grep -oE 'RESULT dump=[^ ]+' <<<"$output" | tail -n 1 | cut -d= -f2)"
[[ -n "$dump_used" ]] || die "не удалось определить восстановленный дамп"
t1="$(date +%s)"

log "Миграции текущей версии ($TAG) на восстановленной базе"
# DATABASE_URL контейнера migrate (env/api.env) указывает на базу staging — подменяем только имя базы.
# shellcheck disable=SC2016
compose run --rm --no-deps -T -e VERIFY_SCRATCH_DB="$SCRATCH" migrate sh -c '
  base="${DATABASE_URL%%\?*}"; query="${DATABASE_URL#"$base"}"
  DATABASE_URL="${base%/*}/${VERIFY_SCRATCH_DB}${query}" exec node dist/cli/migrate.js'
t2="$(date +%s)"

smoke_ok=true
in_backup smoke "$SCRATCH" || smoke_ok=false
t3="$(date +%s)"

ts="${dump_used#aula-db-}"
ts="${ts%.dump}"
backup_age=$((t0 - $(ts_to_epoch "$ts")))
total=$((t3 - t0))

rto_ok=false
rpo_ok=false
((total <= RTO_SECONDS)) && rto_ok=true
((backup_age <= RPO_SECONDS)) && rpo_ok=true
result=PASS
if ! $smoke_ok || ! $rto_ok || ! $rpo_ok; then
  result=FAIL
fi

log "================ ИТОГ ПРОВЕРКИ ВОССТАНОВЛЕНИЯ ================"
log "Дамп:               $dump_used ($SOURCE)"
log "Восстановление БД:  $((t1 - t0)) с"
log "Миграции:           $((t2 - t1)) с"
log "Smoke-запросы:      $((t3 - t2)) с ($($smoke_ok && echo ok || echo ПРОВАЛ))"
log "Итого (RTO данных): ${total} с — цель ≤ ${RTO_SECONDS} с: $($rto_ok && echo ok || echo ПРЕВЫШЕНО)"
log "Возраст бэкапа (RPO): $((backup_age / 3600)) ч $(((backup_age % 3600) / 60)) мин — цель ≤ $((RPO_SECONDS / 3600)) ч: $($rpo_ok && echo ok || echo ПРЕВЫШЕНО)"
log "Результат: $result"
log "Полный RTO = время выше + подготовка сервера и деплой (docs/operations.md, «Восстановление после аварии»)."

mkdir -p "$STATE_DIR"
printf '%s\tsource=%s\tdump=%s\tduration_s=%s\tbackup_age_s=%s\tapp=%s\tresult=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SOURCE" "$dump_used" "$total" "$backup_age" "$TAG" "$result" \
  >>"$STATE_DIR/restore-checks.log"

[[ "$result" == PASS ]]
