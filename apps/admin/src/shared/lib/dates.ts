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

/**
 * ISO UTC → значение для DatePicker/TimePicker: «стенные часы» Asia/Almaty как локальный Dayjs
 * (чтобы выбор времени не зависел от часового пояса компьютера сотрудника).
 */
export function isoToPickerValue(value: string | null | undefined): Dayjs | null {
  const local = toDisplay(value);
  return local ? dayjs(local.format('YYYY-MM-DDTHH:mm:ss')) : null;
}

/** Значение DatePicker (стенные часы) → ISO UTC, считая время временем Asia/Almaty. */
export function pickerValueToIso(value: Dayjs | null | undefined): string | null {
  if (!value || !value.isValid()) return null;
  return dayjs.tz(value.format('YYYY-MM-DDTHH:mm:ss'), DISPLAY_TIMEZONE).toISOString();
}

export { dayjs };
