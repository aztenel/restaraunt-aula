/**
 * Публичный контракт модуля Banquet: заявки на банкеты и кейтеринг, сметы, счета, документы.
 * Другим модулям нужны только события (отчётность, база гостей, уведомления).
 */
import { MoneyJson } from '../../../shared/kernel/money';

export const BanquetStatus = {
  New: 'new',
  InProgress: 'in_progress',
  QuoteSent: 'quote_sent',
  Agreed: 'agreed',
  Prepaid: 'prepaid',
  Held: 'held',
  Cancelled: 'cancelled',
} as const;
export type BanquetStatus = (typeof BanquetStatus)[keyof typeof BanquetStatus];

export const BanquetEvents = {
  RequestCreated: 'banquet.request_created',
  StatusChanged: 'banquet.status_changed',
  RequestAssigned: 'banquet.request_assigned',
  InvoiceIssued: 'banquet.invoice_issued',
  InvoicePaymentRecorded: 'banquet.invoice_payment_recorded',
  ActIssued: 'banquet.act_issued',
} as const;

export interface BanquetContact {
  customerId: string | null;
  name: string;
  phone: string;
  email: string | null;
}

export interface BanquetRequestCreatedPayload {
  requestId: string;
  number: string;
  branchId: string | null;
  isOffsite: boolean;
  eventDate: string;
  eventType: string;
  guests: number;
  budget: MoneyJson | null;
  managerId: string;
  contact: BanquetContact;
  source: 'web' | 'admin';
  occurredAt: string;
}

export interface BanquetStatusChangedPayload {
  requestId: string;
  number: string;
  branchId: string | null;
  isOffsite: boolean;
  from: BanquetStatus;
  to: BanquetStatus;
  managerId: string;
  eventDate: string;
  guests: number;
  /** Итог актуальной версии сметы (если есть). */
  quoteTotal: MoneyJson | null;
  contact: BanquetContact;
  reason: string | null;
  occurredAt: string;
}

export interface BanquetRequestAssignedPayload {
  requestId: string;
  number: string;
  branchId: string | null;
  managerId: string;
  previousManagerId: string | null;
  occurredAt: string;
}

export interface BanquetInvoiceIssuedPayload {
  invoiceId: string;
  number: string;
  requestId: string;
  branchId: string | null;
  payerType: 'individual' | 'company';
  company: { name: string; bin: string } | null;
  amount: MoneyJson;
  dueDate: string;
  occurredAt: string;
}

export interface BanquetInvoicePaymentPayload {
  invoiceId: string;
  requestId: string;
  branchId: string | null;
  paymentId: string;
  amount: MoneyJson;
  paidTotal: MoneyJson;
  remaining: MoneyJson;
  fullyPaid: boolean;
  occurredAt: string;
}

export interface BanquetActIssuedPayload {
  actId: string;
  number: string;
  requestId: string;
  branchId: string | null;
  amount: MoneyJson;
  vatAmount: MoneyJson;
  company: { name: string; bin: string } | null;
  occurredAt: string;
}
