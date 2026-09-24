import { describe, expect, it } from 'vitest';
import { zonedTimeToUtc } from '../../../shared/kernel/time';
import {
  cancellationDeadline,
  cancellationDeadlineLocal,
  decideDepositOnArrival,
  decideDepositOnCancel,
  decideDepositOnExpire,
  decideDepositOnNoShow,
  decideOnDepositPayment,
  holdExpiry,
  initialStatus,
  isRefundableCancellation,
  statusAfterDepositPaid,
} from './deposit-policy';

const TZ = 'Asia/Almaty';
// 25.10.2026 19:00 по Астане (UTC+5) = 14:00 UTC.
const start = zonedTimeToUtc('2026-10-25', '19:00', TZ);

describe('cancellation deadline (branch timezone)', () => {
  it('is N hours before the start, rendered in the branch timezone', () => {
    expect(start.toISOString()).toBe('2026-10-25T14:00:00.000Z');
    expect(cancellationDeadline(start, 24).toISOString()).toBe('2026-10-24T14:00:00.000Z');
    expect(cancellationDeadlineLocal(start, 24, TZ)).toMatchObject({ date: '2026-10-24', time: '19:00' });
  });

  it('crosses local midnight correctly', () => {
    const early = zonedTimeToUtc('2026-10-25', '01:30', TZ);
    expect(cancellationDeadlineLocal(early, 3, TZ)).toMatchObject({ date: '2026-10-24', time: '22:30' });
    // 01:30 по Астане = 20:30 UTC предыдущего дня: локальная дата отличается от даты UTC.
    expect(early.toISOString()).toBe('2026-10-24T20:30:00.000Z');
  });

  it('zero hours means free cancellation until the start', () => {
    expect(cancellationDeadline(start, 0).getTime()).toBe(start.getTime());
    expect(isRefundableCancellation(new Date(start.getTime() - 1), start, 0)).toBe(true);
    expect(isRefundableCancellation(start, start, 0)).toBe(false);
  });

  it('boundary: exactly at the deadline is already late', () => {
    const deadline = cancellationDeadline(start, 24);
    expect(isRefundableCancellation(new Date(deadline.getTime() - 1), start, 24)).toBe(true);
    expect(isRefundableCancellation(deadline, start, 24)).toBe(false);
  });
});

describe('deposit on cancel', () => {
  const before = zonedTimeToUtc('2026-10-24', '18:59', TZ);
  const after = zonedTimeToUtc('2026-10-24', '19:00', TZ);

  it('paid deposit is refunded before the deadline', () => {
    expect(decideDepositOnCancel({ depositState: 'paid', now: before, start, cancellationDeadlineHours: 24 })).toEqual({
      outcome: 'refunded',
      policyOutcome: 'refunded',
      overridden: false,
      nextState: 'refund_pending',
      action: 'refund',
    });
  });

  it('paid deposit is retained after the deadline', () => {
    expect(decideDepositOnCancel({ depositState: 'paid', now: after, start, cancellationDeadlineHours: 24 })).toEqual({
      outcome: 'retained',
      policyOutcome: 'retained',
      overridden: false,
      nextState: 'retained',
      action: 'none',
    });
  });

  it('staff decision overrides the policy (both ways) and is marked as override', () => {
    const refundLate = decideDepositOnCancel({ depositState: 'paid', now: after, start, cancellationDeadlineHours: 24, staffDecision: 'refund' });
    expect(refundLate).toMatchObject({ outcome: 'refunded', policyOutcome: 'retained', overridden: true, action: 'refund' });
    const retainEarly = decideDepositOnCancel({ depositState: 'paid', now: before, start, cancellationDeadlineHours: 24, staffDecision: 'retain' });
    expect(retainEarly).toMatchObject({ outcome: 'retained', policyOutcome: 'refunded', overridden: true, action: 'none' });
    const same = decideDepositOnCancel({ depositState: 'paid', now: before, start, cancellationDeadlineHours: 24, staffDecision: 'refund' });
    expect(same.overridden).toBe(false);
  });

  it('unpaid deposit: the pending payment is cancelled, nothing to refund', () => {
    expect(decideDepositOnCancel({ depositState: 'pending', now: after, start, cancellationDeadlineHours: 24 })).toMatchObject({
      outcome: 'none',
      nextState: 'unpaid',
      action: 'cancel_payment',
    });
  });

  it('no deposit / waived: nothing happens', () => {
    for (const state of ['none', 'waived'] as const) {
      expect(decideDepositOnCancel({ depositState: state, now: after, start, cancellationDeadlineHours: 24, staffDecision: 'refund' })).toMatchObject({
        outcome: 'none',
        nextState: state,
        action: 'none',
      });
    }
  });
});

describe('deposit on expire / no-show / arrival', () => {
  it('expire: unpaid payment cancelled; paid (not confirmed in time) refunded', () => {
    expect(decideDepositOnExpire('pending')).toEqual({ outcome: 'none', nextState: 'unpaid', action: 'cancel_payment' });
    expect(decideDepositOnExpire('paid')).toEqual({ outcome: 'refunded', nextState: 'refund_pending', action: 'refund' });
    expect(decideDepositOnExpire('none')).toEqual({ outcome: 'none', nextState: 'none', action: 'none' });
  });

  it('no-show retains the deposit', () => {
    expect(decideDepositOnNoShow('paid')).toEqual({ outcome: 'retained', nextState: 'retained', action: 'none' });
    expect(decideDepositOnNoShow('waived')).toEqual({ outcome: 'none', nextState: 'waived', action: 'none' });
  });

  it('arrival applies the deposit to the bill', () => {
    expect(decideDepositOnArrival('paid')).toEqual({ outcome: 'none', nextState: 'applied', action: 'none' });
    expect(decideDepositOnArrival('none')).toEqual({ outcome: 'none', nextState: 'none', action: 'none' });
  });
});

describe('deposit payment arrival', () => {
  it('applies to a reservation awaiting its deposit', () => {
    expect(decideOnDepositPayment({ status: 'awaiting_deposit', depositState: 'pending', depositPaidPaymentId: null, paymentId: 'p1' })).toBe('apply');
  });

  it('is idempotent for the same payment', () => {
    expect(decideOnDepositPayment({ status: 'confirmed', depositState: 'paid', depositPaidPaymentId: 'p1', paymentId: 'p1' })).toBe(
      'already_applied',
    );
  });

  it('refunds a second payment or a payment after the deposit was waived', () => {
    expect(decideOnDepositPayment({ status: 'confirmed', depositState: 'paid', depositPaidPaymentId: 'p1', paymentId: 'p2' })).toBe(
      'refund_duplicate',
    );
    expect(decideOnDepositPayment({ status: 'confirmed', depositState: 'waived', depositPaidPaymentId: null, paymentId: 'p2' })).toBe(
      'refund_duplicate',
    );
  });

  it('refunds a late payment for an expired or cancelled reservation', () => {
    expect(decideOnDepositPayment({ status: 'expired', depositState: 'unpaid', depositPaidPaymentId: null, paymentId: 'p1' })).toBe('refund_late');
    expect(decideOnDepositPayment({ status: 'cancelled', depositState: 'unpaid', depositPaidPaymentId: null, paymentId: 'p1' })).toBe('refund_late');
  });
});

describe('initial status and hold', () => {
  it('deposit -> awaiting_deposit; manual confirmation -> pending; otherwise confirmed', () => {
    expect(initialStatus({ depositRequired: true, requiresConfirmation: true })).toBe('awaiting_deposit');
    expect(initialStatus({ depositRequired: true, requiresConfirmation: false })).toBe('awaiting_deposit');
    expect(initialStatus({ depositRequired: false, requiresConfirmation: true })).toBe('pending');
    expect(initialStatus({ depositRequired: false, requiresConfirmation: false })).toBe('confirmed');
  });

  it('after the deposit is paid: pending if manual confirmation is required', () => {
    expect(statusAfterDepositPaid(true)).toBe('pending');
    expect(statusAfterDepositPaid(false)).toBe('confirmed');
  });

  it('hold lasts holdMinutes but never beyond the start', () => {
    const now = new Date('2026-10-25T10:00:00Z');
    expect(holdExpiry(now, 30, new Date('2026-10-25T14:00:00Z')).toISOString()).toBe('2026-10-25T10:30:00.000Z');
    expect(holdExpiry(now, 600, new Date('2026-10-25T14:00:00Z')).toISOString()).toBe('2026-10-25T14:00:00.000Z');
  });
});
