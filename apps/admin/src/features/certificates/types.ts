/**
 * Подарочные сертификаты (модуль Payments): формы ответов API — из docs/openapi.json (Schemas).
 * Суммы — тиыны от сервера. Полный код сертификата админке не приходит (только маска ****-****-AB12).
 */
import type { Schemas } from '@aula/api-client';

export type Certificate = Schemas['CertificateDto'];
export type CertificateDetails = Schemas['CertificateDetailsDto'];
export type CertificateBalance = Schemas['AdminCertificateBalanceDto'];
export type RedeemResult = Schemas['RedeemResultDto'];
export type LedgerEntry = Schemas['CertificateLedgerEntryDto'];
export type CertificateProduct = Schemas['CertificateProductDto'];
export type CertificateProductInput = Schemas['CertificateProductInputDto'];
export type CertificateReport = Schemas['CertificateReportDto'];
export type ManualIssueBody = Schemas['ManualIssueDto'];
export type ManualIssueResult = Schemas['ManualIssueResultDto'];
export type RedeemBody = Schemas['RedeemCertificateDto'];
export type ResendBody = Schemas['ResendCertificateDto'];

export const CERTIFICATE_STATUSES = ['active', 'redeemed', 'expired', 'blocked'] as const;
export type CertificateStatus = Certificate['status'];

export const CERTIFICATE_KINDS = ['amount', 'set'] as const;
export type CertificateKind = Certificate['kind'];

export const LEDGER_KINDS = ['issue', 'debit', 'credit', 'expire', 'reinstate'] as const;
export type LedgerKind = LedgerEntry['kind'];

export const DELIVERY_CHANNELS = ['email', 'whatsapp', 'none'] as const;
export type DeliveryChannel = ManualIssueBody['deliveryChannel'];

export const CONTENT_LOCALES = ['ru', 'kk', 'en'] as const;
export type ContentLocale = ManualIssueBody['locale'];

export interface CertificateListQuery {
  /** Последние 4 символа кода. */
  q?: string;
  /** Телефон покупателя или получателя. */
  phone?: string;
  status?: CertificateStatus;
  /** Заказ сертификатов (ссылка из карточки платежа). */
  orderId?: string;
  page: number;
  perPage: number;
}
