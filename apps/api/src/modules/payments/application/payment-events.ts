import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { Payment } from '../domain/payment';
import { PaymentEventPayload, PaymentsEvents, PaymentStatus } from '../public';

type PaymentEventType =
  | typeof PaymentsEvents.PaymentSucceeded
  | typeof PaymentsEvents.PaymentFailed
  | typeof PaymentsEvents.PaymentCancelled;

export function paymentEventPayload(
  payment: Payment,
  now: Date,
  extra: { reason?: string | null; previousStatus?: PaymentStatus } = {},
): PaymentEventPayload {
  const s = payment.snapshot();
  return {
    paymentId: s.id,
    purpose: s.purpose,
    referenceId: s.referenceId,
    branchId: s.branchId,
    method: s.method,
    provider: s.provider,
    amount: s.amount.toJSON(),
    occurredAt: now.toISOString(),
    ...(extra.reason !== undefined ? { reason: extra.reason } : {}),
    ...(extra.previousStatus ? { previousStatus: extra.previousStatus } : {}),
  };
}

/** Публикация события платежа в транзакции изменения (transactional outbox). */
export async function publishPaymentEvent(
  events: EventBus,
  type: PaymentEventType,
  payment: Payment,
  now: Date,
  extra: { reason?: string | null; previousStatus?: PaymentStatus } = {},
): Promise<void> {
  await events.publish(type, paymentEventPayload(payment, now, extra), { aggregateId: payment.id, branchId: payment.branchId });
}

/** Снимок платежа для журнала действий (было/стало). */
export function paymentAuditState(payment: Payment): Record<string, unknown> {
  const s = payment.snapshot();
  return {
    status: s.status,
    amount: s.amount.toJSON(),
    refunded: s.refunded.toJSON(),
    method: s.method,
    provider: s.provider,
    externalId: s.externalId,
    paidAt: s.paidAt?.toISOString() ?? null,
  };
}
