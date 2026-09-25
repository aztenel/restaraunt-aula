/**
 * Онлайн-бронь: поиск свободных мест (GET /public/branches/:slug/reservation-availability),
 * выбор места, контакты → POST /public/reservations → страница брони по токену.
 * Свободность, вместимость, депозит и правила отмены определяет сервер (проверка занятости —
 * транзакционно при создании брони); витрина показывает только то, что вернул API.
 */
import type { ApiError } from '@aula/api-client';
import type { BookReservationBody, Reservation, VenueSlot } from './api-types';
import { isSafePaymentUrl } from './payment-flow';
import { hasErrors, validateContact, type ContactValues, type FormErrors } from './validation';

export const BOOKING_TIME_ZONE = 'Asia/Almaty';

export const BOOKING_LIMITS = {
  guestsMin: 1,
  /** Больше — банкет (отдельная заявка с менеджером). */
  guestsMax: 60,
  nameMax: 100,
  occasionMax: 100,
  commentMax: 1000,
  /** Сколько дней вперёд предлагать в календаре (окончательно — правило филиала на сервере). */
  daysAhead: 60,
} as const;

export interface BookingSearch {
  branchSlug: string;
  /** Локальная дата филиала YYYY-MM-DD. */
  date: string;
  /** Локальное время HH:mm. */
  time: string;
  guests: number;
  /** Тип места (справочник типов) или '' — любой. */
  typeCode: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Сегодняшняя дата в часовом поясе филиала (YYYY-MM-DD). */
export function localDate(now: Date, timeZone: string = BOOKING_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts;
}

/** Текущее время в часовом поясе филиала (HH:mm). */
export function localTime(now: Date, timeZone: string = BOOKING_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}

/** Дата + n дней (календарная арифметика в UTC — без часовых поясов). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const value = new Date(Date.UTC(y, m - 1, d + days));
  return value.toISOString().slice(0, 10);
}

/** Варианты времени начала с шагом (по умолчанию 30 минут) — подсказка выбора; правила проверяет сервер. */
export function timeOptions(stepMinutes = 30, from = '10:00', to = '23:00'): string[] {
  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const out: string[] = [];
  for (let m = toMinutes(from); m <= toMinutes(to); m += stepMinutes) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}

/** Поиск по умолчанию: сегодня в 19:00, если ещё рано, иначе завтра. */
export function defaultSearch(branchSlug: string, now: Date): BookingSearch {
  const today = localDate(now);
  const late = localTime(now) >= '18:00';
  return { branchSlug, date: late ? addDays(today, 1) : today, time: '19:00', guests: 2, typeCode: '' };
}

export type SearchField = 'branchSlug' | 'date' | 'time' | 'guests';

export function validateSearch(search: BookingSearch, today: string): FormErrors<SearchField> {
  const errors: FormErrors<SearchField> = {};
  if (!search.branchSlug) errors.branchSlug = 'required';
  if (!DATE_RE.test(search.date)) errors.date = 'required';
  else if (search.date < today) errors.date = 'past';
  if (!TIME_RE.test(search.time)) errors.time = 'required';
  if (!Number.isInteger(search.guests) || search.guests < BOOKING_LIMITS.guestsMin || search.guests > BOOKING_LIMITS.guestsMax) errors.guests = 'range';
  return errors;
}

export interface AvailabilityQuery {
  date: string;
  time: string;
  guests: number;
  typeCode?: string;
  locale: 'kk' | 'ru' | 'en';
}

export function availabilityQuery(search: BookingSearch, locale: 'kk' | 'ru' | 'en'): AvailabilityQuery {
  return { date: search.date, time: search.time, guests: search.guests, ...(search.typeCode ? { typeCode: search.typeCode } : {}), locale };
}

/** Типы мест для фильтра (из карты залов или найденных мест), без повторов, в порядке появления. */
export function venueTypes(venues: ReadonlyArray<{ typeCode: string; typeName: string }>): Array<{ code: string; name: string }> {
  const seen = new Map<string, string>();
  for (const venue of venues) if (!seen.has(venue.typeCode)) seen.set(venue.typeCode, venue.typeName);
  return [...seen].map(([code, name]) => ({ code, name }));
}

// ---------------------------------------------------------------- Контакты и тело брони

export interface BookingContact extends ContactValues {
  occasion: string;
  comment: string;
  consentPersonalData: boolean;
  consentMarketing: boolean;
}

export const EMPTY_CONTACT: BookingContact = {
  name: '',
  phone: '',
  email: '',
  occasion: '',
  comment: '',
  consentPersonalData: false,
  consentMarketing: false,
};

export type ContactField = 'name' | 'phone' | 'email' | 'occasion' | 'comment' | 'consentPersonalData';
export const CONTACT_FIELD_ORDER: readonly ContactField[] = ['name', 'phone', 'email', 'occasion', 'comment', 'consentPersonalData'];

export function validateBookingContact(contact: BookingContact): FormErrors<ContactField> {
  const errors: FormErrors<ContactField> = { ...validateContact(contact, { nameMax: BOOKING_LIMITS.nameMax }) };
  if (contact.occasion.trim().length > BOOKING_LIMITS.occasionMax) errors.occasion = 'tooLong';
  if (contact.comment.trim().length > BOOKING_LIMITS.commentMax) errors.comment = 'tooLong';
  if (!contact.consentPersonalData) errors.consentPersonalData = 'consent';
  return errors;
}

export function canBook(venue: VenueSlot | null, contact: BookingContact): boolean {
  return venue !== null && !hasErrors(validateBookingContact(contact));
}

export function toBookingBody(input: {
  branchId: string;
  venue: Pick<VenueSlot, 'venueId' | 'durationMinutes'>;
  search: Pick<BookingSearch, 'date' | 'time' | 'guests'>;
  contact: BookingContact;
  locale: 'kk' | 'ru' | 'en';
  idempotencyKey: string;
  phoneVerificationToken?: string | null;
}): BookReservationBody {
  const { contact } = input;
  const email = contact.email.trim();
  const comment = contact.comment.trim();
  const occasion = contact.occasion.trim();
  return {
    branchId: input.branchId,
    venueId: input.venue.venueId,
    date: input.search.date,
    time: input.search.time,
    guests: input.search.guests,
    // Длительность показанного слота (по правилу места) — чтобы бронь совпала с тем, что видел гость.
    durationMinutes: input.venue.durationMinutes,
    customer: { name: contact.name.trim(), phone: contact.phone.trim(), ...(email ? { email } : {}) },
    ...(comment ? { comment } : {}),
    ...(occasion ? { occasion } : {}),
    ...(input.phoneVerificationToken ? { phoneVerificationToken: input.phoneVerificationToken } : {}),
    consent: { personalData: contact.consentPersonalData, ...(contact.consentMarketing ? { marketing: true } : {}) },
    locale: input.locale,
    idempotencyKey: input.idempotencyKey,
  };
}

export interface BookingErrorTarget {
  field: ContactField | null;
  needsVerification: boolean;
  /** Место успели занять — обновить свободные места. */
  refresh: boolean;
}

export function bookingErrorTarget(error: Pick<ApiError, 'code'>): BookingErrorTarget {
  switch (error.code) {
    case 'phone.not_verified':
      return { field: null, needsVerification: true, refresh: false };
    case 'phone.invalid':
      return { field: 'phone', needsVerification: false, refresh: false };
    case 'reservation.email_invalid':
      return { field: 'email', needsVerification: false, refresh: false };
    case 'consent.required':
      return { field: 'consentPersonalData', needsVerification: false, refresh: false };
    case 'reservation.venue_occupied':
    case 'reservation.venue_unavailable':
    case 'reservation.capacity_exceeded':
    case 'reservation.capacity_below_minimum':
    case 'reservation.banquet_hold':
      return { field: null, needsVerification: false, refresh: true };
    default:
      return { field: null, needsVerification: false, refresh: false };
  }
}

// ---------------------------------------------------------------- Страница брони

export type ReservationPhase =
  | 'deposit_preparing'
  | 'deposit_awaiting'
  | 'deposit_failed'
  | 'pending'
  | 'confirmed'
  | 'arrived'
  | 'cancelled'
  | 'expired'
  | 'no_show';

type ReservationForPhase = Pick<Reservation, 'status' | 'deposit' | 'canPay'>;

export function reservationPhase(r: ReservationForPhase): ReservationPhase {
  switch (r.status) {
    case 'awaiting_deposit': {
      const status = r.deposit?.paymentStatus ?? null;
      if (status === 'failed' || status === 'cancelled') return 'deposit_failed';
      return r.deposit?.paymentUrl ? 'deposit_awaiting' : 'deposit_preparing';
    }
    case 'pending':
      return 'pending';
    case 'confirmed':
      return 'confirmed';
    case 'arrived':
      return 'arrived';
    case 'no_show':
      return 'no_show';
    case 'expired':
      return 'expired';
    default:
      return 'cancelled';
  }
}

/** Через сколько опросить; null — ждать нечего (итоговый статус или ждём действия гостя). */
export function reservationPollDelay(r: ReservationForPhase): number | null {
  switch (reservationPhase(r)) {
    case 'deposit_preparing':
      return 1500;
    case 'deposit_awaiting':
      return 4000;
    case 'pending':
      return 15_000;
    default:
      return null;
  }
}

export function reservationPaymentRedirect(r: ReservationForPhase, input: { autoPay: boolean; alreadyRedirected: boolean }): string | null {
  if (!input.autoPay || input.alreadyRedirected || reservationPhase(r) !== 'deposit_awaiting') return null;
  const url = r.deposit?.paymentUrl;
  return isSafePaymentUrl(url) ? url : null;
}
