/**
 * История статусов платежа для карточки: собирается из того, что вернул сервер (создание, уведомления
 * провайдера, оплата, возвраты). Отдельной истории переходов в API нет — это хронология событий,
 * а не вычисление статуса: текущий статус всегда берётся из payment.status.
 */
import type { Money } from '@aula/api-client';
import type { PaymentDetails, PaymentStatus, RefundStatus, WebhookEvent } from './types';

export type TimelineEvent =
  | { kind: 'created'; at: string }
  | { kind: 'webhook'; at: string; status: string; outcome: WebhookEvent['outcome'] }
  | { kind: 'paid'; at: string }
  | { kind: 'refund_requested'; at: string; amount: Money; refundId: string }
  | { kind: 'refund_completed'; at: string; amount: Money; refundId: string; status: Exclude<RefundStatus, 'pending'> }
  | { kind: 'current'; at: null; status: PaymentStatus };

function time(value: string): number {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Хронология (старые сверху) + текущий статус последней строкой. */
export function buildPaymentTimeline(details: PaymentDetails): TimelineEvent[] {
  const { payment } = details;
  const events: Array<Exclude<TimelineEvent, { kind: 'current' }>> = [{ kind: 'created', at: payment.createdAt }];
  for (const event of details.webhookEvents) {
    events.push({ kind: 'webhook', at: event.receivedAt, status: event.status, outcome: event.outcome });
  }
  if (payment.paidAt) events.push({ kind: 'paid', at: payment.paidAt });
  for (const refund of details.refunds) {
    events.push({ kind: 'refund_requested', at: refund.createdAt, amount: refund.amount, refundId: refund.id });
    if (refund.status !== 'pending' && refund.completedAt) {
      events.push({ kind: 'refund_completed', at: refund.completedAt, amount: refund.amount, refundId: refund.id, status: refund.status });
    }
  }
  // Стабильная сортировка: при равном времени сохраняется порядок добавления (создание → оплата → возврат).
  const sorted = events.map((event, index) => ({ event, index })).sort((a, b) => time(a.event.at) - time(b.event.at) || a.index - b.index);
  return [...sorted.map(({ event }) => event), { kind: 'current', at: null, status: payment.status }];
}
