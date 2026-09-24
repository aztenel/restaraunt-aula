import { StateMachine } from '../../../shared/kernel/state-machine';
import { BLOCKING_RESERVATION_STATUSES, ReservationStatus } from '../public';

/**
 * Жизненный цикл брони — конечный автомат. Переходы разрешены только по схеме:
 *
 *   pending          -> confirmed | cancelled | expired
 *   awaiting_deposit -> confirmed | pending | cancelled | expired
 *   confirmed        -> arrived | no_show | cancelled
 *   arrived, no_show, cancelled, expired — финальные.
 *
 * awaiting_deposit -> pending: депозит оплачен, но место требует ручного подтверждения персоналом.
 */
export const RESERVATION_FSM = new StateMachine<ReservationStatus>('reservation', {
  pending: ['confirmed', 'cancelled', 'expired'],
  awaiting_deposit: ['confirmed', 'pending', 'cancelled', 'expired'],
  confirmed: ['arrived', 'no_show', 'cancelled'],
  arrived: [],
  no_show: [],
  cancelled: [],
  expired: [],
});

/** Статусы, занимающие место (проверка пересечений + exclusion constraint в БД). */
export const BLOCKING_STATUSES = BLOCKING_RESERVATION_STATUSES;

/** Бронь «держится» ограниченное время (holdMinutes) и снимается автоматически. */
export const HOLD_STATUSES: readonly ReservationStatus[] = ['pending', 'awaiting_deposit'];

/** Бронь ещё не состоялась: её можно отменить или перенести. */
export const UPCOMING_STATUSES: readonly ReservationStatus[] = ['pending', 'awaiting_deposit', 'confirmed'];

export const ALL_RESERVATION_STATUSES = RESERVATION_FSM.states();

export function isBlockingStatus(status: ReservationStatus): boolean {
  return BLOCKING_STATUSES.includes(status);
}
