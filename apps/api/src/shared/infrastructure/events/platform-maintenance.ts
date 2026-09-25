import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { Clock } from '../../kernel/clock';
import { Database } from '../database/database';
import { Scheduled } from './decorators';

/** Сроки хранения служебных данных платформы (дни). */
export const RETENTION_DAYS = {
  /** Доставленные записи outbox: в payload событий есть персональные данные гостей. */
  outbox: 30,
  /** Ключи идемпотентности обработчиков: дольше жизни outbox и задач в очереди. */
  idempotencyKeys: 90,
  /** Журнал обменов с внешними системами (разбор споров с провайдерами). */
  integrationLogs: 180,
  /** Закрытые записи очереди неудач. */
  resolvedFailedJobs: 90,
} as const;

/**
 * Регулярная очистка служебных таблиц платформы. Журнал аудита не очищается (только добавление).
 */
@Injectable()
export class PlatformMaintenance {
  private readonly logger = new Logger(PlatformMaintenance.name);

  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  @Scheduled('platform.purge_retention', { cron: '40 3 * * *' })
  async purge(): Promise<Record<string, number>> {
    const now = this.clock.now();
    const before = (days: number) => new Date(now.getTime() - days * 86_400_000);
    const db = this.database.rootConnection();
    const outbox = await sql`delete from platform.outbox where dispatched_at is not null and dispatched_at < ${before(RETENTION_DAYS.outbox)}`.execute(db);
    const keys = await sql`delete from platform.idempotency_keys where created_at < ${before(RETENTION_DAYS.idempotencyKeys)}`.execute(db);
    const logs = await sql`delete from platform.integration_logs where occurred_at < ${before(RETENTION_DAYS.integrationLogs)}`.execute(db);
    const failed = await sql`delete from platform.failed_jobs where resolved_at is not null and resolved_at < ${before(RETENTION_DAYS.resolvedFailedJobs)}`.execute(db);
    const result = {
      outbox: Number(outbox.numAffectedRows ?? 0),
      idempotencyKeys: Number(keys.numAffectedRows ?? 0),
      integrationLogs: Number(logs.numAffectedRows ?? 0),
      failedJobs: Number(failed.numAffectedRows ?? 0),
    };
    this.logger.log({ result }, 'Platform retention purge done');
    return result;
  }
}
