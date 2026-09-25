/**
 * Геометрия шахматки броней (календарь дня по местам) — чистые функции, без DOM.
 *
 * Время — миллисекунды UTC; шкала — окно [start, end) в часовом поясе филиала, округлённое до часа.
 * Бронь рисуется двумя отрезками: основной [начало, конец) и буфер уборки [конец, blockedUntil).
 * Позиции — проценты ширины дорожки (адаптивная вёрстка без пересчёта при изменении размера).
 * Ничего не решается о занятости: сервер уже отдал интервалы (start, end, blockedUntil).
 */
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface TimeWindow {
  start: number;
  end: number;
}

export interface Interval {
  start: number;
  end: number;
}

/** Отрезок на шкале: левый край и ширина в процентах; clipped* — обрезан краем окна. */
export interface Segment {
  left: number;
  width: number;
  clippedStart: boolean;
  clippedEnd: boolean;
}

export function toMs(value: string | number | Date): number {
  return typeof value === 'number' ? value : new Date(value).getTime();
}

/** Начало часа в часовом поясе филиала (корректно и для поясов со сдвигом не на целый час). */
export function floorToHour(ms: number, tz: string): number {
  return dayjs(ms).tz(tz).startOf('hour').valueOf();
}

export function ceilToHour(ms: number, tz: string): number {
  const floor = floorToHour(ms, tz);
  return floor === ms ? ms : floor + HOUR;
}

export interface TimelineWindowInput {
  /** Начало и конец локальных суток (ISO UTC из ответа timeline). */
  from: string;
  to: string;
  openingRanges: ReadonlyArray<{ start: string; end: string }>;
  items: ReadonlyArray<{ start: string; blockedUntil: string }>;
  timezone: string;
  /** Окно, если нет ни часов работы, ни броней: 10:00–24:00. */
  fallbackStartHour?: number;
  /** Сколько часов после конца суток можно показать (работа после полуночи). */
  maxOverflowHours?: number;
}

/**
 * Окно шкалы дня: часы работы филиала, расширенные бронями, которые выходят за них;
 * не раньше начала суток (брони с предыдущего дня обрезаются), не позже конца суток + maxOverflowHours;
 * края округляются до часа. Выходной без броней — запасное окно.
 */
export function timelineWindow(input: TimelineWindowInput): TimeWindow {
  const dayStart = toMs(input.from);
  const dayEnd = toMs(input.to);
  const maxEnd = dayEnd + (input.maxOverflowHours ?? 12) * HOUR;
  const starts: number[] = [];
  const ends: number[] = [];
  for (const r of input.openingRanges) {
    starts.push(toMs(r.start));
    ends.push(toMs(r.end));
  }
  for (const item of input.items) {
    starts.push(toMs(item.start));
    ends.push(toMs(item.blockedUntil));
  }
  if (starts.length === 0) {
    return { start: dayStart + (input.fallbackStartHour ?? 10) * HOUR, end: dayEnd };
  }
  const start = Math.max(dayStart, Math.min(...starts));
  const end = Math.min(maxEnd, Math.max(...ends, start + HOUR));
  return { start: floorToHour(start, input.timezone), end: ceilToHour(end, input.timezone) };
}

/** Интервал → отрезок шкалы (null — целиком вне окна или пустой). */
export function segmentOf(interval: Interval, window: TimeWindow): Segment | null {
  const span = window.end - window.start;
  if (span <= 0 || interval.end <= interval.start) return null;
  const start = Math.max(interval.start, window.start);
  const end = Math.min(interval.end, window.end);
  if (end <= start) return null;
  return {
    left: ((start - window.start) / span) * 100,
    width: ((end - start) / span) * 100,
    clippedStart: interval.start < window.start,
    clippedEnd: interval.end > window.end,
  };
}

export interface ItemGeometry {
  /** Сама бронь [начало, конец). */
  main: Segment | null;
  /** Буфер уборки [конец, blockedUntil) — затенённая часть. */
  buffer: Segment | null;
}

export function itemGeometry(item: { start: string; end: string; blockedUntil: string }, window: TimeWindow): ItemGeometry {
  const start = toMs(item.start);
  const end = toMs(item.end);
  const blockedUntil = toMs(item.blockedUntil);
  return {
    main: segmentOf({ start, end }, window),
    buffer: blockedUntil > end ? segmentOf({ start: end, end: blockedUntil }, window) : null,
  };
}

/**
 * Дорожки внутри строки места: брони, пересекающиеся по [начало, blockedUntil) (например «не пришли»
 * и новая бронь на то же время), раскладываются по разным дорожкам. Жадно по времени начала.
 */
export function assignLanes<T extends { id: string; start: string; blockedUntil: string }>(
  items: readonly T[],
): { lanes: Map<string, number>; count: number } {
  const sorted = [...items].sort((a, b) => toMs(a.start) - toMs(b.start) || toMs(a.blockedUntil) - toMs(b.blockedUntil));
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const item of sorted) {
    const start = toMs(item.start);
    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = toMs(item.blockedUntil);
    lanes.set(item.id, lane);
  }
  return { lanes, count: Math.max(1, laneEnds.length) };
}

export interface HourTick {
  at: number;
  left: number;
  /** Локальное время 'HH:mm'. */
  label: string;
}

/** Деления шкалы каждый час (step — через сколько часов подписывать). */
export function hourTicks(window: TimeWindow, tz: string, stepHours = 1): HourTick[] {
  const ticks: HourTick[] = [];
  const span = window.end - window.start;
  if (span <= 0) return ticks;
  for (let at = ceilToHour(window.start, tz); at <= window.end; at += stepHours * HOUR) {
    ticks.push({ at, left: ((at - window.start) / span) * 100, label: dayjs(at).tz(tz).format('HH:mm') });
  }
  return ticks;
}

/** Нерабочее время внутри окна (дополнение к часам работы) — затемняется на шкале. */
export function closedSegments(window: TimeWindow, openingRanges: ReadonlyArray<{ start: string; end: string }>): Segment[] {
  const ranges = openingRanges
    .map((r) => ({ start: Math.max(toMs(r.start), window.start), end: Math.min(toMs(r.end), window.end) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const gaps: Interval[] = [];
  let cursor = window.start;
  for (const r of ranges) {
    if (r.start > cursor) gaps.push({ start: cursor, end: r.start });
    cursor = Math.max(cursor, r.end);
  }
  if (cursor < window.end) gaps.push({ start: cursor, end: window.end });
  return gaps.map((g) => segmentOf(g, window)).filter((s): s is Segment => s !== null);
}

/**
 * Время по позиции клика на дорожке (доля ширины 0..1) с округлением вниз до шага (минуты от начала часа).
 * Используется для «новая бронь на это время».
 */
export function timeAtFraction(fraction: number, window: TimeWindow, stepMinutes = 15): number {
  const clamped = Math.min(1, Math.max(0, fraction));
  const raw = window.start + clamped * (window.end - window.start);
  const step = stepMinutes * MINUTE;
  const snapped = window.start + Math.floor((raw - window.start) / step) * step;
  return Math.min(snapped, window.end - step);
}

/** Положение линии «сейчас» (проценты) или null, если сейчас вне окна. */
export function nowOffset(now: number, window: TimeWindow): number | null {
  if (now < window.start || now > window.end) return null;
  return ((now - window.start) / (window.end - window.start)) * 100;
}

/** Локальные дата и время для формы брони по моменту UTC. */
export function localDateTime(ms: number, tz: string): { date: string; time: string } {
  const local = dayjs(ms).tz(tz);
  return { date: local.format('YYYY-MM-DD'), time: local.format('HH:mm') };
}

/** Сегодняшняя дата в часовом поясе филиала. */
export function todayIn(tz: string, now: number = Date.now()): string {
  return dayjs(now).tz(tz).format('YYYY-MM-DD');
}

/** Сдвиг локальной даты на n дней (YYYY-MM-DD, без учёта часового пояса — это календарная дата). */
export function shiftDate(date: string, days: number): string {
  return dayjs(date).add(days, 'day').format('YYYY-MM-DD');
}

/** Момент UTC по локальной дате и времени филиала. */
export function zonedToMs(date: string, time: string, tz: string): number {
  return dayjs.tz(`${date}T${time}`, tz).valueOf();
}
