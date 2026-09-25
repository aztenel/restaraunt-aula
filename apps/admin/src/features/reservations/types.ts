/**
 * Формы ответов броней в админке (apps/api/src/modules/reservation/http/dto/reservations.dto.ts),
 * уточнённые относительно docs/openapi.json (nullable-поля там без `type`). Даты — ISO-строки UTC,
 * локальные date/time — в часовом поясе филиала. Суммы и разрешённые переходы считает сервер.
 */
import type { Money, Translatable } from '@aula/api-client';
import type { VenuePosition, VenueRules } from '../venues/types';

export const RESERVATION_STATUSES = ['pending', 'awaiting_deposit', 'confirmed', 'arrived', 'no_show', 'cancelled', 'expired'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_KINDS = ['regular', 'banquet'] as const;
export type ReservationKind = (typeof RESERVATION_KINDS)[number];

export const RESERVATION_SOURCES = ['web', 'admin', 'banquet'] as const;
export type ReservationSource = (typeof RESERVATION_SOURCES)[number];

export const DEPOSIT_STATES = [
  'none',
  'waived',
  'pending',
  'unpaid',
  'paid',
  'refund_pending',
  'refunded',
  'refund_failed',
  'retained',
  'applied',
] as const;
export type DepositState = (typeof DEPOSIT_STATES)[number];

export type DepositOutcome = 'none' | 'refunded' | 'retained';
export type DepositDecision = 'refund' | 'retain';
export type CancelledBy = 'guest' | 'staff' | 'system' | 'banquet';

export interface ReservationVenueRef {
  id: string;
  code: string;
  name: Translatable;
  hallId: string;
  hallName: Translatable;
  typeCode: string;
  typeName: Translatable;
}

export interface ReservationCustomer {
  id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
}

export interface ReservationSummary {
  id: string;
  number: string;
  branchId: string;
  kind: ReservationKind;
  status: ReservationStatus;
  source: ReservationSource;
  venue: ReservationVenueRef;
  start: string;
  end: string;
  /** Конец занятости места: конец брони + буфер уборки. */
  blockedUntil: string;
  /** Локальная дата начала (часовой пояс филиала). */
  date: string;
  time: string;
  durationMinutes: number;
  guests: number;
  customer: ReservationCustomer;
  comment: string | null;
  occasion: string | null;
  note: string | null;
  deposit: Money | null;
  depositState: DepositState;
  depositOutcome: DepositOutcome;
  /** Бронь будет снята, если не подтвердят / не оплатят до этого момента. */
  holdExpiresAt: string | null;
  banquetRequestId: string | null;
  /** Требует отметки «пришли / не пришли». */
  needsMark: boolean;
  createdAt: string;
}

export interface DepositPayment {
  id: string;
  status: string;
  amount: Money;
  refundedAmount: Money;
  paymentUrl: string | null;
  paidAt: string | null;
}

export interface StatusHistoryEntry {
  from: ReservationStatus | null;
  to: ReservationStatus;
  reason: string | null;
  depositOutcome: DepositOutcome;
  actorKind: string;
  actorName: string;
  occurredAt: string;
}

export interface ReservationDetail extends ReservationSummary {
  /** Переходы, доступные сотруднику сейчас (решает сервер). */
  allowedTransitions: ReservationStatus[];
  canReschedule: boolean;
  /** Правила брони (снимок на момент брони / переноса). */
  rules: VenueRules;
  /** Дедлайн бесплатной отмены. */
  cancellationDeadline: string;
  /** Исход депозита при отмене сейчас по правилу (сотрудник может решить иначе). */
  depositOutcomeIfCancelled: DepositOutcome;
  depositPayment: DepositPayment | null;
  depositWaiveReason: string | null;
  depositPaidAt: string | null;
  cancelReason: string | null;
  cancelledBy: CancelledBy | null;
  confirmedAt: string | null;
  arrivedAt: string | null;
  noShowAt: string | null;
  cancelledAt: string | null;
  expiredAt: string | null;
  reminderSentAt: string | null;
  manageUrl: string | null;
  history: StatusHistoryEntry[];
}

// ---------------------------------------------------------------- календарь / карта зала

export interface TimelineItem {
  reservationId: string;
  number: string;
  kind: ReservationKind;
  status: ReservationStatus;
  /** Занимает место (pending, awaiting_deposit, confirmed, arrived). */
  blocking: boolean;
  start: string;
  end: string;
  blockedUntil: string;
  guests: number;
  customerName: string | null;
  customerPhone: string | null;
  banquetRequestId: string | null;
  depositState: DepositState;
  needsMark: boolean;
}

export interface TimelineVenue {
  id: string;
  code: string;
  name: Translatable;
  typeCode: string;
  typeName: Translatable;
  capacityMin: number;
  capacityMax: number;
  deposit: Money | null;
  position: VenuePosition;
  isActive: boolean;
  bookableOnline: boolean;
  items: TimelineItem[];
}

export interface TimelineHall {
  id: string;
  code: string;
  name: Translatable;
  planWidth: number;
  planHeight: number;
  isActive: boolean;
  venues: TimelineVenue[];
}

export interface TimeRangeIso {
  start: string;
  end: string;
}

export interface Timeline {
  branchId: string;
  date: string;
  timezone: string;
  /** Начало и конец локальных суток (UTC). */
  from: string;
  to: string;
  /** Часы работы филиала в этот день. */
  openingRanges: TimeRangeIso[];
  halls: TimelineHall[];
}

// ---------------------------------------------------------------- запросы

export interface ReservationsListQuery {
  branchId?: string;
  /** YYYY-MM-DD (локальная дата филиала), включительно. */
  dateFrom?: string;
  dateTo?: string;
  status?: ReservationStatus[];
  kind?: ReservationKind;
  source?: ReservationSource;
  venueId?: string;
  hallId?: string;
  q?: string;
  /** Очередь «требует отметки». */
  needsMark?: boolean;
  page?: number;
  perPage?: number;
}

export type StaffDepositMode = 'payment_link' | 'waive';

export interface CreateStaffReservationInput {
  branchId: string;
  venueId: string;
  date: string;
  time: string;
  guests: number;
  durationMinutes?: number;
  customer: { name?: string; phone: string; email?: string };
  comment?: string;
  occasion?: string;
  note?: string;
  locale?: 'kk' | 'ru' | 'en';
  deposit?: { mode: StaffDepositMode; waiveReason?: string };
  consent?: { personalData?: boolean; marketing?: boolean };
  idempotencyKey?: string;
}

export interface ConfirmReservationInput {
  waiveDepositReason?: string;
}

export interface CancelReservationInput {
  reason: string;
  depositDecision?: DepositDecision;
}

export interface RescheduleReservationInput {
  venueId?: string;
  date?: string;
  time?: string;
  durationMinutes?: number;
  guests?: number;
  reason?: string;
}
