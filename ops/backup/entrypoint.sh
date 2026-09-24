#!/usr/bin/env bash
# Точка входа контейнера aula-backup.
#   cron (по умолчанию) — установить расписание и запустить cron на переднем плане;
#   любая другая команда — выполнить её (backup.sh, restore.sh, verify-restore.sh, psql, rclone ...).
set -euo pipefail

if [[ "${1:-cron}" != "cron" ]]; then
  exec "$@"
fi

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL не задан (env/backup.env)}"
: "${BACKUP_PRIMARY_REMOTE:?BACKUP_PRIMARY_REMOTE не задан (env/backup.env)}"
: "${BACKUP_OFFSITE_REMOTE:?BACKUP_OFFSITE_REMOTE не задан (env/backup.env)}"
[[ -r "${RCLONE_CONFIG:-/config/rclone.conf}" ]] || {
  echo "Нет ${RCLONE_CONFIG:-/config/rclone.conf} (смонтируйте env/rclone.conf)" >&2
  exit 1
}

# Часовой пояс расписания (по умолчанию Asia/Almaty).
if [[ -f "/usr/share/zoneinfo/${TZ:-Asia/Almaty}" ]]; then
  ln -snf "/usr/share/zoneinfo/${TZ:-Asia/Almaty}" /etc/localtime
  echo "${TZ:-Asia/Almaty}" >/etc/timezone
fi

# cron не передаёт окружение контейнера заданиям — сохраняем его в файл, доступный только root.
(umask 077 && export -p >/run/backup.env)

# Расписание: BACKUP_CRON (5 полей cron) заменяет расписание по умолчанию из ops/backup/crontab.
schedule="${BACKUP_CRON:-}"
if [[ -n "$schedule" ]]; then
  [[ "$schedule" =~ ^[0-9*/,-]+( [0-9*/,-]+){4}$ ]] || {
    echo "Некорректный BACKUP_CRON: '$schedule'" >&2
    exit 1
  }
  sed -E "s|^[0-9*/,-]+( [0-9*/,-]+){4} root |$schedule root |" /opt/backup/crontab >/etc/cron.d/aula-backup
else
  cp /opt/backup/crontab /etc/cron.d/aula-backup
fi
chmod 0644 /etc/cron.d/aula-backup

echo "aula-backup: расписание ($(cat /etc/timezone 2>/dev/null || echo UTC)):"
grep -E '^[^#A-Z]' /etc/cron.d/aula-backup
exec cron -f -L 15
