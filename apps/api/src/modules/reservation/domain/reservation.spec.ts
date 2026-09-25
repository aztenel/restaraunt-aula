import { describe, expect, it } from 'vitest';
import { ConflictError, InvalidStateTransitionError, ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { NewReservationInput, Reservation } from './reservation';
import { VenueRules } from './venue-rules';

const now = new Date('2026-10-25T08:00:00Z');
const start = new Date('2026-10-25T14:00:00Z');
const end = new Date('2026-10-25T16:00:00Z');
const minutes = (m: number) => m * 60_000;

const RULES: VenueRules = {
  durationMinutes: 120,
  holdMinutes: 30,
  cancellationDeadlineHours: 3,
  requiresManualConfirmation: false,
  cleanupMinutes: 15,
  slotStepMinutes: 30,
  bookableOnline: true,
};

function input(overrides: Partial<NewReservationInput> = {}): NewReservationInput {
  return {
    id: 'r1',
    number: 'GL-2026-000001',
    branchId: 'b1',
    venueId: 'v1',
    kind: 'regular',
    source: 'web',
    start,
    end,
    rules: RULES,
    guests: 4,
    customer: { id: 'c1', name: 'Айгерим', phone: '+77011234567', email: null },
    locale: 'ru',
    publicToken: 'tok',
    idempotencyKey: 'idem',
    requiresConfirmation: false,
    deposit: null,
    createdByUserId: null,
    ...overrides,
  };
}


describe('Reservation.create', () => {
  it('without deposit and manual confirmation is confirmed immediately', () => {
    const r = Reservation.create(input(), now);
    const s = r.snapshot();
    expect(s.status).toBe('confirmed');
    expect(s.holdExpiresAt).toBeNull();
    expect(s.confirmedAt).toEqual(now);
    expect(s.depositState).toBe('none');
    expect(s.blockedUntil.toISOString()).toBe('2026-10-25T16:15:00.000Z');
    expect(r.blockedRange().durationMinutes()).toBe(135);
  });

  it('manual confirmation -> pending with hold', () => {
    const r = Reservation.create(input({ requiresConfirmation: true }), now);
    expect(r.status).toBe('pending');
    expect(r.holdExpiresAt?.toISOString()).toBe('2026-10-25T08:30:00.000Z');
  });

  it('deposit -> awaiting_deposit with hold; waived deposit -> confirmed', () => {
    const deposit = Money.tenge(50_000);
    const r = Reservation.create(input({ deposit }), now);
    expect(r.status).toBe('awaiting_deposit');
    expect(r.depositState).toBe('pending');
    expect(r.chargedDeposit()?.amount).toBe(5_000_000);
    const w = Reservation.create(input({ deposit, depositWaiveReason: 'Постоянный гость' }), now);
    expect(w.status).toBe('confirmed');
    expect(w.depositState).toBe('waived');
    expect(w.chargedDeposit()).toBeNull();
    expect(w.snapshot().depositWaiveReason).toBe('Постоянный гость');
  });

  it('banquet hold is confirmed, without deposit and requires a banquet request', () => {
    const r = Reservation.create(input({ kind: 'banquet', source: 'banquet', banquetRequestId: 'q1', deposit: Money.tenge(1), publicToken: null }), now);
    expect(r.status).toBe('confirmed');
    expect(r.depositState).toBe('none');
    expect(r.snapshot().banquetRequestId).toBe('q1');
    expect(() => Reservation.create(input({ kind: 'banquet', source: 'banquet' }), now)).toThrow(ValidationError);
  });

  it('rejects an empty interval and non-positive guests', () => {
    expect(() => Reservation.create(input({ end: start }), now)).toThrow(ValidationError);
    expect(() => Reservation.create(input({ guests: 0 }), now)).toThrow(ValidationError);
  });
});

describe('Reservation deposit flow', () => {
  it('paid deposit confirms the reservation (or makes it pending with a new hold)', () => {
    const r = Reservation.create(input({ deposit: Money.tenge(50_000) }), now);
    r.attachDepositPayment('p1');
    const change = r.applyDepositPayment('p1', new Date(now.getTime() + minutes(5)));
    expect(change).toMatchObject({ from: 'awaiting_deposit', to: 'confirmed' });
    expect(r.depositState).toBe('paid');
    expect(r.holdExpiresAt).toBeNull();

    const m = Reservation.create(input({ deposit: Money.tenge(50_000), requiresConfirmation: true, rules: { ...RULES, holdMinutes: 60 } }), now);
    m.attachDepositPayment('p2');
    const paidAt = new Date(now.getTime() + minutes(10));
    expect(m.applyDepositPayment('p2', paidAt).to).toBe('pending');
    expect(m.holdExpiresAt?.toISOString()).toBe(new Date(paidAt.getTime() + minutes(60)).toISOString());
    expect(() => m.applyDepositPayment('p3', paidAt)).toThrow(ConflictError);
  });

  it('counts payment attempts', () => {
    const r = Reservation.create(input({ deposit: Money.tenge(50_000) }), now);
    r.attachDepositPayment('p1');
    r.attachDepositPayment('p2');
    expect(r.snapshot().depositAttempts).toBe(2);
    expect(r.depositPaymentId).toBe('p2');
  });

  it('staff confirm of an unpaid deposit requires a waiver reason and cancels the payment', () => {
    const r = Reservation.create(input({ deposit: Money.tenge(50_000) }), now);
    expect(() => r.confirm(now)).toThrow(ValidationError);
    const { change, resolution } = r.confirm(now, { waiveDepositReason: 'Оплатит на месте' });
    expect(change).toMatchObject({ from: 'awaiting_deposit', to: 'confirmed' });
    expect(resolution.action).toBe('cancel_payment');
    expect(r.depositState).toBe('waived');
  });
});

describe('Reservation cancel', () => {
  function paid(): Reservation {
    const r = Reservation.create(input({ deposit: Money.tenge(50_000) }), now);
    r.attachDepositPayment('p1');
    r.applyDepositPayment('p1', now);
    return r;
  }

  it('guest cancel before the deadline refunds the paid deposit', () => {
    const r = paid();
    const { change, resolution } = r.cancel({ now, by: 'guest', reason: 'Планы изменились' });
    expect(change).toMatchObject({ from: 'confirmed', to: 'cancelled', depositOutcome: 'refunded' });
    expect(resolution.action).toBe('refund');
    expect(r.depositState).toBe('refund_pending');
    expect(r.snapshot().cancelledBy).toBe('guest');
  });

  it('guest cancel after the deadline retains the deposit', () => {
    const r = paid();
    const late = new Date(start.getTime() - minutes(60));
    const { change } = r.cancel({ now: late, by: 'guest', reason: null });
    expect(change.depositOutcome).toBe('retained');
    expect(r.depositState).toBe('retained');
    expect(r.snapshot().depositOutcome).toBe('retained');
  });

  it('guest cannot cancel after the start; staff can', () => {
    const r = paid();
    const afterStart = new Date(start.getTime() + minutes(1));
    expect(r.guestCanCancel(afterStart)).toBe(false);
    expect(() => r.cancel({ now: afterStart, by: 'guest', reason: null })).toThrow(ConflictError);
    const { change } = r.cancel({ now: afterStart, by: 'staff', reason: 'Закрыты', staffDecision: 'refund' });
    expect(change.depositOutcome).toBe('refunded');
  });

  it('cancelled is final', () => {
    const r = paid();
    r.cancel({ now, by: 'staff', reason: 'x' });
    expect(() => r.cancel({ now, by: 'staff', reason: 'x' })).toThrow(InvalidStateTransitionError);
    expect(() => r.markArrived(start)).toThrow(InvalidStateTransitionError);
    expect(r.allowedTransitions(start)).toEqual([]);
  });
});

describe('Reservation expire / arrival / no-show', () => {
  it('expires only after the hold', () => {
    const r = Reservation.create(input({ requiresConfirmation: true }), now);
    expect(() => r.expire(new Date(now.getTime() + minutes(29)))).toThrow(ConflictError);
    const { change } = r.expire(new Date(now.getTime() + minutes(30)));
    expect(change).toMatchObject({ from: 'pending', to: 'expired' });
    const c = Reservation.create(input(), now);
    expect(() => c.expire(new Date(now.getTime() + minutes(60)))).toThrow(ConflictError);
  });

  it('expired unpaid deposit cancels the payment', () => {
    const r = Reservation.create(input({ deposit: Money.tenge(50_000) }), now);
    const { resolution } = r.expire(new Date(now.getTime() + minutes(31)));
    expect(resolution.action).toBe('cancel_payment');
    expect(r.depositState).toBe('unpaid');
  });

  it('arrival not earlier than 3 hours before start; applies the deposit', () => {
    const r = Reservation.create(input({ deposit: Money.tenge(50_000) }), now);
    r.attachDepositPayment('p1');
    r.applyDepositPayment('p1', now);
    expect(() => r.markArrived(new Date(start.getTime() - minutes(181)))).toThrow(ConflictError);
    r.markArrived(new Date(start.getTime() - minutes(10)));
    expect(r.status).toBe('arrived');
    expect(r.depositState).toBe('applied');
  });

  it('no-show only after the start; retains the deposit', () => {
    const r = Reservation.create(input({ deposit: Money.tenge(50_000) }), now);
    r.attachDepositPayment('p1');
    r.applyDepositPayment('p1', now);
    expect(() => r.markNoShow(new Date(start.getTime() - 1))).toThrow(ConflictError);
    const { change } = r.markNoShow(start);
    expect(change.depositOutcome).toBe('retained');
    expect(r.depositState).toBe('retained');
  });

  it('pending cannot be marked arrived (must be confirmed first)', () => {
    const r = Reservation.create(input({ requiresConfirmation: true }), now);
    expect(() => r.markArrived(start)).toThrow(InvalidStateTransitionError);
  });
});

describe('Reservation.allowedTransitions', () => {
  it('depends on status and time; system-only transitions are hidden', () => {
    const pending = Reservation.create(input({ requiresConfirmation: true }), now);
    expect(pending.allowedTransitions(now)).toEqual(['confirmed', 'cancelled']);
    const awaiting = Reservation.create(input({ deposit: Money.tenge(1000) }), now);
    expect(awaiting.allowedTransitions(now)).toEqual(['confirmed', 'cancelled']);
    const confirmed = Reservation.create(input(), now);
    expect(confirmed.allowedTransitions(now)).toEqual(['cancelled']);
    expect(confirmed.allowedTransitions(new Date(start.getTime() - minutes(60)))).toEqual(['arrived', 'cancelled']);
    expect(confirmed.allowedTransitions(start)).toEqual(['arrived', 'no_show', 'cancelled']);
    expect(confirmed.needsMark(start)).toBe(true);
    expect(confirmed.needsMark(now)).toBe(false);
  });

  it('banquet holds are managed by the banquet module', () => {
    const b = Reservation.create(input({ kind: 'banquet', source: 'banquet', banquetRequestId: 'q1' }), now);
    expect(b.allowedTransitions(start)).toEqual([]);
    expect(b.canReschedule()).toBe(false);
    expect(b.needsMark(start)).toBe(false);
  });
});

describe('Reservation.reschedule', () => {
  it('moves the slot and recomputes the cleanup buffer, keeps status', () => {
    const r = Reservation.create(input(), now);
    const change = r.reschedule(
      { venueId: 'v2', start: new Date('2026-10-26T14:00:00Z'), end: new Date('2026-10-26T17:00:00Z'), rules: { ...RULES, cleanupMinutes: 30, cancellationDeadlineHours: 24 }, guests: 6 },
      now,
    );
    expect(change.before).toMatchObject({ venueId: 'v1', guests: 4 });
    expect(change.after).toMatchObject({ venueId: 'v2', guests: 6 });
    expect(r.status).toBe('confirmed');
    expect(r.blockedUntil.toISOString()).toBe('2026-10-26T17:30:00.000Z');
    expect(r.rules.cancellationDeadlineHours).toBe(24);
    expect(r.cancellationDeadline().toISOString()).toBe('2026-10-25T14:00:00.000Z');
  });

  it('final reservations cannot be moved', () => {
    const r = Reservation.create(input(), now);
    r.cancel({ now, by: 'staff', reason: 'x' });
    expect(() => r.reschedule({ venueId: 'v1', start, end, rules: RULES, guests: 2 }, now)).toThrow(ConflictError);
  });

  it('refund result updates the deposit state only while a refund is pending', () => {
    const r = Reservation.create(input({ deposit: Money.tenge(50_000) }), now);
    expect(r.markDepositRefund(true)).toBe(false);
    r.attachDepositPayment('p1');
    r.applyDepositPayment('p1', now);
    r.cancel({ now, by: 'guest', reason: null });
    expect(r.markDepositRefund(false)).toBe(true);
    expect(r.depositState).toBe('refund_failed');
    expect(r.markDepositRefund(true)).toBe(true);
    expect(r.depositState).toBe('refunded');
  });
});
