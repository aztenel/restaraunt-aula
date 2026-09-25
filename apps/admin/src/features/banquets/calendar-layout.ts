/**
 * Календарь мероприятий: раскладка дней (месяц/неделя, неделя с понедельника), банкеты по датам,
 * занятость залов (брони и банкеты из модуля бронирования) по залам и дням в часовом поясе филиалов.
 * Чистые функции — тестируются без браузера. Даты мероприятий — локальные 'YYYY-MM-DD'.
 */
import { dayjs, DISPLAY_TIMEZONE } from '@/shared/lib/dates';

export type CalendarMode = 'month' | 'week';

/** Максимальный диапазон запроса календаря на сервере (дней). */
export const MAX_CALENDAR_DAYS = 93;

const DAY_MS = 86_400_000;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toUtcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(date: string, days: number): string {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

/** Сегодня в часовом поясе филиалов. */
export function todayLocal(nowMs = Date.now(), tz = DISPLAY_TIMEZONE): string {
  return dayjs(nowMs).tz(tz).format('YYYY-MM-DD');
}

/** 0 — понедельник … 6 — воскресенье. */
export function weekdayIndex(date: string): number {
  return (new Date(toUtcMs(date)).getUTCDay() + 6) % 7;
}

export function startOfWeek(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function monthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return fromUtcMs(Date.UTC(y, m, 0));
}

export function isSameMonth(date: string, anchor: string): boolean {
  return date.slice(0, 7) === anchor.slice(0, 7);
}

/** Сетка месяца: недели (пн–вс), от недели первого числа до недели последнего (5–6 строк). */
export function monthWeeks(anchor: string): string[][] {
  const first = startOfWeek(monthStart(anchor));
  const last = addDays(startOfWeek(monthEnd(anchor)), 6);
  const weeks: string[][] = [];
  for (let day = first; day <= last; day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
  }
  return weeks;
}

export function weekDays(anchor: string): string[] {
  const first = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

/** Диапазон запроса GET /calendar для вида (включительно). */
export function calendarRange(mode: CalendarMode, anchor: string): { from: string; to: string; days: string[] } {
  const days = mode === 'month' ? monthWeeks(anchor).flat() : weekDays(anchor);
  return { from: days[0]!, to: days[days.length - 1]!, days };
}

/** Перелистывание: месяц — на первое число соседнего месяца, неделя — ±7 дней. */
export function shiftAnchor(mode: CalendarMode, anchor: string, delta: number): string {
  if (mode === 'week') return addDays(anchor, delta * 7);
  const [y, m] = anchor.split('-').map(Number) as [number, number];
  return fromUtcMs(Date.UTC(y, m - 1 + delta, 1));
}

/** Банкеты по дате мероприятия, внутри дня — по времени начала (без времени — в конце). */
export function banquetsByDate<T extends { eventDate: string; eventTime: string | null }>(banquets: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const b of banquets) {
    const list = map.get(b.eventDate) ?? [];
    list.push(b);
    map.set(b.eventDate, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.eventTime ?? '99:99').localeCompare(b.eventTime ?? '99:99'));
  }
  return map;
}

export interface OccupancyLike {
  reservationId: string;
  venueId: string;
  kind: string;
  status: string;
  start: string;
  end: string;
  guests: number;
  banquetRequestId: string | null;
}

export interface OccupancySegment {
  reservationId: string;
  venueId: string;
  kind: 'regular' | 'banquet';
  status: string;
  guests: number;
  banquetRequestId: string | null;
  /** Локальная дата отрезка. */
  date: string;
  /** Минуты от начала локального дня: [start, end). */
  startMinute: number;
  endMinute: number;
  /** Занятость началась в предыдущий день / продолжается на следующий. */
  continuesBefore: boolean;
  continuesAfter: boolean;
  /** Полный интервал «HH:mm–HH:mm» (локальное время). */
  label: string;
}

/**
 * Разбить занятость по локальным дням: банкет 18:00–02:00 даёт два отрезка — 18:00–24:00 и 00:00–02:00.
 */
export function splitOccupancy(items: readonly OccupancyLike[], tz = DISPLAY_TIMEZONE): OccupancySegment[] {
  const segments: OccupancySegment[] = [];
  for (const item of items) {
    const start = dayjs(item.start).tz(tz);
    const end = dayjs(item.end).tz(tz);
    if (!start.isValid() || !end.isValid() || !end.isAfter(start)) continue;
    const label = `${start.format('HH:mm')}–${end.format('HH:mm')}`;
    const startDate = start.format('YYYY-MM-DD');
    const endMinuteOfDay = end.hour() * 60 + end.minute();
    // Окончание ровно в полночь — последний день не захватывается.
    const lastDate = endMinuteOfDay === 0 ? addDays(end.format('YYYY-MM-DD'), -1) : end.format('YYYY-MM-DD');
    for (let date = startDate; date <= lastDate; date = addDays(date, 1)) {
      const first = date === startDate;
      const last = date === lastDate;
      segments.push({
        reservationId: item.reservationId,
        venueId: item.venueId,
        kind: item.kind === 'banquet' ? 'banquet' : 'regular',
        status: item.status,
        guests: item.guests,
        banquetRequestId: item.banquetRequestId,
        date,
        startMinute: first ? start.hour() * 60 + start.minute() : 0,
        endMinute: last && endMinuteOfDay !== 0 ? endMinuteOfDay : 1440,
        continuesBefore: !first,
        continuesAfter: !last,
        label,
      });
    }
  }
  return segments.sort((a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute);
}

export function cellKey(venueId: string, date: string): string {
  return `${venueId}|${date}`;
}

/** Отрезки занятости по залу и дню (ключ cellKey). */
export function occupancyByVenueDay(segments: readonly OccupancySegment[]): Map<string, OccupancySegment[]> {
  const map = new Map<string, OccupancySegment[]>();
  for (const s of segments) {
    const key = cellKey(s.venueId, s.date);
    const list = map.get(key) ?? [];
    list.push(s);
    map.set(key, list);
  }
  return map;
}

/** Сводка дня для месяца: сколько броней и банкетных занятостей залов (по уникальным броням). */
export function occupancySummaryByDate(segments: readonly OccupancySegment[]): Map<string, { regular: number; banquet: number }> {
  const seen = new Map<string, Set<string>>();
  const map = new Map<string, { regular: number; banquet: number }>();
  for (const s of segments) {
    const ids = seen.get(s.date) ?? new Set<string>();
    if (ids.has(s.reservationId)) continue;
    ids.add(s.reservationId);
    seen.set(s.date, ids);
    const summary = map.get(s.date) ?? { regular: 0, banquet: 0 };
    summary[s.kind] += 1;
    map.set(s.date, summary);
  }
  return map;
}

/** Положение полосы занятости в ячейке дня (проценты ширины суток). */
export function segmentPosition(segment: Pick<OccupancySegment, 'startMinute' | 'endMinute'>): { left: number; width: number } {
  const start = Math.min(Math.max(segment.startMinute, 0), 1440);
  const end = Math.min(Math.max(segment.endMinute, start), 1440);
  const round = (v: number) => Math.round(v * 100) / 100;
  return { left: round((start / 1440) * 100), width: round(Math.max(((end - start) / 1440) * 100, 1)) };
}

/** Зал свободен в интервале [start, end) минут дня (подсказка при выборе зала; окончательно проверяет сервер). */
export function overlaps(segments: readonly Pick<OccupancySegment, 'startMinute' | 'endMinute'>[], startMinute: number, endMinute: number): boolean {
  return segments.some((s) => s.startMinute < endMinute && startMinute < s.endMinute);
}

/** 'HH:mm' → минуты. */
export function timeToMinutes(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
