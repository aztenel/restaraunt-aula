/**
 * Платежи и возвраты (модуль Payments): формы ответов API — из docs/openapi.json (Schemas),
 * словари значений — зеркало apps/api/src/modules/payments/public (PaymentPurpose, PaymentMethod…).
 * Суммы — тиыны от сервера; фронт их только показывает.
 */
import type { Schemas } from '@aula/api-client';

export type Payment = Schemas['PaymentDto'];
export type PaymentDetails = Schemas['PaymentDetailsDto'];
export type PaymentRefund = Schemas['RefundDto'];
export type RefundResult = Schemas['RefundResultDto'];
export type WebhookEvent = Schemas['WebhookEventDto'];
export type ProviderLogEntry = Schemas['ProviderLogEntryDto'];
export type CreateRefundBody = Schemas['CreateRefundDto'];

export const PAYMENT_PURPOSES = ['order', 'reservation_deposit', 'banquet_invoice', 'gift_certificate'] as const;
export type PaymentPurpose = Payment['purpose'];

export const PAYMENT_METHODS = ['online', 'on_receipt', 'gift_certificate', 'bank_transfer'] as const;
export type PaymentMethod = Payment['method'];

export const PAYMENT_STATUSES = ['created', 'pending', 'succeeded', 'failed', 'cancelled', 'partially_refunded', 'refunded'] as const;
export type PaymentStatus = Payment['status'];

/**
 * Провайдеры онлайн-оплаты (адаптеры в apps/api/.../payments/infrastructure/adapters). Для остальных
 * способов в поле provider хранится сам способ (on_receipt, gift_certificate, bank_transfer).
 */
export const PAYMENT_PROVIDERS = ['kaspi', 'halyk', 'sandbox', 'on_receipt', 'gift_certificate', 'bank_transfer'] as const;

export const REFUND_STATUSES = ['pending', 'succeeded', 'failed'] as const;
export type RefundStatus = PaymentRefund['status'];

export const REFUND_MODES = ['gateway', 'certificate', 'manual'] as const;
export type RefundMode = PaymentRefund['mode'];

export interface PaymentListQuery {
  branchId?: string;
  purpose?: PaymentPurpose;
  method?: PaymentMethod;
  provider?: string;
  status?: PaymentStatus;
  referenceId?: string;
  /** ISO UTC, включительно. */
  from?: string;
  /** ISO UTC, не включительно. */
  to?: string;
  page: number;
  perPage: number;
}

export interface RefundQueueQuery {
  branchId?: string;
  status?: RefundStatus;
  mode?: RefundMode;
  page: number;
  perPage: number;
}
