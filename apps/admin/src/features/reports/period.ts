/**
 * Отчётный период — локальные даты Asia/Almaty (включительно с обеих сторон), как на сервере
 * (reporting/domain/period.ts). Быстрые периоды считаются от «сегодня» в Алматы, а не в часовом поясе
 * компьютера сотрудника. Период не длиннее 366 дней.
 */
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

export const REPORTING_TIMEZONE = 'Asia/Almaty';
export const MAX_PERIOD_DAYS = 366;

export const PERIOD_PRESETS = ['today', 'yesterday', 'last7', 'last30', 'thisMonth', 'prevMonth'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export interface Period {
  /** YYYY-MM-DD */
  from: string;
  to: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Сегодня в Алматы. */
export function reportingToday(now: number = Date.now(), tz = REPORTING_TIMEZONE): string {
  return dayjs(now).tz(tz).format('YYYY-MM-DD');
}

/** Сдвиг календарной даты (без часовых поясов). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** Быстрый период → даты. */
export function presetPeriod(preset: PeriodPreset, now: number = Date.now(), tz = REPORTING_TIMEZONE): Period {
  const today = reportingToday(now, tz);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'thisMonth':
      return { from: monthStart(today), to: today };
    case 'prevMonth': {
      const lastOfPrev = addDays(monthStart(today), -1);
      return { from: monthStart(lastOfPrev), to: lastOfPrev };
    }
  }
}

/** Какой быстрый период соответствует датам (для подсветки кнопки); null — свой период. */
export function detectPreset(period: Period, now: number = Date.now(), tz = REPORTING_TIMEZONE): PeriodPreset | null {
  for (const preset of PERIOD_PRESETS) {
    const p = presetPeriod(preset, now, tz);
    if (p.from === period.from && p.to === period.to) return preset;
  }
  return null;
}

export function periodDays(period: Period): number {
  return Math.round((Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000) + 1;
}

export type PeriodIssue = 'invalid_date' | 'invalid_period' | 'period_too_long';

/** Проверка периода теми же правилами, что на сервере (report.invalid_period, report.period_too_long). */
export function periodIssue(period: Period): PeriodIssue | null {
  if (!DATE_RE.test(period.from) || !DATE_RE.test(period.to)) return 'invalid_date';
  if (period.from > period.to) return 'invalid_period';
  if (periodDays(period) > MAX_PERIOD_DAYS) return 'period_too_long';
  return null;
}

/** Период из адреса (?from=&to=) или по умолчанию — последние 30 дней. */
export function periodFromParams(params: URLSearchParams, now: number = Date.now()): Period {
  const from = params.get('from');
  const to = params.get('to');
  if (from && to && periodIssue({ from, to }) === null) return { from, to };
  return presetPeriod('last30', now);
}

/** Месяцы периода 'YYYY-MM' (для помесячных итогов агрегаторов). */
export function monthsOf(period: Period): { fromMonth: string; toMonth: string } {
  return { fromMonth: period.from.slice(0, 7), toMonth: period.to.slice(0, 7) };
}

/** Короткая подпись дня для оси: '2026-09-05' → '05.09'. */
export function shortDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`;
}
