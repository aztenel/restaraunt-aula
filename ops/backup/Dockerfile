# syntax=docker/dockerfile:1.7
#
# Образ aula-backup: pg_dump/pg_restore 16 + rclone + cron. Контекст сборки — ops/backup:
#   docker build -t aula-backup:dev ops/backup
#
# По умолчанию (команда cron) — ежедневный бэкап по расписанию BACKUP_CRON (ops/backup/crontab).
# Любая другая команда выполняется напрямую:
#   docker compose run --rm backup backup.sh
#   docker compose run --rm backup restore.sh --from ... --target-db ...

ARG RCLONE_IMAGE=rclone/rclone:1.73.5
FROM ${RCLONE_IMAGE} AS rclone

FROM debian:bookworm-slim

# PostgreSQL client 16 из официального репозитория PGDG (в Debian bookworm — только 15).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg cron tzdata \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-16 \
 && apt-get purge -y gnupg \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/* \
 # cron в контейнере: без pam_loginuid задания не запускаются («Operation not permitted»)
 && sed -i '/pam_loginuid.so/s/^/#/' /etc/pam.d/cron

COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone

COPY lib.sh backup.sh restore.sh verify-restore.sh entrypoint.sh /opt/backup/
COPY crontab /opt/backup/crontab
RUN chmod 0755 /opt/backup/*.sh \
 && rclone version \
 && pg_dump --version

ENV PATH=/opt/backup:$PATH \
    TZ=Asia/Almaty \
    RCLONE_CONFIG=/config/rclone.conf \
    BACKUP_WORK_DIR=/var/backups/aula \
    BACKUP_METRICS_DIR=/metrics

VOLUME ["/var/backups/aula"]

ENTRYPOINT ["/opt/backup/entrypoint.sh"]
CMD ["cron"]
