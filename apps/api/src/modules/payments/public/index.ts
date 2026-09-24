/**
 * Публичный контракт модуля Payments: платежи, возвраты, подарочные сертификаты.
 * Все обращения к провайдерам (Kaspi, Halyk) — асинхронно через очередь.
 * Входящие вебхуки идемпотентны: повтор с тем же идентификатором не меняет состояние.
 */
import { Money, MoneyJson } from '../../../shared/kernel/money';

export const PaymentPurpose = {
  Order: 'order',
  ReservationDeposit: 'reservation_deposit',
  BanquetInvoice: 'banquet_invoice',
  GiftCertificate: 'gift_certificate',
} as const;
export type PaymentPurpose = (typeof PaymentPurpose)[keyof typeof PaymentPurpose];

export const PaymentMethod = {
  /** Онлайн: карта / Kaspi через платёжного провайдера (редирект на страницу оплаты). */
  Online: 'online',
  /** При получении: наличные или карта курьеру / на кассе. */
  OnReceipt: 'on_receipt',
  /** Списание с подарочного сертификата. */
  GiftCertificate: 'gift_certificate',
  /** Безналичный перевод по счёту (юрлица), регистрируется вручную финансами. */
  BankTransfer: 'bank_transfer',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentStatus = {
  /** Создан, инициирование у провайдера поставлено в очередь. */
  Created: 'created',
  /** Ждём оплату (есть ссылка на оплату; для оплаты при получении — ждём получения денег). */
  Pending: 'pending',
  Succeeded: 'succeeded',
  Failed: 'failed',
  Cancelled: 'cancelled',
  PartiallyRefunded: 'partially_refunded',
  Refunded: 'refunded',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export interface PaymentView {
  id: string;
  purpose: PaymentPurpose;
  referenceId: string;
  branchId: string | null;
  method: PaymentMethod;
  provider: string;
  status: PaymentStatus;
  amount: Money;
  refundedAmount: Money;
  /** Ссылка на страницу оплаты (для method=online), появляется после инициирования у провайдера. */
  paymentUrl: string | null;
  externalId: string | null;
  createdAt: Date;
  paidAt: Date | null;
  expiresAt: Date | null;
}

export interface CreatePaymentCommand {
  purpose: PaymentPurpose;
  referenceId: string;
  branchId: string | null;
  method: PaymentMethod;
  amount: Money;
  /** Описание для страницы оплаты: «Заказ GL-2026-000123». */
  description: string;
  customer: { phone: string | null; name?: string | null; email?: string | null };
  /** Куда вернуть гостя после оплаты (страница статуса). */
  returnUrl: string | null;
  /** Ключ идемпотентности: повторный вызов с тем же ключом вернёт тот же платёж. */
  idempotencyKey: string;
  /** Для method=gift_certificate. */
  certificateCode?: string;
  expiresAt?: Date | null;
}

export interface RefundView {
  id: string;
  paymentId: string;
  amount: Money;
  status: 'pending' | 'succeeded' | 'failed';
  reason: string;
  createdAt: Date;
}

export abstract class PaymentsService {
  /**
   * Создать платёж. Для online — инициирование у провайдера уходит в очередь, ссылка появится
   * в paymentUrl (клиент опрашивает статус). Для gift_certificate — списание сразу, статус succeeded,
   * событие PaymentSucceeded публикуется в той же транзакции. Для on_receipt — статус pending до получения денег.
   */
  abstract createPayment(cmd: CreatePaymentCommand): Promise<PaymentView>;
  abstract getPayment(paymentId: string): Promise<PaymentView>;
  abstract listForReference(purpose: PaymentPurpose, referenceId: string): Promise<PaymentView[]>;
  /** Отменить неоплаченный платёж (истёк срок, заказ отменён до оплаты). Идемпотентно. */
  abstract cancelPayment(paymentId: string, reason: string): Promise<void>;
  /**
   * Возврат (полный — amount не задан, или частичный). Уходит провайдеру через очередь.
   * Сумма возвратов не может превысить сумму платежа. Идемпотентно по idempotencyKey.
   */
  abstract requestRefund(input: { paymentId: string; amount?: Money; reason: string; idempotencyKey: string }): Promise<RefundView>;
  /** Отметить получение денег по оплате при получении (курьер/касса). */
  abstract markCollected(paymentId: string): Promise<void>;
  /** Зарегистрировать поступление по банковскому переводу (счёт юрлицу). */
  abstract registerBankTransfer(input: {
    purpose: PaymentPurpose;
    referenceId: string;
    branchId: string | null;
    amount: Money;
    paidAt: Date;
    documentNumber: string;
    idempotencyKey: string;
  }): Promise<PaymentView>;
}

export interface CertificateBalanceView {
  id: string;
  /** Маскированный код: ****-****-AB12. */
  maskedCode: string;
  kind: 'amount' | 'set';
  status: 'active' | 'redeemed' | 'expired' | 'blocked';
  nominal: Money;
  balance: Money;
  expiresAt: Date;
  setDescription: string | null;
}

/** Подарочные сертификаты: проверка и погашение с точки/из админки. */
export abstract class GiftCertificates {
  /** Проверка кода. Защита от подбора — на уровне HTTP и в самом сервисе (счётчик неудач). */
  abstract check(code: string): Promise<CertificateBalanceView>;
}

export const PaymentsEvents = {
  PaymentSucceeded: 'payments.payment_succeeded',
  PaymentFailed: 'payments.payment_failed',
  PaymentCancelled: 'payments.payment_cancelled',
  RefundSucceeded: 'payments.refund_succeeded',
  RefundFailed: 'payments.refund_failed',
  CertificateIssued: 'payments.certificate_issued',
  CertificateRedeemed: 'payments.certificate_redeemed',
  CertificateExpired: 'payments.certificate_expired',
} as const;

export interface PaymentEventPayload {
  paymentId: string;
  purpose: PaymentPurpose;
  referenceId: string;
  branchId: string | null;
  method: PaymentMethod;
  provider: string;
  amount: MoneyJson;
  occurredAt: string;
}

export interface RefundEventPayload {
  refundId: string;
  paymentId: string;
  purpose: PaymentPurpose;
  referenceId: string;
  branchId: string | null;
  amount: MoneyJson;
  /** Платёж возвращён полностью. */
  paymentFullyRefunded: boolean;
  /** Все платежи по объекту (referenceId) возвращены полностью. */
  referenceFullyRefunded: boolean;
  reason: string;
  occurredAt: string;
}

export interface CertificateIssuedPayload {
  certificateId: string;
  productId: string;
  kind: 'amount' | 'set';
  nominal: MoneyJson;
  price: MoneyJson;
  buyerPhone: string | null;
  branchId: string | null;
  occurredAt: string;
}

export interface CertificateRedeemedPayload {
  certificateId: string;
  amount: MoneyJson;
  balanceAfter: MoneyJson;
  branchId: string | null;
  /** Где погашен: заказ на сайте (order) или на точке (point). */
  channel: 'order' | 'point';
  referenceId: string | null;
  occurredAt: string;
}
