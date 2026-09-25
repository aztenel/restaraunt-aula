/**
 * Формы возвратов: возврат по платежу (payments.refund) и ручное подтверждение/отклонение возврата
 * финансистом (payments.manual). Только проверка ввода до отправки и сборка тела запроса —
 * границы суммы приходят с сервера (refundableAmount), окончательно всё проверяет сервер
 * (payment.refund_exceeds, refund.reason_required…).
 */
import type { CreateRefundBody, PaymentMethod, RefundMode } from './types';

/** Как CreateRefundDto/RejectRefundDto: причина 2–500 символов; комментарий подтверждения до 500. */
export const REFUND_REASON_MIN = 2;
export const REFUND_REASON_MAX = 500;
export const CONFIRM_COMMENT_MAX = 500;

/** full — весь невозвращённый остаток (сумма не передаётся, её берёт сервер); partial — указанная сумма. */
export type RefundAmountMode = 'full' | 'partial';

export interface PaymentRefundFormValues {
  mode?: RefundAmountMode;
  /** Сумма частичного возврата, тиыны. */
  amount?: number | null;
  reason?: string | null;
}

export type PaymentRefundIssue =
  | 'nothing_to_refund'
  | 'amount_required'
  | 'amount_positive'
  | 'amount_exceeds_refundable'
  | 'reason_required'
  | 'reason_too_short'
  | 'reason_too_long';

export type PaymentRefundErrors = Partial<Record<'mode' | 'amount' | 'reason', PaymentRefundIssue>>;

export type ReasonIssue = 'reason_required' | 'reason_too_short' | 'reason_too_long';

/** Причина: обязательна, 2–500 символов после обрезки пробелов. */
export function reasonIssue(reason: string | null | undefined): ReasonIssue | undefined {
  const text = reason?.trim() ?? '';
  if (!text) return 'reason_required';
  if (text.length < REFUND_REASON_MIN) return 'reason_too_short';
  if (text.length > REFUND_REASON_MAX) return 'reason_too_long';
  return undefined;
}

/**
 * Проверка формы возврата. refundable — сколько ещё можно вернуть (тиыны, PaymentDto.refundableAmount
 * с учётом ожидающих возвратов).
 */
export function validatePaymentRefund(values: PaymentRefundFormValues, refundable: number): PaymentRefundErrors {
  const errors: PaymentRefundErrors = {};
  if (refundable <= 0) errors.mode = 'nothing_to_refund';
  if ((values.mode ?? 'full') === 'partial') {
    const amount = values.amount;
    if (amount === null || amount === undefined) errors.amount = 'amount_required';
    else if (amount <= 0) errors.amount = 'amount_positive';
    else if (amount > refundable) errors.amount = 'amount_exceeds_refundable';
  }
  const reason = reasonIssue(values.reason);
  if (reason) errors.reason = reason;
  return errors;
}

export function hasErrors(errors: object): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Тело POST /admin/payments/{id}/refunds. Полный возврат — без суммы (сервер вернёт остаток),
 * частичный — с суммой. Ключ идемпотентности один на открытие диалога: повтор нажатия
 * не создаёт второй возврат.
 */
export function toCreateRefundBody(values: PaymentRefundFormValues, idempotencyKey: string): CreateRefundBody {
  const reason = (values.reason ?? '').trim();
  if ((values.mode ?? 'full') === 'partial') {
    if (typeof values.amount !== 'number') throw new Error('amount is required for a partial refund');
    return { amount: { amount: values.amount, currency: 'KZT' }, reason, idempotencyKey };
  }
  return { reason, idempotencyKey };
}

/** Ключ идемпотентности (8–100 символов по контракту API). */
export function newIdempotencyKey(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `admin-${random}`;
}

/**
 * Как будет исполнен возврат — только подсказка сотруднику (зеркало refundModeFor на сервере):
 * онлайн — через провайдера, сертификатом — обратно на сертификат, наличные/перевод — вручную финансистом.
 */
export function refundModeForMethod(method: PaymentMethod): RefundMode {
  switch (method) {
    case 'online':
      return 'gateway';
    case 'gift_certificate':
      return 'certificate';
    default:
      return 'manual';
  }
}

export type ConfirmCommentIssue = 'comment_too_long';

/** Комментарий подтверждения ручного возврата (как вернули деньги) — необязателен, до 500 символов. */
export function confirmCommentIssue(comment: string | null | undefined): ConfirmCommentIssue | undefined {
  return (comment?.trim().length ?? 0) > CONFIRM_COMMENT_MAX ? 'comment_too_long' : undefined;
}
