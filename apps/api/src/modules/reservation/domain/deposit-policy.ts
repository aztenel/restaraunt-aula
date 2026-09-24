import { addHours, addMinutes, DEFAULT_TIMEZONE, toLocalDate, toLocalTime } from '../../../shared/kernel/time';
import { ReservationStatus } from '../public';

/**
 * Депозит брони (VIP-залы, юрты): предоплата онлайн, засчитывается в счёт.
 * Отмена до дедлайна (cancellationDeadlineHours до начала) — депозит возвращается;
 * поздняя отмена и неявка — депозит удерживается. Решение сотрудника при отмене имеет приоритет
 * над правилом (фиксируется в журнале действий).
 */
export const DEPOSIT_STATES = [
  /** Депозит не требуется. */
  'none',
  /** Требовался, но сотрудник отказался от него (с причиной). */
  'waived',
  /** Ждём онлайн-оплату. */
  'pending',
  /** Бронь снята/отменена до оплаты. */
  'unpaid',
  'paid',
  /** Запрошен возврат (уходит провайдеру через очередь). */
  'refund_pending',
  'refunded',
  'refund_failed',
  /** Удержан (поздняя отмена, неявка, решение сотрудника). */
  'retained',
  /** Гости пришли — депозит засчитан в счёт. */
  'applied',
] as const;
export type DepositState = (typeof DEPOSIT_STATES)[number];

/** Исход для события ReservationStatusChanged. */
export type DepositOutcome = 'none' | 'refunded' | 'retained';
export type DepositDecision = 'refund' | 'retain';

/** Что сделать с платежом в результате решения. */
export type DepositAction = 'refund' | 'cancel_payment' | 'none';

export interface DepositResolution {
  outcome: DepositOutcome;
  nextState: DepositState;
  action: DepositAction;
}

export interface CancelDepositResolution extends DepositResolution {
  /** Что предписывает правило отмены (без учёта решения сотрудника). */
  policyOutcome: DepositOutcome;
  /** Сотрудник принял решение, отличное от правила. */
  overridden: boolean;
}

/** Дедлайн бесплатной отмены: начало брони минус N часов. */
export function cancellationDeadline(start: Date, cancellationDeadlineHours: number): Date {
  return addHours(start, -cancellationDeadlineHours);
}

/** Дедлайн в локальном времени филиала (для текста правил и уведомлений). */
export function cancellationDeadlineLocal(
  start: Date,
  cancellationDeadlineHours: number,
  timeZone: string = DEFAULT_TIMEZONE,
): { at: Date; date: string; time: string } {
  const at = cancellationDeadline(start, cancellationDeadlineHours);
  return { at, date: toLocalDate(at, timeZone), time: toLocalTime(at, timeZone) };
}

/** Отмена сейчас вернёт депозит по правилу места. */
export function isRefundableCancellation(now: Date, start: Date, cancellationDeadlineHours: number): boolean {
  return now.getTime() < cancellationDeadline(start, cancellationDeadlineHours).getTime();
}

export function decideDepositOnCancel(input: {
  depositState: DepositState;
  now: Date;
  start: Date;
  cancellationDeadlineHours: number;
  staffDecision?: DepositDecision | null;
}): CancelDepositResolution {
  if (input.depositState === 'pending') {
    return { outcome: 'none', policyOutcome: 'none', overridden: false, nextState: 'unpaid', action: 'cancel_payment' };
  }
  if (input.depositState !== 'paid') {
    return { outcome: 'none', policyOutcome: 'none', overridden: false, nextState: input.depositState, action: 'none' };
  }
  const policyOutcome: DepositOutcome = isRefundableCancellation(input.now, input.start, input.cancellationDeadlineHours)
    ? 'refunded'
    : 'retained';
  const outcome: DepositOutcome = input.staffDecision ? (input.staffDecision === 'refund' ? 'refunded' : 'retained') : policyOutcome;
  return {
    outcome,
    policyOutcome,
    overridden: outcome !== policyOutcome,
    nextState: outcome === 'refunded' ? 'refund_pending' : 'retained',
    action: outcome === 'refunded' ? 'refund' : 'none',
  };
}

/**
 * Бронь снята по истечении удержания: неоплаченный платёж отменяется; если депозит оплачен,
 * а персонал не успел подтвердить бронь — депозит возвращается (гость не виноват).
 */
export function decideDepositOnExpire(depositState: DepositState): DepositResolution {
  if (depositState === 'pending') return { outcome: 'none', nextState: 'unpaid', action: 'cancel_payment' };
  if (depositState === 'paid') return { outcome: 'refunded', nextState: 'refund_pending', action: 'refund' };
  return { outcome: 'none', nextState: depositState, action: 'none' };
}

/** Неявка — депозит удерживается. */
export function decideDepositOnNoShow(depositState: DepositState): DepositResolution {
  if (depositState === 'paid') return { outcome: 'retained', nextState: 'retained', action: 'none' };
  return { outcome: 'none', nextState: depositState, action: 'none' };
}

/** Гости пришли — депозит засчитывается в счёт. */
export function decideDepositOnArrival(depositState: DepositState): DepositResolution {
  if (depositState === 'paid') return { outcome: 'none', nextState: 'applied', action: 'none' };
  return { outcome: 'none', nextState: depositState, action: 'none' };
}

export type DepositPaymentDecision =
  /** Оплата депозита по ожидающей брони — применить. */
  | 'apply'
  /** Этот платёж уже учтён (повторная доставка события). */
  | 'already_applied'
  /** Депозит уже оплачен другим платежом или от него отказались — вернуть дубликат. */
  | 'refund_duplicate'
  /** Бронь уже снята / отменена / не ждёт оплаты — вернуть позднюю оплату. */
  | 'refund_late';

export function decideOnDepositPayment(input: {
  status: ReservationStatus;
  depositState: DepositState;
  depositPaidPaymentId: string | null;
  paymentId: string;
}): DepositPaymentDecision {
  if (input.depositPaidPaymentId === input.paymentId) return 'already_applied';
  if (input.status === 'awaiting_deposit' && input.depositState === 'pending') return 'apply';
  if (input.depositPaidPaymentId !== null || input.depositState === 'waived') return 'refund_duplicate';
  return 'refund_late';
}

/** Начальный статус брони. */
export function initialStatus(input: { depositRequired: boolean; requiresConfirmation: boolean }): ReservationStatus {
  if (input.depositRequired) return 'awaiting_deposit';
  if (input.requiresConfirmation) return 'pending';
  return 'confirmed';
}

/** Статус после оплаты депозита. */
export function statusAfterDepositPaid(requiresConfirmation: boolean): ReservationStatus {
  return requiresConfirmation ? 'pending' : 'confirmed';
}

/** Удержание брони: holdMinutes от текущего момента, но не дольше начала брони. */
export function holdExpiry(now: Date, holdMinutes: number, start: Date): Date {
  const hold = addMinutes(now, holdMinutes);
  return hold.getTime() < start.getTime() ? hold : new Date(Math.max(start.getTime(), now.getTime()));
}
