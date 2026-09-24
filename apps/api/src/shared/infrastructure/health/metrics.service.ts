import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { Database } from '../database/database';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpDuration: Histogram<string>;
  readonly httpErrors: Counter<string>;
  private readonly outboxPending: Gauge<string>;
  private readonly outboxLagSeconds: Gauge<string>;
  private readonly failedJobsOpen: Gauge<string>;

  constructor(private readonly database: Database) {
    collectDefaultMetrics({ register: this.registry, prefix: 'aula_' });
    this.httpDuration = new Histogram({
      name: 'aula_http_request_duration_seconds',
      help: 'HTTP request duration',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5],
      registers: [this.registry],
    });
    this.httpErrors = new Counter({
      name: 'aula_http_errors_total',
      help: 'HTTP 5xx responses',
      labelNames: ['route'],
      registers: [this.registry],
    });
    this.outboxPending = new Gauge({ name: 'aula_outbox_pending', help: 'Undispatched outbox records', registers: [this.registry] });
    this.outboxLagSeconds = new Gauge({
      name: 'aula_outbox_lag_seconds',
      help: 'Age of the oldest ready undispatched outbox record',
      registers: [this.registry],
    });
    this.failedJobsOpen = new Gauge({ name: 'aula_failed_jobs_open', help: 'Unresolved failed jobs', registers: [this.registry] });
  }

  contentType(): string {
    return this.registry.contentType;
  }

  async render(): Promise<string> {
    try {
      const db = this.database.rootConnection();
      const outbox = await sql<{ n: number; lag: number | null }>`
        select count(*)::int as n,
               extract(epoch from (now() - min(available_at)) filter (where available_at <= now()))::int as lag
        from platform.outbox where dispatched_at is null`.execute(db);
      this.outboxPending.set(outbox.rows[0]?.n ?? 0);
      this.outboxLagSeconds.set(Math.max(0, outbox.rows[0]?.lag ?? 0));
      const failed = await sql<{ n: number }>`select count(*)::int as n from platform.failed_jobs where resolved_at is null`.execute(db);
      this.failedJobsOpen.set(failed.rows[0]?.n ?? 0);
    } catch {
      // Метрики не должны падать из-за БД; её недоступность видна в /health/ready.
    }
    return this.registry.metrics();
  }
}
