import { describe, expect, it } from 'vitest';
import {
  hasErrors,
  reasonCodesFor,
  toCancelPayload,
  toRefundPayload,
  validateCancelForm,
  validateRefundForm,
  type CancelFormContext,
} from './cancel-form';

const cancelCtx: CancelFormContext = { mode: 'cancel', refundAllowed: true, refundable: 500_000 };
const rejectCtx: CancelFormContext = { mode: 'reject', refundAllowed: false, refundable: 500_000 };

describe('коды причин отмены', () => {
  it('отказ от оплаченного заказа — без «не оплачен вовремя»', () => {
    expect(reasonCodesFor('reject')).not.toContain('not_paid_in_time');
    expect(reasonCodesFor('reject')).toContain('out_of_stock');
    expect(reasonCodesFor('cancel')).toEqual(['guest_request', 'not_paid_in_time', 'out_of_stock', 'cannot_deliver', 'duplicate', 'other']);
  });
});

describe('форма отмены / отказа', () => {
  it('причина обязательна', () => {
    expect(validateCancelForm({}, cancelCtx)).toEqual({ reasonCode: 'reason_required' });
    expect(validateCancelForm({ reasonCode: null }, cancelCtx).reasonCode).toBe('reason_required');
  });

  it('недопустимая для режима причина', () => {
    expect(validateCancelForm({ reasonCode: 'not_paid_in_time' }, rejectCtx).reasonCode).toBe('unknown_reason');
    expect(hasErrors(validateCancelForm({ reasonCode: 'not_paid_in_time' }, cancelCtx))).toBe(false);
  });

  it('«Другое» требует комментарий; длина комментария ограничена', () => {
    expect(validateCancelForm({ reasonCode: 'other', reason: '   ' }, cancelCtx)).toEqual({ reason: 'comment_required' });
    expect(hasErrors(validateCancelForm({ reasonCode: 'other', reason: 'Гость передумал' }, cancelCtx))).toBe(false);
    expect(validateCancelForm({ reasonCode: 'duplicate', reason: 'x'.repeat(501) }, cancelCtx)).toEqual({ reason: 'comment_too_long' });
  });

  it('частичный возврат: только с правом, сумма обязательна, от 0 до refundable', () => {
    expect(validateCancelForm({ reasonCode: 'out_of_stock', partialRefund: true, refundAmount: 100 }, rejectCtx)).toEqual({
      refundAmount: 'refund_not_allowed',
    });
    expect(validateCancelForm({ reasonCode: 'out_of_stock', partialRefund: true }, cancelCtx)).toEqual({ refundAmount: 'refund_amount_required' });
    expect(validateCancelForm({ reasonCode: 'out_of_stock', partialRefund: true, refundAmount: -1 }, cancelCtx)).toEqual({
      refundAmount: 'refund_amount_negative',
    });
    expect(validateCancelForm({ reasonCode: 'out_of_stock', partialRefund: true, refundAmount: 500_001 }, cancelCtx)).toEqual({
      refundAmount: 'refund_exceeds_refundable',
    });
    expect(hasErrors(validateCancelForm({ reasonCode: 'out_of_stock', partialRefund: true, refundAmount: 500_000 }, cancelCtx))).toBe(false);
    expect(hasErrors(validateCancelForm({ reasonCode: 'out_of_stock', partialRefund: true, refundAmount: 0 }, cancelCtx))).toBe(false);
  });

  it('сумма без флага частичного возврата не проверяется и не отправляется', () => {
    expect(hasErrors(validateCancelForm({ reasonCode: 'guest_request', refundAmount: 999_999_999 }, rejectCtx))).toBe(false);
    expect(toCancelPayload({ reasonCode: 'guest_request', refundAmount: 100 }, cancelCtx)).toEqual({
      reasonCode: 'guest_request',
      reason: null,
      refundAmount: null,
    });
  });

  it('тело запроса: комментарий обрезается, сумма — Money в тиынах', () => {
    expect(toCancelPayload({ reasonCode: 'out_of_stock', reason: '  нет лагмана ', partialRefund: true, refundAmount: 250_050 }, cancelCtx)).toEqual({
      reasonCode: 'out_of_stock',
      reason: 'нет лагмана',
      refundAmount: { amount: 250_050, currency: 'KZT' },
    });
    // Без права — полный возврат (сумму решает сервер).
    expect(toCancelPayload({ reasonCode: 'out_of_stock', partialRefund: true, refundAmount: 100 }, rejectCtx).refundAmount).toBeNull();
    expect(() => toCancelPayload({}, cancelCtx)).toThrow();
  });
});

describe('форма частичного возврата', () => {
  it('сумма больше нуля и не больше refundable, причина обязательна', () => {
    expect(validateRefundForm({}, 10_000)).toEqual({ amount: 'amount_required', reason: 'reason_required' });
    expect(validateRefundForm({ amount: 0, reason: 'соус' }, 10_000)).toEqual({ amount: 'amount_positive' });
    expect(validateRefundForm({ amount: 10_001, reason: 'соус' }, 10_000)).toEqual({ amount: 'amount_exceeds_refundable' });
    expect(validateRefundForm({ amount: 10_000, reason: '  ' }, 10_000)).toEqual({ reason: 'reason_required' });
    expect(validateRefundForm({ amount: 500, reason: 'y'.repeat(501) }, 10_000)).toEqual({ reason: 'reason_too_long' });
    expect(validateRefundForm({ amount: 10_000, reason: 'Недовложение' }, 10_000)).toEqual({});
  });

  it('тело запроса', () => {
    expect(toRefundPayload({ amount: 150_000, reason: ' Не положили соус ' })).toEqual({
      amount: { amount: 150_000, currency: 'KZT' },
      reason: 'Не положили соус',
    });
  });
});
