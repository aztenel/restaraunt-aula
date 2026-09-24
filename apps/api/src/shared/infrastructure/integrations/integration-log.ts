import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../kernel/clock';
import { newId } from '../../kernel/ids';
import { offsetOf, Page, pageOf, PageRequest } from '../../kernel/pagination';
import { Database } from '../database/database';
import { maskSensitive } from './masking';

export interface IntegrationLogEntry {
  integration: string;
  direction: 'outbound' | 'inbound';
  operation: string;
  correlationId?: string | null;
  request?: unknown;
  response?: unknown;
  statusCode?: number | null;
  success: boolean;
  durationMs?: number | null;
  error?: string | null;
}

/** Журнал обменов с внешними системами. Пишется вне транзакции бизнес-операции. */
@Injectable()
export class IntegrationLog {
  private readonly logger = new Logger(IntegrationLog.name);

  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async record(entry: IntegrationLogEntry): Promise<void> {
    try {
      await this.database
        .rootConnection()
        .insertInto('platform.integration_logs')
        .values({
          id: newId(),
          occurred_at: this.clock.now(),
          integration: entry.integration,
          direction: entry.direction,
          operation: entry.operation,
          correlation_id: entry.correlationId ?? null,
          request: JSON.stringify(maskSensitive(entry.request ?? null)),
          response: JSON.stringify(maskSensitive(entry.response ?? null)),
          status_code: entry.statusCode ?? null,
          success: entry.success,
          duration_ms: entry.durationMs ?? null,
          error: entry.error ? entry.error.slice(0, 4000) : null,
        })
        .execute();
    } catch (err) {
      // Журнал не должен ломать саму интеграцию.
      this.logger.error({ err }, 'Failed to write integration log');
    }
  }

  async search(
    filter: { integration?: string; correlationId?: string; success?: boolean },
    page: PageRequest,
  ): Promise<Page<Record<string, unknown>>> {
    let q = this.database.db().selectFrom('platform.integration_logs');
    if (filter.integration) q = q.where('integration', '=', filter.integration);
    if (filter.correlationId) q = q.where('correlation_id', '=', filter.correlationId);
    if (filter.success !== undefined) q = q.where('success', '=', filter.success);
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await q.selectAll().orderBy('occurred_at', 'desc').limit(page.perPage).offset(offsetOf(page)).execute();
    return pageOf(rows, Number(total?.n ?? 0), page);
  }
}
