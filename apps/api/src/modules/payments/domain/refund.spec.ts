import { describe, expect, it } from 'vitest';
import { InvalidStateTransitionError, ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { Refund, refundModeFor, reservedRefundTotal } from './refund';

const now = new Date('2026-10-01T10:00:00Z');

function refund() {
  return Refund.request(
    { id: 'r1', paymentId: 'p1', amount: Money.tenge(100), mode: 'gateway', reason: 'Отмена заказа', idempotencyKey: 'k', requestedBy: null },
    now,
  );
}

describe('Refund', () => {
  it('chooses mode by payment method', () => {
    expect(refundModeFor('online')).toBe('gateway');
    expect(refundModeFor('gift_certificate')).toBe('certificate');
    expect(refundModeFor('on_receipt')).toBe('manual');
    expect(refundModeFor('bank_transfer')).toBe('manual');
  });

  it('validates request', () => {
    expect(() =>
      Refund.request({ id: 'r', paymentId: 'p', amount: Money.zero(), mode: 'gateway', reason: 'x', idempotencyKey: 'k', requestedBy: null }, now),
    ).toThrow(ValidationError);
    expect(() =>
      Refund.request({ id: 'r', paymentId: 'p', amount: Money.of(1), mode: 'gateway', reason: ' ', idempotencyKey: 'k', requestedBy: null }, now),
    ).toThrow(ValidationError);
  });

  it('pending -> succeeded | failed only once', () => {
    const r = refund();
    expect(r.isPending()).toBe(true);
    r.succeed({ now, externalRefundId: 'ext' });
    expect(r.status).toBe('succeeded');
    expect(() => r.fail({ now, reason: 'x' })).toThrow(InvalidStateTransitionError);
    const f = refund();
    f.fail({ now, reason: 'declined' });
    expect(f.status).toBe('failed');
    expect(() => f.succeed({ now })).toThrow(InvalidStateTransitionError);
  });

  it('reserves pending and succeeded refunds, not failed ones', () => {
    const total = reservedRefundTotal(
      [
        { status: 'pending', amount: Money.of(100) },
        { status: 'succeeded', amount: Money.of(50) },
        { status: 'failed', amount: Money.of(1000) },
      ],
      'KZT',
    );
    expect(total.amount).toBe(150);
  });
});
