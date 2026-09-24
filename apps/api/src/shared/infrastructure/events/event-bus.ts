import { Injectable } from '@nestjs/common';
import { Clock } from '../../kernel/clock';
import { newId } from '../../kernel/ids';
import { RequestContext } from '../context/request-context';
import { Database } from '../database/database';
import { OutboxSignal } from './outbox-signal';
import { EventEnvelope, EventMeta, JobEnvelope } from './types';

/**
 * Публикация доменных событий через transactional outbox.
 * Вызывать внутри транзакции изменения данных: событие уйдёт подписчикам только после коммита.
 */
@Injectable()
export class EventBus {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
    private readonly signal: OutboxSignal,
  ) {}

  async publish<T>(type: string, payload: T, meta: Omit<EventMeta, 'actorUserId' | 'requestId'> = {}): Promise<string> {
    const ctx = RequestContext.current();
    const envelope: EventEnvelope<T> = {
      id: newId(),
      type,
      occurredAt: this.clock.now().toISOString(),
      payload,
      meta: {
        aggregateId: meta.aggregateId ?? null,
        branchId: meta.branchId ?? null,
        actorUserId: ctx?.actor?.userId ?? null,
        requestId: ctx?.requestId ?? null,
      },
    };
    await this.database
      .db()
      .insertInto('platform.outbox')
      .values({
        id: envelope.id,
        kind: 'event',
        topic: type,
        payload: JSON.stringify(envelope),
        meta: JSON.stringify(envelope.meta),
        available_at: this.clock.now(),
      })
      .execute();
    this.database.afterCommit(() => this.signal.notify());
    return envelope.id;
  }
}

export interface EnqueueOptions {
  /** Отложить выполнение на N мс. */
  delayMs?: number;
  /** Выполнить не раньше момента. */
  runAt?: Date;
  branchId?: string | null;
  aggregateId?: string | null;
}

/**
 * Постановка фоновой задачи. Все обращения к внешним API — только через задачи:
 * с повторами, экспоненциальной задержкой и очередью неудач.
 */
@Injectable()
export class JobQueue {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
    private readonly signal: OutboxSignal,
  ) {}

  async enqueue<T>(name: string, payload: T, options: EnqueueOptions = {}): Promise<string> {
    const ctx = RequestContext.current();
    const now = this.clock.now();
    const availableAt = options.runAt ?? new Date(now.getTime() + (options.delayMs ?? 0));
    const envelope: JobEnvelope<T> = {
      id: newId(),
      name,
      payload,
      enqueuedAt: now.toISOString(),
      meta: {
        aggregateId: options.aggregateId ?? null,
        branchId: options.branchId ?? null,
        actorUserId: ctx?.actor?.userId ?? null,
        requestId: ctx?.requestId ?? null,
      },
    };
    await this.database
      .db()
      .insertInto('platform.outbox')
      .values({
        id: envelope.id,
        kind: 'job',
        topic: name,
        payload: JSON.stringify(envelope),
        meta: JSON.stringify(envelope.meta),
        available_at: availableAt,
      })
      .execute();
    this.database.afterCommit(() => this.signal.notify());
    return envelope.id;
  }
}
