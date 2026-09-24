import { ConflictError, ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { addMinutes, TimeRange } from '../../../shared/kernel/time';
import { Locale } from '../../../shared/kernel/translatable';
import { ReservationKind, ReservationSource, ReservationStatus } from '../public';
import {
  CancelDepositResolution,
  decideDepositOnArrival,
  decideDepositOnCancel,
  decideDepositOnExpire,
  decideDepositOnNoShow,
  DepositDecision,
  DepositOutcome,
  DepositResolution,
  DepositState,
  holdExpiry,
  initialStatus,
  statusAfterDepositPaid,
} from './deposit-policy';
import { HOLD_STATUSES, RESERVATION_FSM, UPCOMING_STATUSES } from './reservation-status';

/** Отметку «пришли» можно ставить не раньше чем за 3 часа до начала (защита от ошибочной отметки). */
export const ARRIVAL_WINDOW_MINUTES = 180;

export type CancelledBy = 'guest' | 'staff' | 'system' | 'banquet';

export interface ReservationCustomer {
  id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
}

export interface ReservationProps {
  id: string;
  number: string;
  branchId: string;
  venueId: string;
  kind: ReservationKind;
  status: ReservationStatus;
  source: ReservationSource;
  start: Date;
  end: Date;
  /** Конец занятости места: end + буфер уборки. */
  blockedUntil: Date;
  guests: number;
  customer: ReservationCustomer;
  comment: string | null;
  occasion: string | null;
  locale: Locale;
  publicToken: string | null;
  idempotencyKey: string | null;
  banquetRequestId: string | null;
  note: string | null;
  /** После оплаты депозита бронь ждёт подтверждения персоналом. */
  requiresConfirmation: boolean;
  holdExpiresAt: Date | null;
  /** Требуемый депозит (снимок на момент брони). */
  deposit: Money | null;
  depositState: DepositState;
  /** Текущий платёж депозита (последняя попытка оплаты). */
  depositPaymentId: string | null;
  /** Платёж, которым депозит оплачен. */
  depositPaidPaymentId: string | null;
  depositPaidAt: Date | null;
  depositWaiveReason: string | null;
  depositAttempts: number;
  depositOutcome: DepositOutcome;
  cancelReason: string | null;
  cancelledBy: CancelledBy | null;
  confirmedAt: Date | null;
  arrivedAt: Date | null;
  noShowAt: Date | null;
  cancelledAt: Date | null;
  expiredAt: Date | null;
  reminderSentAt: Date | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StatusChange {
  from: ReservationStatus;
  to: ReservationStatus;
  reason: string | null;
  depositOutcome: DepositOutcome;
  at: Date;
}

export interface SlotChange {
  before: { venueId: string; start: Date; end: Date; guests: number };
  after: { venueId: string; start: Date; end: Date; guests: number };
}

export interface NewReservationInput {
  id: string;
  number: string;
  branchId: string;
  venueId: string;
  kind: ReservationKind;
  source: ReservationSource;
  start: Date;
  end: Date;
  cleanupMinutes: number;
  guests: number;
  customer: ReservationCustomer;
  comment?: string | null;
  occasion?: string | null;
  locale: Locale;
  publicToken: string | null;
  idempotencyKey: string | null;
  banquetRequestId?: string | null;
  note?: string | null;
  requiresConfirmation: boolean;
  holdMinutes: number;
  /** Депозит места; null — депозит не требуется. */
  deposit: Money | null;
  /** Сотрудник отказался от депозита (причина обязательна). */
  depositWaiveReason?: string | null;
  createdByUserId: string | null;
}

function blockedUntilOf(end: Date, cleanupMinutes: number): Date {
  if (!Number.isInteger(cleanupMinutes) || cleanupMinutes < 0) {
    throw new ValidationError('reservation.invalid_cleanup', 'Cleanup minutes must be a non-negative integer');
  }
  return addMinutes(end, cleanupMinutes);
}

/**
 * Бронь места (обычная или занятость под банкет). Статус меняется только методами сущности,
 * через конечный автомат RESERVATION_FSM; недопустимый переход — InvalidStateTransitionError.
 */
export class Reservation {
  private constructor(private props: ReservationProps) {}

  static restore(props: ReservationProps): Reservation {
    return new Reservation({ ...props, customer: { ...props.customer } });
  }

  static create(input: NewReservationInput, now: Date): Reservation {
    const range = new TimeRange(input.start, input.end);
    if (!Number.isInteger(input.guests) || input.guests < 1) {
      throw new ValidationError('reservation.invalid_guests', 'Guests must be a positive integer', { guests: input.guests });
    }
    const isBanquet = input.kind === 'banquet';
    if (isBanquet && !input.banquetRequestId) {
      throw new ValidationError('reservation.banquet_request_required', 'Banquet hold requires banquetRequestId');
    }
    const waived = !isBanquet && input.deposit !== null && !!input.depositWaiveReason?.trim();
    const depositRequired = !isBanquet && input.deposit !== null && !waived;
    const status: ReservationStatus = isBanquet
      ? 'confirmed'
      : initialStatus({ depositRequired, requiresConfirmation: input.requiresConfirmation });
    return new Reservation({
      id: input.id,
      number: input.number,
      branchId: input.branchId,
      venueId: input.venueId,
      kind: input.kind,
      status,
      source: input.source,
      start: range.start,
      end: range.end,
      blockedUntil: blockedUntilOf(range.end, input.cleanupMinutes),
      guests: input.guests,
      customer: { ...input.customer },
      comment: input.comment?.trim() || null,
      occasion: input.occasion?.trim() || null,
      locale: input.locale,
      publicToken: input.publicToken,
      idempotencyKey: input.idempotencyKey,
      banquetRequestId: isBanquet ? input.banquetRequestId! : null,
      note: input.note?.trim() || null,
      requiresConfirmation: input.requiresConfirmation,
      holdExpiresAt: HOLD_STATUSES.includes(status) ? holdExpiry(now, input.holdMinutes, range.start) : null,
      deposit: isBanquet ? null : input.deposit,
      depositState: isBanquet || input.deposit === null ? 'none' : waived ? 'waived' : 'pending',
      depositPaymentId: null,
      depositPaidPaymentId: null,
      depositPaidAt: null,
      depositWaiveReason: waived ? input.depositWaiveReason!.trim() : null,
      depositAttempts: 0,
      depositOutcome: 'none',
      cancelReason: null,
      cancelledBy: null,
      confirmedAt: status === 'confirmed' ? now : null,
      arrivedAt: null,
      noShowAt: null,
      cancelledAt: null,
      expiredAt: null,
      reminderSentAt: null,
      createdByUserId: input.createdByUserId,
      createdAt: now,
      updatedAt: now,
    });
  }

  // ------------------------------------------------------------------ чтение

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get branchId(): string {
    return this.props.branchId;
  }
  get venueId(): string {
    return this.props.venueId;
  }
  get kind(): ReservationKind {
    return this.props.kind;
  }
  get status(): ReservationStatus {
    return this.props.status;
  }
  get start(): Date {
    return this.props.start;
  }
  get end(): Date {
    return this.props.end;
  }
  get blockedUntil(): Date {
    return this.props.blockedUntil;
  }
  get guests(): number {
    return this.props.guests;
  }
  get customer(): ReservationCustomer {
    return this.props.customer;
  }
  get deposit(): Money | null {
    return this.props.deposit;
  }
  get depositState(): DepositState {
    return this.props.depositState;
  }
  get depositPaymentId(): string | null {
    return this.props.depositPaymentId;
  }
  get depositPaidPaymentId(): string | null {
    return this.props.depositPaidPaymentId;
  }
  get holdExpiresAt(): Date | null {
    return this.props.holdExpiresAt;
  }
  get publicToken(): string | null {
    return this.props.publicToken;
  }

  snapshot(): ReservationProps {
    return { ...this.props, customer: { ...this.props.customer } };
  }

  blockedRange(): TimeRange {
    return new TimeRange(this.props.start, this.props.blockedUntil);
  }

  /** Депозит, фактически взимаемый с гостя (для событий и отчётов): null — не требуется или отменён сотрудником. */
  chargedDeposit(): Money | null {
    return this.props.depositState === 'none' || this.props.depositState === 'waived' ? null : this.props.deposit;
  }

  isUpcoming(): boolean {
    return UPCOMING_STATUSES.includes(this.props.status);
  }

  /** Состояние для журнала действий (было / стало). */
  auditState(): Record<string, unknown> {
    const p = this.props;
    return {
      status: p.status,
      venueId: p.venueId,
      start: p.start.toISOString(),
      end: p.end.toISOString(),
      guests: p.guests,
      holdExpiresAt: p.holdExpiresAt?.toISOString() ?? null,
      deposit: p.deposit?.toJSON() ?? null,
      depositState: p.depositState,
      depositOutcome: p.depositOutcome,
      depositPaidPaymentId: p.depositPaidPaymentId,
    };
  }

  // ------------------------------------------------------------------ правила для гостя и админки

  /** Гость может отменить бронь сам: она ещё не состоялась и не началась. */
  guestCanCancel(now: Date): boolean {
    return this.props.kind === 'regular' && this.isUpcoming() && now.getTime() < this.props.start.getTime();
  }

  /** Гость может (повторно) оплатить депозит: бронь ждёт оплату и удержание не истекло. */
  guestCanPay(now: Date): boolean {
    return (
      this.props.status === 'awaiting_deposit' &&
      this.props.depositState === 'pending' &&
      (this.props.holdExpiresAt === null || now.getTime() < this.props.holdExpiresAt.getTime())
    );
  }

  /**
   * Переходы, доступные сотруднику сейчас (для кнопок админки). Снятие по таймауту и перевод
   * в pending после оплаты делает система. Банкетной занятостью управляет модуль банкетов.
   */
  allowedTransitions(now: Date): ReservationStatus[] {
    if (this.props.kind === 'banquet') return [];
    return RESERVATION_FSM.allowedFrom(this.props.status).filter((to) => {
      if (to === 'expired' || to === 'pending') return false;
      if (to === 'no_show') return now.getTime() >= this.props.start.getTime();
      if (to === 'arrived') return now.getTime() >= addMinutes(this.props.start, -ARRIVAL_WINDOW_MINUTES).getTime();
      return true;
    });
  }

  canReschedule(): boolean {
    return this.props.kind === 'regular' && this.isUpcoming();
  }

  needsMark(now: Date): boolean {
    return this.props.kind === 'regular' && this.props.status === 'confirmed' && now.getTime() >= this.props.start.getTime();
  }

  // ------------------------------------------------------------------ переходы

  private move(to: ReservationStatus, now: Date, reason: string | null, depositOutcome: DepositOutcome): StatusChange {
    const from = this.props.status;
    RESERVATION_FSM.assertTransition(from, to);
    this.props.status = to;
    this.props.updatedAt = now;
    if (depositOutcome !== 'none') this.props.depositOutcome = depositOutcome;
    return { from, to, reason, depositOutcome, at: now };
  }

  private applyDeposit(resolution: DepositResolution): void {
    this.props.depositState = resolution.nextState;
  }

  /** Создан платёж депозита (первая или повторная попытка оплаты). */
  attachDepositPayment(paymentId: string): void {
    if (this.props.status !== 'awaiting_deposit' || this.props.depositState !== 'pending') {
      throw new ConflictError('reservation.deposit_not_expected', 'Reservation is not awaiting a deposit payment');
    }
    this.props.depositPaymentId = paymentId;
    this.props.depositAttempts += 1;
  }

  /** Депозит оплачен: confirmed, либо pending (ждёт подтверждения персоналом, новое удержание). */
  applyDepositPayment(paymentId: string, now: Date, holdMinutes: number): StatusChange {
    if (this.props.status !== 'awaiting_deposit' || this.props.depositState !== 'pending') {
      throw new ConflictError('reservation.deposit_not_expected', 'Reservation is not awaiting a deposit payment');
    }
    const to = statusAfterDepositPaid(this.props.requiresConfirmation);
    const change = this.move(to, now, 'deposit_paid', 'none');
    this.props.depositState = 'paid';
    this.props.depositPaidPaymentId = paymentId;
    this.props.depositPaymentId = paymentId;
    this.props.depositPaidAt = now;
    if (to === 'pending') {
      this.props.holdExpiresAt = holdExpiry(now, holdMinutes, this.props.start);
    } else {
      this.props.holdExpiresAt = null;
      this.props.confirmedAt = now;
    }
    return change;
  }

  /**
   * Подтверждение персоналом: pending -> confirmed. Из awaiting_deposit — только с отказом
   * от депозита (причина обязательна), неоплаченный платёж отменяется.
   */
  confirm(now: Date, options: { waiveDepositReason?: string | null } = {}): { change: StatusChange; resolution: DepositResolution } {
    let resolution: DepositResolution = { outcome: 'none', nextState: this.props.depositState, action: 'none' };
    if (this.props.status === 'awaiting_deposit') {
      const reason = options.waiveDepositReason?.trim();
      if (!reason) {
        throw new ValidationError(
          'reservation.deposit_waive_reason_required',
          'Confirming without a paid deposit requires a reason for waiving the deposit',
        );
      }
      resolution = { outcome: 'none', nextState: 'waived', action: 'cancel_payment' };
      this.props.depositWaiveReason = reason;
    }
    const change = this.move('confirmed', now, options.waiveDepositReason?.trim() || null, 'none');
    this.applyDeposit(resolution);
    this.props.holdExpiresAt = null;
    this.props.confirmedAt = now;
    return { change, resolution };
  }

  /** Отмена гостем, сотрудником, системой или банкетным модулем. Депозит — по правилу или решению сотрудника. */
  cancel(input: {
    now: Date;
    by: CancelledBy;
    reason: string | null;
    cancellationDeadlineHours: number;
    staffDecision?: DepositDecision | null;
  }): { change: StatusChange; resolution: CancelDepositResolution } {
    if (input.by === 'guest' && !this.guestCanCancel(input.now)) {
      if (this.isUpcoming()) {
        throw new ConflictError('reservation.cancel_after_start', 'Reservation has already started and cannot be cancelled online');
      }
      RESERVATION_FSM.assertTransition(this.props.status, 'cancelled');
    }
    const resolution = decideDepositOnCancel({
      depositState: this.props.depositState,
      now: input.now,
      start: this.props.start,
      cancellationDeadlineHours: input.cancellationDeadlineHours,
      staffDecision: input.by === 'staff' ? (input.staffDecision ?? null) : null,
    });
    const change = this.move('cancelled', input.now, input.reason, resolution.outcome);
    this.applyDeposit(resolution);
    this.props.holdExpiresAt = null;
    this.props.cancelReason = input.reason;
    this.props.cancelledBy = input.by;
    this.props.cancelledAt = input.now;
    return { change, resolution };
  }

  /** Снятие неподтверждённой / неоплаченной брони по истечении удержания. */
  expire(now: Date): { change: StatusChange; resolution: DepositResolution } {
    if (!HOLD_STATUSES.includes(this.props.status) || !this.props.holdExpiresAt || this.props.holdExpiresAt.getTime() > now.getTime()) {
      throw new ConflictError('reservation.hold_not_expired', 'Reservation hold has not expired', {
        status: this.props.status,
        holdExpiresAt: this.props.holdExpiresAt?.toISOString() ?? null,
      });
    }
    const resolution = decideDepositOnExpire(this.props.depositState);
    const change = this.move('expired', now, 'hold_expired', resolution.outcome);
    this.applyDeposit(resolution);
    this.props.holdExpiresAt = null;
    this.props.expiredAt = now;
    return { change, resolution };
  }

  markArrived(now: Date): { change: StatusChange; resolution: DepositResolution } {
    if (now.getTime() < addMinutes(this.props.start, -ARRIVAL_WINDOW_MINUTES).getTime()) {
      throw new ConflictError('reservation.arrival_too_early', 'Arrival can be marked not earlier than 3 hours before the start', {
        start: this.props.start.toISOString(),
      });
    }
    const resolution = decideDepositOnArrival(this.props.depositState);
    const change = this.move('arrived', now, null, resolution.outcome);
    this.applyDeposit(resolution);
    this.props.arrivedAt = now;
    return { change, resolution };
  }

  /** «Не пришли» — только после начала брони; депозит удерживается. */
  markNoShow(now: Date): { change: StatusChange; resolution: DepositResolution } {
    if (now.getTime() < this.props.start.getTime()) {
      throw new ConflictError('reservation.no_show_before_start', 'No-show can be marked only after the reservation start', {
        start: this.props.start.toISOString(),
      });
    }
    const resolution = decideDepositOnNoShow(this.props.depositState);
    const change = this.move('no_show', now, null, resolution.outcome);
    this.applyDeposit(resolution);
    this.props.noShowAt = now;
    return { change, resolution };
  }

  /** Перенос: другое место, время, число гостей. Статус и депозит не меняются. */
  reschedule(input: { venueId: string; start: Date; end: Date; cleanupMinutes: number; guests: number }, now: Date): SlotChange {
    const allowed = this.props.kind === 'banquet' ? this.props.status === 'confirmed' : this.isUpcoming();
    if (!allowed) {
      throw new ConflictError('reservation.cannot_reschedule', `Reservation in status ${this.props.status} cannot be moved`, {
        status: this.props.status,
      });
    }
    const range = new TimeRange(input.start, input.end);
    if (!Number.isInteger(input.guests) || input.guests < 1) {
      throw new ValidationError('reservation.invalid_guests', 'Guests must be a positive integer', { guests: input.guests });
    }
    const before = { venueId: this.props.venueId, start: this.props.start, end: this.props.end, guests: this.props.guests };
    this.props.venueId = input.venueId;
    this.props.start = range.start;
    this.props.end = range.end;
    this.props.blockedUntil = blockedUntilOf(range.end, input.cleanupMinutes);
    this.props.guests = input.guests;
    if (this.props.holdExpiresAt && this.props.holdExpiresAt.getTime() > range.start.getTime()) {
      this.props.holdExpiresAt = new Date(Math.max(range.start.getTime(), now.getTime()));
    }
    this.props.reminderSentAt = null;
    this.props.updatedAt = now;
    return { before, after: { venueId: input.venueId, start: range.start, end: range.end, guests: input.guests } };
  }

  /** Результат возврата депозита (события Payments). */
  markDepositRefund(succeeded: boolean): boolean {
    if (this.props.depositState !== 'refund_pending' && this.props.depositState !== 'refund_failed') return false;
    this.props.depositState = succeeded ? 'refunded' : 'refund_failed';
    return true;
  }

  markReminderSent(now: Date): void {
    this.props.reminderSentAt = now;
  }
}
