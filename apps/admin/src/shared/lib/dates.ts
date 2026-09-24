/**
 * Даты в админке: сервер хранит UTC, показываем в часовом поясе филиалов (Asia/Almaty).
 */
import dayjs, { type Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

export const DISPLAY_TIMEZONE = 'Asia/Almaty';

export function toDisplay(value: string | Date | null | undefined): Dayjs | null {
  if (!value) return null;
  const d = dayjs(value);
  return d.isValid() ? d.tz(DISPLAY_TIMEZONE) : null;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  return toDisplay(value)?.format('DD.MM.YYYY HH:mm') ?? '—';
}

export function formatDateTimeSeconds(value: string | Date | null | undefined): string {
  return toDisplay(value)?.format('DD.MM.YYYY HH:mm:ss') ?? '—';
}

export function formatDate(value: string | Date | null | undefined): string {
  return toDisplay(value)?.format('DD.MM.YYYY') ?? '—';
}

/** Начало локального дня (Asia/Almaty) → ISO UTC для фильтров API (from включительно). */
export function startOfLocalDayIso(day: Dayjs): string {
  return dayjs.tz(day.format('YYYY-MM-DD'), DISPLAY_TIMEZONE).startOf('day').toISOString();
}

/** Начало следующего локального дня → ISO UTC (to — не включительно). */
export function endOfLocalDayExclusiveIso(day: Dayjs): string {
  return dayjs.tz(day.format('YYYY-MM-DD'), DISPLAY_TIMEZONE).add(1, 'day').startOf('day').toISOString();
}

export { dayjs };
