/**
 * Публичный контракт модуля Reservation: залы, места (столы, VIP-залы, юрты — типы конфигурируются),
 * бронирование. Пересечение интервалов по одному месту невозможно (транзакционная блокировка
 * + exclusion constraint в БД). Банкеты занимают места через этот же механизм.
 */
import { MoneyJson } from '../../../shared/kernel/money';
import { Locale, Translatable } from '../../../shared/kernel/translatable';

export const ReservationStatus = {
  /** Ждёт подтверждения персоналом (правило места), держится holdMinutes. */
  Pending: 'pending',
  /** Ждёт онлайн-оплаты депозита, держится holdMinutes. */
  AwaitingDeposit: 'awaiting_deposit',
  Confirmed: 'confirmed',
  /** Гости пришли. */
  Arrived: 'arrived',
  /** Гости не пришли. */
  NoShow: 'no_show',
  Cancelled: 'cancelled',
  /** Не подтверждена / не оплачена вовремя. */
  Expired: 'expired',
} as const;
export type ReservationStatus = (typeof ReservationStatus)[keyof typeof ReservationStatus];

/** Обычная бронь гостя или занятость места под банкет. */
export const ReservationKind = { Regular: 'regular', Banquet: 'banquet' } as const;
export type ReservationKind = (typeof ReservationKind)[keyof typeof ReservationKind];

export interface VenueSummary {
  id: string;
  branchId: string;
  hallId: string;
  hallName: Translatable;
  name: Translatable;
  typeId: string;
  typeCode: string;
  typeName: Translatable;
  capacityMin: number;
  capacityMax: number;
  deposit: MoneyJson | null;
  isActive: boolean;
}

export interface VenueOccupancy {
  reservationId: string;
  venueId: string;
  kind: ReservationKind;
  status: ReservationStatus;
  start: string;
  end: string;
  guests: number;
  banquetRequestId: string | null;
}

/** Для модуля Banquet: занять место под банкет, перенести, освободить. */
export abstract class VenueAvailability {
  abstract listVenues(branchId: string): Promise<VenueSummary[]>;
  abstract getVenue(venueId: string): Promise<VenueSummary>;
  abstract isAvailable(venueId: string, start: Date, end: Date, excludeReservationId?: string | null): Promise<boolean>;
  /** ConflictError 'reservation.venue_occupied', если место занято; ValidationError при превышении вместимости. */
  abstract holdForBanquet(input: {
    venueId: string;
    start: Date;
    end: Date;
    guests: number;
    banquetRequestId: string;
    note?: string | null;
  }): Promise<{ reservationId: string }>;
  abstract moveBanquetHold(
    reservationId: string,
    input: { venueId: string; start: Date; end: Date; guests: number },
  ): Promise<void>;
  abstract releaseBanquetHold(reservationId: string, reason: string): Promise<void>;
  abstract occupancy(branchId: string, from: Date, to: Date): Promise<VenueOccupancy[]>;
}

export const ReservationEvents = {
  ReservationCreated: 'reservation.reservation_created',
  ReservationStatusChanged: 'reservation.reservation_status_changed',
} as const;

export interface ReservationEventCustomer {
  customerId: string | null;
  phone: string | null;
  name: string | null;
}

export interface ReservationCreatedPayload {
  reservationId: string;
  number: string;
  branchId: string;
  venueId: string;
  venueName: Translatable;
  venueTypeCode: string;
  kind: ReservationKind;
  status: ReservationStatus;
  start: string;
  end: string;
  guests: number;
  customer: ReservationEventCustomer;
  deposit: MoneyJson | null;
  banquetRequestId: string | null;
  source: 'web' | 'admin' | 'banquet';
  locale: Locale;
  publicToken: string | null;
  occurredAt: string;
}

export interface ReservationStatusChangedPayload {
  reservationId: string;
  number: string;
  branchId: string;
  venueId: string;
  venueTypeCode: string;
  kind: ReservationKind;
  from: ReservationStatus;
  to: ReservationStatus;
  start: string;
  end: string;
  guests: number;
  customer: ReservationEventCustomer;
  deposit: MoneyJson | null;
  /** Депозит удержан (поздняя отмена / неявка) или возвращён. */
  depositOutcome: 'none' | 'refunded' | 'retained';
  reason: string | null;
  locale: Locale;
  publicToken: string | null;
  occurredAt: string;
}
