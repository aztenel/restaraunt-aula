import { ValidationError } from './errors';

/**
 * Время хранится в UTC, отображается в Asia/Almaty.
 * Все преобразования «локальное время филиала <-> UTC» идут только через эти функции.
 */
export const DEFAULT_TIMEZONE = 'Asia/Almaty';

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isIsoDate(value: string): boolean {
  return DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function isHhMm(value: string): boolean {
  return TIME_RE.test(value);
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: Weekday;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    partsFormatterCache.set(timeZone, f);
  }
  return f;
}

/** Разложить момент времени на части в указанной зоне. */
export function zonedParts(date: Date, timeZone: string = DEFAULT_TIMEZONE): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  const wd = get('weekday').toLowerCase().slice(0, 3) as Weekday;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: wd,
  };
}

/** Смещение зоны относительно UTC в минутах для данного момента. */
export function timezoneOffsetMinutes(date: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** Локальные дата и время филиала ('2026-09-25', '19:30') -> момент UTC. */
export function zonedTimeToUtc(date: string, time: string, timeZone: string = DEFAULT_TIMEZONE): Date {
  if (!isIsoDate(date) || !isHhMm(time)) {
    throw new ValidationError('time.invalid_local', 'Expected date YYYY-MM-DD and time HH:mm', { date, time });
  }
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const offset = timezoneOffsetMinutes(guess, timeZone);
  const result = new Date(guess.getTime() - offset * 60_000);
  // Повторная коррекция на случай перехода смещения между guess и result.
  const offset2 = timezoneOffsetMinutes(result, timeZone);
  return offset2 === offset ? result : new Date(guess.getTime() - offset2 * 60_000);
}

/** Момент UTC -> локальная дата 'YYYY-MM-DD' в зоне филиала. */
export function toLocalDate(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Момент UTC -> локальное время 'HH:mm'. */
export function toLocalTime(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const p = zonedParts(date, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function localWeekday(date: Date, timeZone: string = DEFAULT_TIMEZONE): Weekday {
  return zonedParts(date, timeZone).weekday;
}

/** Начало локальных суток (00:00 в зоне) в UTC. */
export function startOfLocalDay(date: string, timeZone: string = DEFAULT_TIMEZONE): Date {
  return zonedTimeToUtc(date, '00:00', timeZone);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function addHours(date: Date, hours: number): Date {
  return addMinutes(date, hours * 60);
}

/** Полуоткрытый интервал [start, end). */
export class TimeRange {
  constructor(
    readonly start: Date,
    readonly end: Date,
  ) {
    if (!(end.getTime() > start.getTime())) {
      throw new ValidationError('time_range.invalid', 'End must be after start', {
        start: start.toISOString(),
        end: end.toISOString(),
      });
    }
  }

  overlaps(other: TimeRange): boolean {
    return this.start < other.end && other.start < this.end;
  }

  contains(date: Date): boolean {
    return date >= this.start && date < this.end;
  }

  durationMinutes(): number {
    return Math.round((this.end.getTime() - this.start.getTime()) / 60_000);
  }

  toJSON(): { start: string; end: string } {
    return { start: this.start.toISOString(), end: this.end.toISOString() };
  }
}

/**
 * Часы работы по дням недели в локальном времени филиала.
 * Интервал может переходить через полночь: { open: '10:00', close: '02:00' }.
 */
export interface OpeningInterval {
  open: string;
  close: string;
}
export type OpeningHours = Partial<Record<Weekday, OpeningInterval[]>>;

export function validateOpeningHours(hours: OpeningHours): OpeningHours {
  for (const [day, intervals] of Object.entries(hours)) {
    if (!(WEEKDAYS as readonly string[]).includes(day)) {
      throw new ValidationError('opening_hours.invalid_day', `Unknown weekday ${day}`);
    }
    for (const interval of intervals ?? []) {
      if (!isHhMm(interval.open) || !isHhMm(interval.close) || interval.open === interval.close) {
        throw new ValidationError('opening_hours.invalid_interval', `Invalid interval for ${day}`, { interval });
      }
    }
  }
  return hours;
}

/**
 * Интервалы работы в UTC, пересекающие локальную дату (включая «хвост» предыдущей ночи).
 */
export function openingRangesForDate(hours: OpeningHours, date: string, timeZone: string = DEFAULT_TIMEZONE): TimeRange[] {
  const ranges: TimeRange[] = [];
  for (const offset of [-1, 0]) {
    const day = addDays(date, offset);
    const weekday = localWeekday(zonedTimeToUtc(day, '12:00', timeZone), timeZone);
    for (const interval of hours[weekday] ?? []) {
      const start = zonedTimeToUtc(day, interval.open, timeZone);
      const closeDay = interval.close <= interval.open ? addDays(day, 1) : day;
      const end = zonedTimeToUtc(closeDay, interval.close, timeZone);
      const range = new TimeRange(start, end);
      const dayStart = startOfLocalDay(date, timeZone);
      const dayEnd = startOfLocalDay(addDays(date, 1), timeZone);
      if (range.overlaps(new TimeRange(dayStart, dayEnd))) {
        ranges.push(range);
      }
    }
  }
  return ranges;
}

/** Открыт ли филиал в момент времени. */
export function isOpenAt(hours: OpeningHours, at: Date, timeZone: string = DEFAULT_TIMEZONE): boolean {
  const date = toLocalDate(at, timeZone);
  return openingRangesForDate(hours, date, timeZone).some((r) => r.contains(at));
}

/** Помещается ли интервал целиком в часы работы. */
export function isWithinOpeningHours(hours: OpeningHours, range: TimeRange, timeZone: string = DEFAULT_TIMEZONE): boolean {
  const date = toLocalDate(range.start, timeZone);
  return openingRangesForDate(hours, date, timeZone).some((r) => r.start <= range.start && range.end <= r.end);
}
