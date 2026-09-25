/**
 * Формы отмены/отказа и частичного возврата: проверка ввода до отправки и сборка тела запроса.
 * Границы суммы возврата — из ответа сервера (refundable); окончательно всё проверяет сервер.
 */
import { CANCEL_REASON_CODES, type CancelOrderInput, type CancelReasonCode, type RefundOrderInput } from './types';

export type CancelMode = 'cancel' | 'reject';

export const REASON_MAX_LENGTH = 500;

/**
 * Причины для выбора сотрудником. «Не оплачен вовремя» — причина системной автоотмены, при отказе от
 * оплаченного заказа неуместна.
 */
export function reasonCodesFor(mode: CancelMode): CancelReasonCode[] {
  return mode === 'reject'
    ? CANCEL_REASON_CODES.filter((code) => code !== 'not_paid_in_time')
    : [...CANCEL_REASON_CODES];
}

export interface CancelFormValues {
  reasonCode?: CancelReasonCode | null;
  /** Комментарий (обязателен для «Другое»). */
  reason?: string | null;
  /** Вернуть не всю сумму (только с правом orders.refund). */
  partialRefund?: boolean;
  /** Сумма возврата, тиыны. */
  refundAmount?: number | null;
}

export interface CancelFormContext {
  mode: CancelMode;
  /** У сотрудника есть orders.refund в филиале заказа и заказ был оплачен. */
  refundAllowed: boolean;
  /** Сколько можно вернуть (тиыны, из ответа сервера). */
  refundable: number;
}

export type CancelFormIssue =
  | 'reason_required'
  | 'unknown_reason'
  | 'comment_required'
  | 'comment_too_long'
  | 'refund_not_allowed'
  | 'refund_amount_required'
  | 'refund_amount_negative'
  | 'refund_exceeds_refundable';

export type CancelFormErrors = Partial<Record<'reasonCode' | 'reason' | 'refundAmount', CancelFormIssue>>;

export function validateCancelForm(values: CancelFormValues, ctx: CancelFormContext): CancelFormErrors {
  const errors: CancelFormErrors = {};
  const comment = values.reason?.trim() ?? '';
  if (!values.reasonCode) errors.reasonCode = 'reason_required';
  else if (!reasonCodesFor(ctx.mode).includes(values.reasonCode)) errors.reasonCode = 'unknown_reason';
  if (values.reasonCode === 'other' && !comment) errors.reason = 'comment_required';
  if (comment.length > REASON_MAX_LENGTH) errors.reason = 'comment_too_long';
  if (values.partialRefund) {
    const amount = values.refundAmount;
    if (!ctx.refundAllowed) errors.refundAmount = 'refund_not_allowed';
    else if (amount === null || amount === undefined) errors.refundAmount = 'refund_amount_required';
    else if (amount < 0) errors.refundAmount = 'refund_amount_negative';
    else if (amount > ctx.refundable) errors.refundAmount = 'refund_exceeds_refundable';
  }
  return errors;
}

export function hasErrors(errors: object): boolean {
  return Object.keys(errors).length > 0;
}

/** Тело POST /cancel и /reject. Без частичной суммы сервер вернёт оплату полностью. */
export function toCancelPayload(values: CancelFormValues, ctx: CancelFormContext): CancelOrderInput {
  const reasonCode = values.reasonCode;
  if (!reasonCode) throw new Error('reasonCode is required');
  const reason = values.reason?.trim() || null;
  const partial = Boolean(values.partialRefund && ctx.refundAllowed && typeof values.refundAmount === 'number');
  return {
    reasonCode,
    reason,
    refundAmount: partial ? { amount: values.refundAmount as number, currency: 'KZT' } : null,
  };
}

export interface RefundFormValues {
  amount?: number | null;
  reason?: string | null;
}

export type RefundFormIssue = 'amount_required' | 'amount_positive' | 'amount_exceeds_refundable' | 'reason_required' | 'reason_too_long';
export type RefundFormErrors = Partial<Record<'amount' | 'reason', RefundFormIssue>>;

/** Частичный возврат по заказу (недовложение): сумма больше нуля и не больше refundable, причина обязательна. */
export function validateRefundForm(values: RefundFormValues, refundable: number): RefundFormErrors {
  const errors: RefundFormErrors = {};
  const reason = values.reason?.trim() ?? '';
  if (values.amount === null || values.amount === undefined) errors.amount = 'amount_required';
  else if (values.amount <= 0) errors.amount = 'amount_positive';
  else if (values.amount > refundable) errors.amount = 'amount_exceeds_refundable';
  if (!reason) errors.reason = 'reason_required';
  else if (reason.length > REASON_MAX_LENGTH) errors.reason = 'reason_too_long';
  return errors;
}

export function toRefundPayload(values: RefundFormValues): RefundOrderInput {
  if (typeof values.amount !== 'number') throw new Error('amount is required');
  return { amount: { amount: values.amount, currency: 'KZT' }, reason: (values.reason ?? '').trim() };
}
