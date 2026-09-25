import { InvariantViolationError, ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { StateMachine } from '../../../shared/kernel/state-machine';

/**
 * Заказ сертификатов: покупка на сайте (online) или корпоративная продажа по счёту (manual).
 *
 *   awaiting_payment -> issued (оплата прошла, сертификаты выпущены) | payment_failed
 *   payment_failed -> issued  (поздняя оплата: провайдер подтвердил списание после отказа —
 *                              гость заплатил, сертификаты выпускаются)
 *   payment_failed -> awaiting_payment (гость повторяет оплату со страницы заказа — новый платёж)
 */
export const CertificateOrderStatus = {
  AwaitingPayment: 'awaiting_payment',
  Issued: 'issued',
  PaymentFailed: 'payment_failed',
} as const;
export type CertificateOrderStatus = (typeof CertificateOrderStatus)[keyof typeof CertificateOrderStatus];

export const CertificateOrderFsm = new StateMachine<CertificateOrderStatus>('certificate_order', {
  awaiting_payment: ['issued', 'payment_failed'],
  payment_failed: ['issued', 'awaiting_payment'],
  issued: [],
});

export type DeliveryChannel = 'email' | 'whatsapp' | 'none';

/** Лимиты количества: на сайте 1..10, корпоративная продажа — до 100 за раз. */
export const ONLINE_MAX_QUANTITY = 10;
export const MANUAL_MAX_QUANTITY = 100;

export function assertQuantity(quantity: number, source: 'online' | 'manual'): void {
  const max = source === 'online' ? ONLINE_MAX_QUANTITY : MANUAL_MAX_QUANTITY;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) {
    throw new ValidationError('certificate_order.quantity_invalid', `Quantity must be 1..${max}`, { max });
  }
}

export interface ContactInput {
  email?: string | null;
  phone?: string | null;
}

/**
 * Куда доставить сертификат: контакты получателя, если указаны, иначе — покупателя
 * (покупатель вручит сам). Email-канал требует email, WhatsApp — телефон.
 */
export function resolveDeliveryTarget(
  channel: DeliveryChannel,
  recipient: ContactInput,
  buyer: ContactInput,
): { email: string | null; phone: string | null } {
  if (channel === 'none') return { email: null, phone: null };
  if (channel === 'email') {
    const email = recipient.email?.trim() || buyer.email?.trim() || null;
    if (!email) throw new ValidationError('certificate_order.email_required', 'Email is required for email delivery');
    return { email, phone: null };
  }
  const phone = recipient.phone?.trim() || buyer.phone?.trim() || null;
  if (!phone) throw new ValidationError('certificate_order.phone_required', 'Phone is required for WhatsApp delivery');
  return { email: null, phone };
}

/**
 * Разделить сумму на n частей в тиынах без потерь: первые части получают на 1 тиын больше.
 * Нужна, когда корпоративная цена задана итогом, а выручка признаётся по каждому сертификату.
 */
export function splitEvenly(total: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new InvariantViolationError('money.split_invalid', 'Parts must be a positive integer');
  }
  const base = Math.floor(total.amount / parts);
  const remainder = total.amount - base * parts;
  return Array.from({ length: parts }, (_, i) => Money.of(base + (i < remainder ? 1 : 0), total.currency));
}
