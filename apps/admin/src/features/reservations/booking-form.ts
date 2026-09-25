/**
 * Формы брони оператором и переноса: проверка ввода до отправки и сборка тела запроса.
 * Вместимость, занятость, часы работы, телефон окончательно проверяет сервер (ошибки — по кодам reservation.*).
 */
import type { CreateStaffReservationInput, RescheduleReservationInput, StaffDepositMode } from './types';

export const WAIVE_REASON_MAX = 500;
export const TEXT_MAX = 1000;
export const OCCASION_MAX = 100;

export interface BookingFormValues {
  /** YYYY-MM-DD (локальная дата филиала). */
  date?: string | null;
  /** HH:mm. */
  time?: string | null;
  guests?: number | null;
  /** Пусто — длительность по правилу места. */
  durationMinutes?: number | null;
  venueId?: string | null;
  phone?: string | null;
  name?: string | null;
  email?: string | null;
  comment?: string | null;
  occasion?: string | null;
  note?: string | null;
  locale?: 'kk' | 'ru' | null;
  depositMode?: StaffDepositMode | null;
  waiveReason?: string | null;
  consentPersonalData?: boolean;
  consentMarketing?: boolean;
}

export interface BookingContext {
  branchId: string;
  /** У выбранного места есть депозит — нужно решение: ссылка на оплату или отказ с причиной. */
  venueHasDeposit: boolean;
  /** Сотрудник может отказаться от депозита (reservations.manage в филиале). */
  canWaiveDeposit: boolean;
  idempotencyKey: string;
}

export type BookingIssue =
  | 'date_required'
  | 'time_required'
  | 'guests_required'
  | 'venue_required'
  | 'phone_required'
  | 'phone_invalid'
  | 'deposit_decision_required'
  | 'waive_not_allowed'
  | 'waive_reason_required'
  | 'waive_reason_too_long';

export type BookingErrors = Partial<Record<keyof BookingFormValues, BookingIssue>>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Цифры телефона: +7 и 10 цифр (8XXXXXXXXXX тоже принимается — нормализует сервер). */
export function phoneLooksValid(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) || digits.length === 10;
}

export function validateBooking(values: BookingFormValues, ctx: Pick<BookingContext, 'venueHasDeposit' | 'canWaiveDeposit'>): BookingErrors {
  const errors: BookingErrors = {};
  if (!values.date || !DATE_RE.test(values.date)) errors.date = 'date_required';
  if (!values.time || !TIME_RE.test(values.time)) errors.time = 'time_required';
  if (!values.guests || values.guests < 1) errors.guests = 'guests_required';
  if (!values.venueId) errors.venueId = 'venue_required';
  const phone = values.phone?.trim() ?? '';
  if (!phone) errors.phone = 'phone_required';
  else if (!phoneLooksValid(phone)) errors.phone = 'phone_invalid';
  if (ctx.venueHasDeposit) {
    if (!values.depositMode) errors.depositMode = 'deposit_decision_required';
    else if (values.depositMode === 'waive') {
      const reason = values.waiveReason?.trim() ?? '';
      if (!ctx.canWaiveDeposit) errors.depositMode = 'waive_not_allowed';
      else if (!reason) errors.waiveReason = 'waive_reason_required';
      else if (reason.length > WAIVE_REASON_MAX) errors.waiveReason = 'waive_reason_too_long';
    }
  }
  return errors;
}

function text(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Тело POST /admin/reservations. Депозит — только если у места он есть. */
export function toCreatePayload(values: BookingFormValues, ctx: BookingContext): CreateStaffReservationInput {
  if (!values.date || !values.time || !values.guests || !values.venueId || !values.phone) {
    throw new Error('booking form is incomplete');
  }
  const payload: CreateStaffReservationInput = {
    branchId: ctx.branchId,
    venueId: values.venueId,
    date: values.date,
    time: values.time,
    guests: values.guests,
    customer: { phone: values.phone.trim() },
    locale: values.locale ?? 'ru',
    idempotencyKey: ctx.idempotencyKey,
  };
  if (values.durationMinutes) payload.durationMinutes = values.durationMinutes;
  const name = text(values.name);
  if (name) payload.customer.name = name;
  const email = text(values.email);
  if (email) payload.customer.email = email;
  const comment = text(values.comment);
  if (comment) payload.comment = comment;
  const occasion = text(values.occasion);
  if (occasion) payload.occasion = occasion;
  const note = text(values.note);
  if (note) payload.note = note;
  if (ctx.venueHasDeposit && values.depositMode) {
    payload.deposit =
      values.depositMode === 'waive' ? { mode: 'waive', waiveReason: text(values.waiveReason) } : { mode: 'payment_link' };
  }
  if (values.consentPersonalData || values.consentMarketing) {
    payload.consent = {
      ...(values.consentPersonalData ? { personalData: true } : {}),
      ...(values.consentMarketing ? { marketing: true } : {}),
    };
  }
  return payload;
}

/** Ключ идемпотентности на одну попытку оформления (повтор после сетевой ошибки не создаст вторую бронь). */
export function newIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) return `adm-${cryptoApi.randomUUID()}`;
  return `adm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// ---------------------------------------------------------------- перенос / пересадка

export interface RescheduleFormValues {
  venueId?: string | null;
  date?: string | null;
  time?: string | null;
  durationMinutes?: number | null;
  guests?: number | null;
  reason?: string | null;
}

export interface RescheduleCurrent {
  venueId: string;
  date: string;
  time: string;
  durationMinutes: number;
  guests: number;
}

/**
 * Тело POST /reschedule: только изменённые поля (сервер берёт остальное из брони).
 * null — ничего не изменилось (сервер ответил бы reservation.nothing_to_change).
 */
export function toReschedulePayload(values: RescheduleFormValues, current: RescheduleCurrent): RescheduleReservationInput | null {
  const payload: RescheduleReservationInput = {};
  if (values.venueId && values.venueId !== current.venueId) payload.venueId = values.venueId;
  if (values.date && values.date !== current.date) payload.date = values.date;
  if (values.time && values.time !== current.time) payload.time = values.time;
  if (values.durationMinutes && values.durationMinutes !== current.durationMinutes) payload.durationMinutes = values.durationMinutes;
  if (values.guests && values.guests !== current.guests) payload.guests = values.guests;
  if (Object.keys(payload).length === 0) return null;
  const reason = text(values.reason);
  if (reason) payload.reason = reason;
  return payload;
}
