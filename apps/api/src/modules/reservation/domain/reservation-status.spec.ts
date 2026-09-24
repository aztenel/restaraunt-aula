import { describe, expect, it } from 'vitest';
import { InvalidStateTransitionError } from '../../../shared/kernel/errors';
import { ReservationStatus } from '../public';
import { BLOCKING_STATUSES, HOLD_STATUSES, isBlockingStatus, RESERVATION_FSM, UPCOMING_STATUSES } from './reservation-status';

const ALL: ReservationStatus[] = ['pending', 'awaiting_deposit', 'confirmed', 'arrived', 'no_show', 'cancelled', 'expired'];

const ALLOWED: Record<ReservationStatus, ReservationStatus[]> = {
  pending: ['confirmed', 'cancelled', 'expired'],
  awaiting_deposit: ['confirmed', 'pending', 'cancelled', 'expired'],
  confirmed: ['arrived', 'no_show', 'cancelled'],
  arrived: [],
  no_show: [],
  cancelled: [],
  expired: [],
};

describe('RESERVATION_FSM', () => {
  it('covers every status of the contract', () => {
    expect(RESERVATION_FSM.states().sort()).toEqual([...ALL].sort());
  });

  for (const from of ALL) {
    for (const to of ALL) {
      const allowed = ALLOWED[from].includes(to);
      it(`${from} -> ${to} is ${allowed ? 'allowed' : 'forbidden'}`, () => {
        expect(RESERVATION_FSM.canTransition(from, to)).toBe(allowed);
        if (allowed) {
          expect(() => RESERVATION_FSM.assertTransition(from, to)).not.toThrow();
        } else {
          expect(() => RESERVATION_FSM.assertTransition(from, to)).toThrow(InvalidStateTransitionError);
        }
      });
    }
  }

  it('final statuses have no transitions', () => {
    for (const s of ['arrived', 'no_show', 'cancelled', 'expired'] as const) expect(RESERVATION_FSM.isFinal(s)).toBe(true);
    for (const s of ['pending', 'awaiting_deposit', 'confirmed'] as const) expect(RESERVATION_FSM.isFinal(s)).toBe(false);
  });

  it('invalid transition error has a machine code', () => {
    try {
      RESERVATION_FSM.assertTransition('cancelled', 'confirmed');
    } catch (err) {
      expect((err as InvalidStateTransitionError).code).toBe('reservation.invalid_transition');
    }
  });

  it('blocking statuses occupy the venue; hold statuses expire; upcoming can be cancelled', () => {
    expect([...BLOCKING_STATUSES].sort()).toEqual(['arrived', 'awaiting_deposit', 'confirmed', 'pending']);
    expect(isBlockingStatus('cancelled')).toBe(false);
    expect(isBlockingStatus('expired')).toBe(false);
    expect(isBlockingStatus('no_show')).toBe(false);
    expect(HOLD_STATUSES).toEqual(['pending', 'awaiting_deposit']);
    expect(UPCOMING_STATUSES).toEqual(['pending', 'awaiting_deposit', 'confirmed']);
  });
});
