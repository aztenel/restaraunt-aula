import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { Clock } from '../../kernel/clock';
import { newId } from '../../kernel/ids';
import { Database } from '../database/database';
import { HandlerExecutor } from './handler-executor';
import { HandlerRegistry } from './handler-registry';
import {
  backoffDelay,
  DEFAULT_RETRY,
  EVENT_DELIVERY_TOPIC,
  EventDeliveryPayload,
  EventEnvelope,
  JobEnvelope,
  RetryPolicy,
} from './types';

export interface OutboxRow {
  id: string;
  kind: 'event' | 'job';
  topic: string;
  payload: EventEnvelope | JobEnvelope;
  attempts: number;
  available_at: Date;
}

const LEASE_MS = 5 * 60_000;

/**
 * Обработка outbox в режиме inline (dev и тесты): события раскладываются на доставки
 * каждому обработчику, задачи выполняются в процессе. Повторы с экспоненциальной задержкой,
 * по исчерпании — очередь неудач. В режиме bullmq тот же outbox читает BullmqRelay.
 */
@Injectable()
export class OutboxProcessor {
  private readonly logger = new Logger(OutboxProcessor.name);
  private draining: Promise<void> | null = null;

  constructor(
    private readonly database: Database,
    private readonly registry: HandlerRegistry,
    private readonly executor: HandlerExecutor,
    private readonly clock: Clock,
  ) {}

  /** Захватить готовые записи (аренда на LEASE_MS), чтобы параллельные обработчики их не взяли. */
  async claim(limit = 50): Promise<OutboxRow[]> {
    const now = this.clock.now();
    return this.database.transaction(async () => {
      const rows = await sql<OutboxRow>`
        select id, kind, topic, payload, attempts, available_at
        from platform.outbox
        where dispatched_at is null and available_at <= ${now}
        order by available_at, created_at
        limit ${limit}
        for update skip locked`.execute(this.database.db());
      if (rows.rows.length === 0) return [];
      await this.database
        .db()
        .updateTable('platform.outbox')
        .set({ available_at: new Date(now.getTime() + LEASE_MS), attempts: sql`attempts + 1` })
        .where(
          'id',
          'in',
          rows.rows.map((r) => r.id),
        )
        .execute();
      return rows.rows.map((r) => ({ ...r, attempts: r.attempts + 1 }));
    });
  }

  /** Событие -> по одной записи-доставке на каждого подписчика. */
  async fanOutEvent(row: OutboxRow): Promise<void> {
    const event = row.payload as EventEnvelope;
    const handlers = this.registry.eventHandlers(event.type);
    await this.database.transaction(async () => {
      for (const handler of handlers) {
        const delivery: JobEnvelope<EventDeliveryPayload> = {
          id: newId(),
          name: EVENT_DELIVERY_TOPIC,
          payload: { handlerKey: handler.key, event },
          enqueuedAt: this.clock.now().toISOString(),
          meta: event.meta,
        };
        await this.database
          .db()
          .insertInto('platform.outbox')
          .values({
            id: delivery.id,
            kind: 'job',
            topic: EVENT_DELIVERY_TOPIC,
            payload: JSON.stringify(delivery),
            meta: JSON.stringify(event.meta),
            available_at: this.clock.now(),
          })
          .execute();
      }
      await this.markDispatched(row.id);
    });
  }

  async processRow(row: OutboxRow): Promise<void> {
    if (row.kind === 'event') {
      await this.fanOutEvent(row);
      return;
    }
    const envelope = row.payload as JobEnvelope;
    const policy: RetryPolicy = this.executor.retryPolicyFor(row.topic) ?? DEFAULT_RETRY;
    try {
      await this.executor.runJob(envelope);
      await this.markDispatched(row.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (row.attempts >= policy.attempts) {
        const handlerKey =
          row.topic === EVENT_DELIVERY_TOPIC
            ? (envelope.payload as EventDeliveryPayload).handlerKey
            : (this.registry.jobHandler(row.topic)?.key ?? null);
        await this.executor.recordFailure({
          kind: row.topic === EVENT_DELIVERY_TOPIC ? 'event' : 'job',
          topic: row.topic,
          handler: handlerKey,
          payload: envelope.payload,
          error,
          attempts: row.attempts,
        });
        await this.database
          .db()
          .updateTable('platform.outbox')
          .set({ dispatched_at: this.clock.now(), last_error: message.slice(0, 4000) })
          .where('id', '=', row.id)
          .execute();
      } else {
        const delay = backoffDelay(policy, row.attempts);
        this.logger.warn({ topic: row.topic, attempt: row.attempts, delay, err: message }, 'Job failed, will retry');
        await this.database
          .db()
          .updateTable('platform.outbox')
          .set({ available_at: new Date(this.clock.now().getTime() + delay), last_error: message.slice(0, 4000) })
          .where('id', '=', row.id)
          .execute();
      }
    }
  }

  /** Один проход: захватить и обработать готовые записи. Возвращает число обработанных. */
  async processOnce(limit = 50): Promise<number> {
    const rows = await this.claim(limit);
    for (const row of rows) {
      await this.processRow(row);
    }
    return rows.length;
  }

  /**
   * Обработать всё готовое, включая записи, порождённые обработчиками (цепочки событий).
   * В тестах: await processor.drain() после действия.
   */
  async drain(options: { maxRounds?: number } = {}): Promise<void> {
    if (this.draining) {
      await this.draining;
    }
    const run = async () => {
      const maxRounds = options.maxRounds ?? 100;
      for (let round = 0; round < maxRounds; round++) {
        const processed = await this.processOnce();
        if (processed === 0) return;
      }
      this.logger.warn('Outbox drain stopped after max rounds');
    };
    this.draining = run().finally(() => {
      this.draining = null;
    });
    await this.draining;
  }

  private async markDispatched(id: string): Promise<void> {
    await this.database
      .db()
      .updateTable('platform.outbox')
      .set({ dispatched_at: this.clock.now(), last_error: null })
      .where('id', '=', id)
      .execute();
  }
}
