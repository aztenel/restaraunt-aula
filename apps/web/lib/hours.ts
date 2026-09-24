/**
 * Отображение часов работы (не расчёт доступности: «открыто сейчас» считает сервер — isOpenNow).
 */
import { WEEKDAYS, type OpeningHours, type OpeningInterval, type Weekday } from '@aula/api-client';

/** День недели «сейчас» в часовом поясе филиала — только чтобы подсветить строку «Сегодня». */
export function weekdayInTimeZone(date: Date, timeZone: string): Weekday {
  try {
    const short = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone }).format(date).toLowerCase().slice(0, 3);
    return (WEEKDAYS as readonly string[]).includes(short) ? (short as Weekday) : 'mon';
  } catch {
    return WEEKDAYS[(date.getUTCDay() + 6) % 7] ?? 'mon';
  }
}

/** Интервал заканчивается на следующий день (close раньше open, но не ровно в полночь). */
export function endsNextDay(interval: OpeningInterval): boolean {
  return interval.close !== '00:00' && interval.close <= interval.open;
}

export function intervalsFor(hours: OpeningHours | null | undefined, day: Weekday): OpeningInterval[] {
  return (hours?.[day] ?? []).filter((i): i is OpeningInterval => Boolean(i?.open && i?.close));
}

/** «10:00–23:00» (длинное тире между временами). */
export function formatInterval(interval: OpeningInterval): string {
  return `${interval.open}–${interval.close}`;
}
