/**
 * Формы счетов по банкету: выставление счёта, регистрация поступления по безналу, возврат.
 * Проверки — подсказки до отправки теми же правилами, что на сервере (сумма счёта и остаток к оплате
 * приходят с сервера; фронт их только сравнивает, не вычисляет). Суммы — целые тиыны.
 */
import { moneyInput, type BankTransferInput, type Invoice, type InvoicePayment, type IssueInvoiceInput, type Money, type PayerType, type RefundInput } from './types';

export const MAX_DOCUMENT_NUMBER_LENGTH = 60;
export const MAX_INVOICE_DESCRIPTION_LENGTH = 500;
export const MAX_REFUND_REASON_LENGTH = 500;
export const MAX_CANCEL_REASON_LENGTH = 1000;

// ---------------------------------------------------------------- выставление счёта

export interface IssueInvoiceFormValues {
  payerType: PayerType;
  /** Компания-заказчик (юрлицо); по умолчанию — компания заявки. */
  companyId: string | null;
  /** Сумма в тиынах; пусто — по умолчанию сервера (остаток предоплаты или до итога сметы). */
  amount: number | null;
  /** YYYY-MM-DD; пусто — по умолчанию сервера (3 дня физлицу, 5 — юрлицу, не позже мероприятия). */
  dueDate: string | null;
  description: string;
}

export type IssueInvoiceIssue = 'companyRequired' | 'amountPositive' | 'dueDateInPast' | 'descriptionTooLong';

export function validateIssueInvoice(values: IssueInvoiceFormValues, today: string): IssueInvoiceIssue[] {
  const issues: IssueInvoiceIssue[] = [];
  if (values.payerType === 'company' && !values.companyId) issues.push('companyRequired');
  if (values.amount !== null && (!Number.isSafeInteger(values.amount) || values.amount <= 0)) issues.push('amountPositive');
  if (values.dueDate && values.dueDate < today) issues.push('dueDateInPast');
  if (values.description.trim().length > MAX_INVOICE_DESCRIPTION_LENGTH) issues.push('descriptionTooLong');
  return issues;
}

export function toIssueInvoiceInput(values: IssueInvoiceFormValues): IssueInvoiceInput {
  const description = values.description.trim();
  return {
    payerType: values.payerType,
    ...(values.payerType === 'company' && values.companyId ? { companyId: values.companyId } : {}),
    ...(values.amount !== null ? { amount: moneyInput(values.amount) } : {}),
    ...(values.dueDate ? { dueDate: values.dueDate } : {}),
    ...(description ? { description } : {}),
  };
}

// ---------------------------------------------------------------- поступление по безналу

export interface BankTransferFormValues {
  /** Тиыны. */
  amount: number | null;
  /** Дата и время поступления, ISO. */
  paidAt: string | null;
  /** Номер платёжного поручения. */
  documentNumber: string;
}

export type BankTransferIssue =
  | 'amountRequired'
  | 'amountPositive'
  | 'overpayment'
  | 'paidAtRequired'
  | 'paidAtInFuture'
  | 'documentRequired'
  | 'documentTooLong';

/** Допуск на расхождение часов с сервером (сервер допускает 1 минуту). */
const FUTURE_TOLERANCE_MS = 60_000;

/**
 * Проверка поступления: сумма больше нуля и не больше остатка по счёту (остаток — от сервера;
 * инвариант ТЗ «сумма оплат не превышает сумму счёта»), дата не в будущем, номер документа обязателен.
 */
export function validateBankTransfer(values: BankTransferFormValues, context: { remaining: Money; nowMs: number }): BankTransferIssue[] {
  const issues: BankTransferIssue[] = [];
  if (values.amount === null) issues.push('amountRequired');
  else if (!Number.isSafeInteger(values.amount) || values.amount <= 0) issues.push('amountPositive');
  else if (values.amount > context.remaining.amount) issues.push('overpayment');
  if (!values.paidAt) issues.push('paidAtRequired');
  else {
    const paidAt = Date.parse(values.paidAt);
    if (!Number.isFinite(paidAt)) issues.push('paidAtRequired');
    else if (paidAt > context.nowMs + FUTURE_TOLERANCE_MS) issues.push('paidAtInFuture');
  }
  const doc = values.documentNumber.trim();
  if (!doc) issues.push('documentRequired');
  else if (doc.length > MAX_DOCUMENT_NUMBER_LENGTH) issues.push('documentTooLong');
  return issues;
}

export function toBankTransferInput(values: BankTransferFormValues): BankTransferInput {
  return { amount: moneyInput(values.amount ?? 0), paidAt: values.paidAt ?? '', documentNumber: values.documentNumber.trim() };
}

/** Детали ошибки 409 banquet_invoice.overpayment: остаток, который ещё можно принять. */
export function overpaymentRemaining(details: Record<string, unknown>): Money | null {
  const remaining = details.remaining as { amount?: unknown; currency?: unknown } | undefined;
  if (!remaining || typeof remaining.amount !== 'number') return null;
  return { amount: remaining.amount, currency: 'KZT' };
}

// ---------------------------------------------------------------- возврат

export interface RefundFormValues {
  /** Тиыны; пусто — полный возврат (остаток платежа считает сервер). */
  amount: number | null;
  reason: string;
}

export type RefundIssue = 'amountPositive' | 'exceedsRefundable' | 'nothingToRefund' | 'reasonRequired' | 'reasonTooLong';

/**
 * Сумма частичного возврата — положительная и не больше того, что ещё можно вернуть по платежу
 * (refundable считает сервер: сумма минус прошедшие и ожидающие возвраты).
 */
export function validateRefund(values: RefundFormValues, payment: Pick<InvoicePayment, 'refundable'>): RefundIssue[] {
  const issues: RefundIssue[] = [];
  if (payment.refundable.amount <= 0) issues.push('nothingToRefund');
  else if (values.amount !== null) {
    if (!Number.isSafeInteger(values.amount) || values.amount <= 0) issues.push('amountPositive');
    else if (values.amount > payment.refundable.amount) issues.push('exceedsRefundable');
  }
  const reason = values.reason.trim();
  if (!reason) issues.push('reasonRequired');
  else if (reason.length > MAX_REFUND_REASON_LENGTH) issues.push('reasonTooLong');
  return issues;
}

export function toRefundInput(values: RefundFormValues, paymentId: string, idempotencyKey: string): RefundInput {
  return {
    paymentId,
    reason: values.reason.trim(),
    idempotencyKey,
    ...(values.amount !== null ? { amount: moneyInput(values.amount) } : {}),
  };
}

/** Ключ идемпотентности возврата — один на открытие диалога (повторное нажатие не создаст второй возврат). */
export function newIdempotencyKey(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `banquet-refund-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------- действия со счётом

export interface InvoiceAbilities {
  invoice: boolean;
  refund: boolean;
}

export interface InvoiceActions {
  registerPayment: boolean;
  cancel: boolean;
}

/**
 * Кнопки счёта: поступление — пока счёт ждёт оплаты (выставлен / оплачен частично); отмена — только
 * выставленный без оплат (иначе сервер попросит оформить возврат).
 */
export function invoiceActions(invoice: Pick<Invoice, 'status' | 'paid'>, abilities: InvoiceAbilities): InvoiceActions {
  const open = invoice.status === 'issued' || invoice.status === 'partially_paid';
  return {
    registerPayment: abilities.invoice && open,
    cancel: abilities.invoice && invoice.status === 'issued' && invoice.paid.amount === 0,
  };
}

/** Возврат по платежу: право payments.refund и сервер говорит, что ещё есть что вернуть. */
export function canRefundPayment(payment: Pick<InvoicePayment, 'refundable'>, abilities: InvoiceAbilities): boolean {
  return abilities.refund && payment.refundable.amount > 0;
}

export interface PaymentLinkActions {
  /** Отправить ссылку на оплату ещё раз (прежняя не прошла — сервер создаст новую на остаток). */
  resend: boolean;
  /** Перевыпустить действующую ссылку: прежний неоплаченный платёж отменяется. */
  regenerate: boolean;
}

/** Ссылка на онлайн-оплату счёта физлица — по флагу сервера canResendPaymentLink. */
export function paymentLinkActions(invoice: Pick<Invoice, 'canResendPaymentLink' | 'paymentUrl'>, abilities: Pick<InvoiceAbilities, 'invoice'>): PaymentLinkActions {
  const allowed = abilities.invoice && invoice.canResendPaymentLink;
  return { resend: allowed, regenerate: allowed && invoice.paymentUrl !== null };
}
