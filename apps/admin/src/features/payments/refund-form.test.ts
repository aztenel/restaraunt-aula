import { describe, expect, it } from 'vitest';
import { buildPaymentTimeline } from './payment-timeline';
import {
  confirmCommentIssue,
  newIdempotencyKey,
  reasonIssue,
  refundModeForMethod,
  toCreateRefundBody,
  validatePaymentRefund,
} from './refund-form';
import type { PaymentDetails } from './types';

describe('возврат по платежу: проверка формы', () => {
  const refundable = 250_000; // 2 500 ₸

  it('полный возврат: достаточно причины, сумма не нужна', () => {
    expect(validatePaymentRefund({ mode: 'full', reason: 'Гость отказался' }, refundable)).toEqual({});
    // режим по умолчанию — весь остаток
    expect(validatePaymentRefund({ reason: 'Гость отказался' }, refundable)).toEqual({});
  });

  it('частичный возврат: сумма обязательна, больше нуля и не больше остатка', () => {
    expect(validatePaymentRefund({ mode: 'partial', amount: null, reason: 'Недовложение' }, refundable)).toEqual({ amount: 'amount_required' });
    expect(validatePaymentRefund({ mode: 'partial', amount: 0, reason: 'Недовложение' }, refundable)).toEqual({ amount: 'amount_positive' });
    expect(validatePaymentRefund({ mode: 'partial', amount: -100, reason: 'Недовложение' }, refundable)).toEqual({ amount: 'amount_positive' });
    expect(validatePaymentRefund({ mode: 'partial', amount: refundable + 1, reason: 'Недовложение' }, refundable)).toEqual({
      amount: 'amount_exceeds_refundable',
    });
    expect(validatePaymentRefund({ mode: 'partial', amount: refundable, reason: 'Недовложение' }, refundable)).toEqual({});
    expect(validatePaymentRefund({ mode: 'partial', amount: 1, reason: 'Недовложение' }, refundable)).toEqual({});
  });

  it('сумма в полном режиме не проверяется (сервер вернёт весь остаток)', () => {
    expect(validatePaymentRefund({ mode: 'full', amount: refundable * 10, reason: 'Отмена' }, refundable)).toEqual({});
  });

  it('причина: обязательна, от 2 до 500 символов', () => {
    expect(validatePaymentRefund({ mode: 'full', reason: '   ' }, refundable)).toEqual({ reason: 'reason_required' });
    expect(validatePaymentRefund({ mode: 'full', reason: 'а' }, refundable)).toEqual({ reason: 'reason_too_short' });
    expect(validatePaymentRefund({ mode: 'full', reason: 'x'.repeat(501) }, refundable)).toEqual({ reason: 'reason_too_long' });
    expect(reasonIssue(' ок ')).toBeUndefined();
  });

  it('нечего возвращать — форма не отправляется', () => {
    expect(validatePaymentRefund({ mode: 'full', reason: 'Отмена' }, 0)).toEqual({ mode: 'nothing_to_refund' });
  });

  it('тело запроса: полный — без суммы, частичный — сумма в тиынах; причина обрезается', () => {
    expect(toCreateRefundBody({ mode: 'full', amount: 5000, reason: '  Отмена  ' }, 'admin-key-1')).toEqual({
      reason: 'Отмена',
      idempotencyKey: 'admin-key-1',
    });
    expect(toCreateRefundBody({ mode: 'partial', amount: 120_050, reason: 'Недовложение' }, 'admin-key-2')).toEqual({
      amount: { amount: 120_050, currency: 'KZT' },
      reason: 'Недовложение',
      idempotencyKey: 'admin-key-2',
    });
    expect(() => toCreateRefundBody({ mode: 'partial', amount: null, reason: 'x' }, 'admin-key-3')).toThrow();
  });

  it('ключ идемпотентности: 8–100 символов, разный для разных диалогов', () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a.length).toBeLessThanOrEqual(100);
    expect(a).not.toBe(b);
  });

  it('подсказка о способе возврата по способу оплаты', () => {
    expect(refundModeForMethod('online')).toBe('gateway');
    expect(refundModeForMethod('gift_certificate')).toBe('certificate');
    expect(refundModeForMethod('on_receipt')).toBe('manual');
    expect(refundModeForMethod('bank_transfer')).toBe('manual');
  });

  it('комментарий подтверждения ручного возврата — до 500 символов', () => {
    expect(confirmCommentIssue(undefined)).toBeUndefined();
    expect(confirmCommentIssue('Наличными на кассе')).toBeUndefined();
    expect(confirmCommentIssue('x'.repeat(501))).toBe('comment_too_long');
  });
});

describe('история статусов платежа', () => {
  const money = (amount: number) => ({ amount, currency: 'KZT' as const });
  const details = {
    payment: {
      id: 'p1',
      status: 'partially_refunded',
      createdAt: '2026-09-25T10:00:00.000Z',
      paidAt: '2026-09-25T10:02:00.000Z',
    },
    refunds: [
      {
        id: 'r1',
        amount: money(50_000),
        status: 'succeeded',
        createdAt: '2026-09-25T12:00:00.000Z',
        completedAt: '2026-09-25T12:05:00.000Z',
      },
      { id: 'r2', amount: money(10_000), status: 'pending', createdAt: '2026-09-25T13:00:00.000Z', completedAt: null },
    ],
    webhookEvents: [{ id: 'w1', eventId: 'e1', status: 'PAID', outcome: 'applied', receivedAt: '2026-09-25T10:01:59.000Z' }],
    providerLog: [],
  } as unknown as PaymentDetails;

  it('хронология по времени, текущий статус последним', () => {
    const kinds = buildPaymentTimeline(details).map((e) => e.kind);
    expect(kinds).toEqual(['created', 'webhook', 'paid', 'refund_requested', 'refund_completed', 'refund_requested', 'current']);
    const last = buildPaymentTimeline(details).at(-1);
    expect(last).toEqual({ kind: 'current', at: null, status: 'partially_refunded' });
  });
});
