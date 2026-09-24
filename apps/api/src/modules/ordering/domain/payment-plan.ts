import { ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { PaymentMethod, PaymentStatus } from '../../payments/public';

/**
 * Оплата заказа (docs/decisions.md):
 * - сертификатом можно списать часть суммы (отдельный платёж gift_certificate): min(остаток сертификата, итог);
 * - остаток — онлайн (подтверждение только по факту успешного платежа) или при получении
 *   (заказ сразу paid — «оплата обеспечена», деньги отмечаются полученными при выполнении);
 * - нулевой остаток — заказ оплачен сразу.
 */
export interface CheckoutPaymentPlan {
  certificate: Money;
  remainder: Money;
}

export function planCheckoutPayments(total: Money, certificateBalance: Money | null): CheckoutPaymentPlan {
  const certificate = certificateBalance && certificateBalance.isPositive() ? certificateBalance.min(total) : Money.zero(total.currency);
  return { certificate, remainder: total.subtract(certificate) };
}

/** Платёж заказа с точки зрения расчётов заказа. */
export interface OrderPaymentPosition {
  paymentId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: Money;
  /** Уже возвращено провайдером/на сертификат. */
  refunded: Money;
  /** Запрошено к возврату и ещё не завершено. */
  pendingRefunds: Money;
}

/** Деньги по платежу получены (в том числе затем частично или полностью возвращены). */
export function isCaptured(status: PaymentStatus): boolean {
  return status === 'succeeded' || status === 'partially_refunded' || status === 'refunded';
}

/**
 * Сколько оплачено для подтверждения заказа: успешные платежи онлайн и сертификатом.
 * Оплата при получении подтверждением не является (деньги ещё не получены).
 */
export function confirmedAmount(payments: readonly OrderPaymentPosition[]): Money {
  return Money.sum(payments.filter((p) => p.method !== 'on_receipt' && isCaptured(p.status)).map((p) => p.amount));
}

export function isFullyPaid(payments: readonly OrderPaymentPosition[], total: Money): boolean {
  return confirmedAmount(payments).greaterThanOrEqual(total);
}

/** Сколько ещё можно вернуть по платежу. */
export function refundableAmount(p: OrderPaymentPosition): Money {
  if (!isCaptured(p.status)) return Money.zero(p.amount.currency);
  return p.amount.subtract(p.refunded).subtract(p.pendingRefunds).clampToZero();
}

export function totalRefundable(payments: readonly OrderPaymentPosition[]): Money {
  return Money.sum(payments.map(refundableAmount));
}

/** Порядок возврата: сначала деньги (онлайн, наличные/карта курьеру, перевод), сертификат — последним. */
const REFUND_PRIORITY: Record<PaymentMethod, number> = {
  online: 0,
  on_receipt: 1,
  bank_transfer: 2,
  gift_certificate: 3,
};

export interface RefundAllocation {
  paymentId: string;
  method: PaymentMethod;
  amount: Money;
}

/**
 * Распределение суммы возврата по платежам заказа. Полный возврат (amount = null) — весь остаток
 * каждого платежа. Частичный — сначала на деньги, затем на сертификат (удержанная рестораном часть
 * остаётся в первую очередь из сертификата). Больше возвратного остатка вернуть нельзя.
 */
export function allocateRefund(amount: Money | null, payments: readonly OrderPaymentPosition[]): RefundAllocation[] {
  const ordered = [...payments].sort((a, b) => REFUND_PRIORITY[a.method] - REFUND_PRIORITY[b.method]);
  const available = totalRefundable(ordered);
  if (amount === null) {
    return ordered
      .map((p) => ({ paymentId: p.paymentId, method: p.method, amount: refundableAmount(p) }))
      .filter((a) => a.amount.isPositive());
  }
  if (amount.isNegative()) throw new ValidationError('order.refund_invalid_amount', 'Refund amount must not be negative');
  if (amount.greaterThan(available)) {
    throw new ValidationError('order.refund_exceeds_paid', 'Refund amount exceeds the refundable amount of the order', {
      requested: amount.toJSON(),
      refundable: available.toJSON(),
    });
  }
  const result: RefundAllocation[] = [];
  let left = amount;
  for (const p of ordered) {
    if (!left.isPositive()) break;
    const part = refundableAmount(p).min(left);
    if (part.isPositive()) {
      result.push({ paymentId: p.paymentId, method: p.method, amount: part });
      left = left.subtract(part);
    }
  }
  return result;
}
