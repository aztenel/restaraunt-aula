import { ValidationError } from '../../../shared/kernel/errors';
import {
  addDays,
  addMinutes,
  isHhMm,
  isIsoDate,
  OpeningHours,
  openingRangesForDate,
  startOfLocalDay,
  TimeRange,
  toLocalDate,
  toLocalTime,
  zonedTimeToUtc,
} from '../../../shared/kernel/time';
import { capacityFits } from './venue';
import { VenueRules } from './venue-rules';

/**
 * Свободные места. Бронь занимает интервал [начало, конец + буфер уборки); место свободно,
 * если этот интервал не пересекается с занятостью других броней (включая банкеты) и
 * весь интервал [начало, конец) лежит в часах работы филиала (в его часовом поясе).
 */
export interface BusyInterval {
  reservationId: string;
  venueId: string;
  start: Date;
  /** Конец занятости (конец брони + её буфер уборки). */
  blockedUntil: Date;
}

export interface VenueCandidate {
  venueId: string;
  capacityMin: number;
  capacityMax: number;
  rules: VenueRules;
}

export interface BookingWindow {
  now: Date;
  timezone: string;
  openingHours: OpeningHours;
  /** Бронь не раньше чем через N минут (витрина); null — только «не в прошлом». */
  minLeadMinutes: number | null;
  /** Не дальше N дней вперёд (витрина); null — без ограничения. */
  maxDaysAhead: number | null;
  /** Проверять часы работы. */
  enforceOpeningHours: boolean;
}

/** Канал брони: витрина (ограничения по времени упреждения и горизонту) или оператор в админке. */
export type BookingChannel = 'web' | 'admin';

/** Оператор может оформить бронь с началом чуть в прошлом (гости уже пришли, «живая» посадка). */
export const STAFF_BACKDATE_GRACE_MINUTES = 15;

/** Окно брони для канала: витрина — lead time и горизонт из настроек филиала; оператор — без них. */
export function bookingWindow(
  channel: BookingChannel,
  input: { now: Date; timezone: string; openingHours: OpeningHours; minLeadMinutes: number; maxDaysAhead: number },
): BookingWindow {
  if (channel === 'web') {
    return {
      now: input.now,
      timezone: input.timezone,
      openingHours: input.openingHours,
      minLeadMinutes: input.minLeadMinutes,
      maxDaysAhead: input.maxDaysAhead,
      enforceOpeningHours: true,
    };
  }
  return {
    now: addMinutes(input.now, -STAFF_BACKDATE_GRACE_MINUTES),
    timezone: input.timezone,
    openingHours: input.openingHours,
    minLeadMinutes: null,
    maxDaysAhead: null,
    enforceOpeningHours: true,
  };
}

/** Причина, по которой время недоступно (витрина показывает соответствующий текст). */
export type SlotRejection = 'past' | 'too_soon' | 'too_far' | 'closed';

export const MAX_ALTERNATIVES = 6;
export const DEFAULT_SLOT_STEP_MINUTES = 30;

export function assertLocalDateTime(date: string, time: string): void {
  if (!isIsoDate(date) || !isHhMm(time)) {
    throw new ValidationError('reservation.invalid_datetime', 'Expected date YYYY-MM-DD and time HH:mm', { date, time });
  }
}

/** Интервал брони по локальной дате/времени филиала. */
export function slotRange(date: string, time: string, timezone: string, durationMinutes: number): TimeRange {
  assertLocalDateTime(date, time);
  assertDuration(durationMinutes);
  const start = zonedTimeToUtc(date, time, timezone);
  return new TimeRange(start, addMinutes(start, durationMinutes));
}

/** Интервал занятости места: [начало, конец + буфер уборки). */
export function blockedRange(range: TimeRange, cleanupMinutes: number): TimeRange {
  return new TimeRange(range.start, addMinutes(range.end, cleanupMinutes));
}

/** Пересекается ли занятость места с другими бронями этого места. */
export function isVenueFree(venueId: string, blocked: TimeRange, busy: readonly BusyInterval[], excludeReservationId?: string | null): boolean {
  return !busy.some(
    (b) =>
      b.venueId === venueId &&
      b.reservationId !== excludeReservationId &&
      b.start.getTime() < blocked.end.getTime() &&
      blocked.start.getTime() < b.blockedUntil.getTime(),
  );
}

/** Лежит ли [start, end) целиком в одном интервале работы (с учётом работы после полуночи). */
export function fitsOpeningRanges(range: TimeRange, openingRanges: readonly TimeRange[]): boolean {
  return openingRanges.some((r) => r.start.getTime() <= range.start.getTime() && range.end.getTime() <= r.end.getTime());
}

/** Интервалы работы, в которые может попасть бронь с началом в локальную дату date. */
export function openingRangesFor(openingHours: OpeningHours, date: string, timezone: string): TimeRange[] {
  return openingRangesForDate(openingHours, date, timezone);
}

/** Проверка времени брони: не в прошлом, не раньше lead, не дальше maxDaysAhead, в часы работы. */
export function checkBookingWindow(range: TimeRange, window: BookingWindow, openingRanges?: readonly TimeRange[]): SlotRejection | null {
  const now = window.now.getTime();
  if (range.start.getTime() < now) return 'past';
  if (window.minLeadMinutes !== null && range.start.getTime() < addMinutes(window.now, window.minLeadMinutes).getTime()) return 'too_soon';
  if (window.maxDaysAhead !== null && range.start.getTime() > addMinutes(window.now, window.maxDaysAhead * 1440).getTime()) return 'too_far';
  if (window.enforceOpeningHours) {
    const ranges = openingRanges ?? openingRangesFor(window.openingHours, toLocalDate(range.start, window.timezone), window.timezone);
    if (!fitsOpeningRanges(range, ranges)) return 'closed';
  }
  return null;
}

export interface VenueSlot {
  venueId: string;
  range: TimeRange;
  blocked: TimeRange;
  durationMinutes: number;
}

function assertDuration(durationMinutes: number): void {
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 1440) {
    throw new ValidationError('reservation.invalid_duration', 'Duration must be an integer number of minutes in [15, 1440]', {
      durationMinutes,
    });
  }
}

/** Слот конкретного места с началом start: длительность — из запроса или правила места. */
export function venueSlotAt(candidate: VenueCandidate, start: Date, durationOverride?: number | null): VenueSlot {
  const durationMinutes = durationOverride ?? candidate.rules.durationMinutes;
  assertDuration(durationMinutes);
  const range = new TimeRange(start, addMinutes(start, durationMinutes));
  return { venueId: candidate.venueId, range, blocked: blockedRange(range, candidate.rules.cleanupMinutes), durationMinutes };
}

export interface FreeVenuesResult {
  free: VenueSlot[];
  /** Почему нет мест (если free пуст). */
  reason: SlotRejection | 'no_capacity' | 'occupied' | null;
}

/**
 * Реально свободные места на время: вместимость подходит, время в окне брони и в часах работы,
 * занятость [начало, конец + буфер) не пересекается с другими бронями места.
 */
export function findFreeVenues(input: {
  candidates: readonly VenueCandidate[];
  busy: readonly BusyInterval[];
  guests: number;
  date: string;
  time: string;
  durationMinutes?: number | null;
  window: BookingWindow;
}): FreeVenuesResult {
  const fitting = input.candidates.filter((c) => capacityFits(input.guests, c.capacityMin, c.capacityMax));
  if (fitting.length === 0) return { free: [], reason: 'no_capacity' };
  assertLocalDateTime(input.date, input.time);
  const ranges = openingRangesFor(input.window.openingHours, input.date, input.window.timezone);
  const start = zonedTimeToUtc(input.date, input.time, input.window.timezone);
  const free: VenueSlot[] = [];
  let rejection: SlotRejection | null = null;
  for (const candidate of fitting) {
    const slot = venueSlotAt(candidate, start, input.durationMinutes);
    const rejected = checkBookingWindow(slot.range, input.window, ranges);
    if (rejected) {
      rejection ??= rejected;
      continue;
    }
    if (isVenueFree(candidate.venueId, slot.blocked, input.busy)) free.push(slot);
  }
  if (free.length > 0) return { free, reason: null };
  return { free, reason: rejection ?? 'occupied' };
}

export interface AlternativeTime {
  date: string;
  time: string;
  start: Date;
  venueIds: string[];
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Альтернативное время в тот же день, если на запрошенное мест нет: сетка с шагом места
 * (минимальный среди подходящих), ближайшие к запрошенному времени варианты.
 */
export function suggestAlternatives(input: {
  candidates: readonly VenueCandidate[];
  busy: readonly BusyInterval[];
  guests: number;
  date: string;
  time: string;
  durationMinutes?: number | null;
  window: BookingWindow;
  limit?: number;
}): AlternativeTime[] {
  const fitting = input.candidates.filter((c) => capacityFits(input.guests, c.capacityMin, c.capacityMax));
  if (fitting.length === 0) return [];
  const step = Math.min(...fitting.map((c) => c.rules.slotStepMinutes || DEFAULT_SLOT_STEP_MINUTES));
  const requested = minutesOf(input.time);
  const ranges = openingRangesFor(input.window.openingHours, input.date, input.window.timezone);
  const found: AlternativeTime[] = [];
  for (let minutes = 0; minutes < 1440; minutes += step) {
    if (minutes === requested) continue;
    const time = hhmm(minutes);
    const start = zonedTimeToUtc(input.date, time, input.window.timezone);
    const venueIds: string[] = [];
    for (const candidate of fitting) {
      const slot = venueSlotAt(candidate, start, input.durationMinutes);
      if (checkBookingWindow(slot.range, input.window, ranges)) continue;
      if (isVenueFree(candidate.venueId, slot.blocked, input.busy)) venueIds.push(candidate.venueId);
    }
    if (venueIds.length > 0) found.push({ date: input.date, time, start, venueIds });
  }
  return found
    .sort((a, b) => Math.abs(minutesOf(a.time) - requested) - Math.abs(minutesOf(b.time) - requested) || minutesOf(a.time) - minutesOf(b.time))
    .slice(0, input.limit ?? MAX_ALTERNATIVES)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Локальные дата и время начала брони (для текстов и витрины). */
export function localDateTime(at: Date, timezone: string): { date: string; time: string } {
  return { date: toLocalDate(at, timezone), time: toLocalTime(at, timezone) };
}

/** Интервал допустимых времён начала брони в локальную дату (сетка шага от локальной полуночи). */
export interface BookingDayInterval {
  /** Первое время начала, HH:mm (местное время филиала). */
  from: string;
  /** Последнее время начала, HH:mm (бронь длительностью durationMinutes ещё помещается в часы работы). */
  to: string;
  fromAt: Date;
  toAt: Date;
}

export interface BookingDay {
  date: string;
  /** Пусто — в этот день бронь с витрины невозможна (выходной, прошло, вне горизонта). */
  intervals: BookingDayInterval[];
}

/** Горизонт календаря брони не больше года. */
const MAX_CALENDAR_DAYS = 366;

/**
 * Окно брони по датам для выбора даты и времени на витрине: для каждой локальной даты — интервалы
 * времён начала на сетке stepMinutes (от локальной полуночи, как у подбора альтернатив), в которые
 * бронь длительностью durationMinutes целиком помещается в часы работы, не раньше упреждения и не
 * дальше горизонта окна. Занятость мест не учитывается — её проверяет запрос свободных мест.
 */
export function bookingDays(input: { window: BookingWindow; stepMinutes: number; durationMinutes: number; dates: readonly string[] }): BookingDay[] {
  const { window } = input;
  const step = Math.max(1, Math.floor(input.stepMinutes));
  const earliest = addMinutes(window.now, window.minLeadMinutes ?? 0).getTime();
  const latest = window.maxDaysAhead !== null ? addMinutes(window.now, window.maxDaysAhead * 1440).getTime() : Number.POSITIVE_INFINITY;
  const lastGrid = Math.floor((1440 - 1) / step) * step;
  return input.dates.map((date) => {
    const dayStart = startOfLocalDay(date, window.timezone).getTime();
    const ranges = openingRangesForDate(window.openingHours, date, window.timezone).sort((a, b) => a.start.getTime() - b.start.getTime());
    const intervals: BookingDayInterval[] = [];
    for (const range of ranges) {
      const lo = Math.max(range.start.getTime(), dayStart, earliest);
      const hi = Math.min(range.end.getTime() - input.durationMinutes * 60_000, latest);
      if (hi < lo) continue;
      const fromMin = Math.ceil((lo - dayStart) / 60_000 / step) * step;
      const toMin = Math.min(Math.floor((hi - dayStart) / 60_000 / step) * step, lastGrid);
      if (fromMin > toMin || fromMin >= 1440) continue;
      const last = intervals[intervals.length - 1];
      const from = hhmm(fromMin);
      const to = hhmm(toMin);
      if (last && minutesOf(last.to) + step >= fromMin) {
        if (toMin > minutesOf(last.to)) {
          last.to = to;
          last.toAt = zonedTimeToUtc(date, to, window.timezone);
        }
        continue;
      }
      intervals.push({ from, to, fromAt: zonedTimeToUtc(date, from, window.timezone), toAt: zonedTimeToUtc(date, to, window.timezone) });
    }
    return { date, intervals };
  });
}

/** Локальные даты от сегодняшней до последней даты горизонта окна (включительно), не больше года. */
export function bookingCalendarDates(window: BookingWindow): string[] {
  const today = toLocalDate(window.now, window.timezone);
  const days = window.maxDaysAhead !== null ? Math.min(window.maxDaysAhead, MAX_CALENDAR_DAYS - 1) : 0;
  return Array.from({ length: days + 1 }, (_, i) => addDays(today, i));
}
