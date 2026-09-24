/**
 * Конверт доменного события. Событие публикуется модулем-владельцем данных
 * и доставляется подписчикам других модулей асинхронно (через outbox и очередь).
 */
export interface EventMeta {
  aggregateId?: string | null;
  branchId?: string | null;
  actorUserId?: string | null;
  requestId?: string | null;
}

export interface EventEnvelope<T = unknown> {
  id: string;
  type: string;
  occurredAt: string;
  payload: T;
  meta: EventMeta;
}

export interface JobEnvelope<T = unknown> {
  id: string;
  name: string;
  payload: T;
  enqueuedAt: string;
  meta: EventMeta;
}

export interface RetryPolicy {
  /** Сколько раз пытаться всего (включая первую попытку). */
  attempts: number;
  /** Базовая задержка экспоненциального backoff, мс: delay * 2^(attempt-1). */
  backoffMs: number;
  /** Потолок задержки, мс. */
  maxBackoffMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { attempts: 8, backoffMs: 5_000, maxBackoffMs: 30 * 60_000 };

export function backoffDelay(policy: RetryPolicy, attempt: number): number {
  const delay = policy.backoffMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(delay, policy.maxBackoffMs);
}

/** Внутренняя тема outbox для вызова одного обработчика события. */
export const EVENT_DELIVERY_TOPIC = '__event_delivery__';

export interface EventDeliveryPayload {
  handlerKey: string;
  event: EventEnvelope;
}
