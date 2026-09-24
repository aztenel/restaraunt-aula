import { ValidationError } from '../../../shared/kernel/errors';
import { addDays, DEFAULT_TIMEZONE, isIsoDate, toLocalDate, Weekday, WEEKDAYS } from '../../../shared/kernel/time';

/**
 * Отчётный период — локальные даты Asia/Almaty (включительно с обеих сторон).
 * Время в БД — UTC; дата факта считается один раз при построении проекции.
 */
export const REPORTING_TIMEZONE = DEFAULT_TIMEZONE;

/** Максимальная длина периода отчёта, дней. */
export const MAX_PERIOD_DAYS = 366;

/** Период по умолчанию, дней (если from/to не заданы). */
export const DEFAULT_PERIOD_DAYS = 30;

export interface ReportPeriod {
  from: string;
  to: string;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Локальная дата (Asia/Almaty) момента времени. */
export function localDateOf(at: Date): string {
  return toLocalDate(at, REPORTING_TIMEZONE);
}

/** Количество дней между датами (to - from). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Период отчёта из параметров запроса. Не задано to — сегодня; не задано from — defaultDays дней до to.
 * Ошибки: report.invalid_date, report.invalid_period (from > to), report.period_too_long.
 */
export function reportPeriod(
  input: { from?: string | null; to?: string | null },
  today: string,
  options: { defaultDays?: number; maxDays?: number } = {},
): ReportPeriod {
  const defaultDays = options.defaultDays ?? DEFAULT_PERIOD_DAYS;
  const maxDays = options.maxDays ?? MAX_PERIOD_DAYS;
  for (const [field, value] of [
    ['from', input.from],
    ['to', input.to],
  ] as const) {
    if (value !== undefined && value !== null && !isIsoDate(value)) {
      throw new ValidationError('report.invalid_date', `${field} must be a date YYYY-MM-DD`, { field, value });
    }
  }
  const to = input.to ?? (input.from ? maxDate(input.from, today) : today);
  const from = input.from ?? addDays(to, -(defaultDays - 1));
  if (from > to) {
    throw new ValidationError('report.invalid_period', 'Period start must not be after its end', { from, to });
  }
  if (daysBetween(from, to) + 1 > maxDays) {
    throw new ValidationError('report.period_too_long', `Period must not exceed ${maxDays} days`, { from, to, maxDays });
  }
  return { from, to };
}

function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** Все даты периода по порядку. */
export function datesOf(period: ReportPeriod): string[] {
  const result: string[] = [];
  for (let d = period.from; d <= period.to; d = addDays(d, 1)) result.push(d);
  return result;
}

export function periodLength(period: ReportPeriod): number {
  return daysBetween(period.from, period.to) + 1;
}

/** День недели календарной даты (не зависит от часового пояса). */
export function weekdayOfDate(date: string): Weekday {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = воскресенье
  return WEEKDAYS[(day + 6) % 7]!;
}

export function isMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH_RE.test(value);
}

/** 'YYYY-MM' даты. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Первый день месяца 'YYYY-MM-01'. */
export function monthStart(month: string): string {
  if (!isMonth(month)) throw new ValidationError('report.invalid_month', 'Month must be YYYY-MM', { month });
  return `${month}-01`;
}

/** Период календарного месяца. */
export function monthPeriod(month: string): ReportPeriod {
  const from = monthStart(month);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { from, to: addDays(next, -1) };
}

/** Месяцы, пересекающие период, по порядку. */
export function monthsOf(period: ReportPeriod): string[] {
  const months: string[] = [];
  let month = monthOf(period.from);
  const last = monthOf(period.to);
  while (month <= last) {
    months.push(month);
    month = monthOf(addDays(monthPeriod(month).to, 1));
  }
  return months;
}
