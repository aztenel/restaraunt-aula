/**
 * Редактирование часов работы филиала: { mon: [{ open: '10:00', close: '23:00' }], ... }.
 * Интервал может переходить через полночь (close раньше open: 18:00–02:00).
 * Проверки дублируют серверные (формат HH:mm, open ≠ close) + подсказка о пересечениях.
 */
import { WEEKDAYS, type OpeningHours, type OpeningInterval, type Weekday } from '@aula/api-client';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(value: string | undefined | null): value is string {
  return typeof value === 'string' && HH_MM.test(value);
}

/** Переходит через полночь (закрытие ровно в 00:00 — просто «до полуночи»). */
export function isOvernight(interval: OpeningInterval): boolean {
  return interval.close !== '00:00' && interval.close < interval.open;
}

function minutes(value: string): number {
  const [h, m] = value.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** Интервал в минутах от начала дня; конец после полуночи — > 1440. */
function span(interval: OpeningInterval): [number, number] {
  const start = minutes(interval.open);
  let end = minutes(interval.close);
  if (end <= start) end += 24 * 60;
  return [start, end];
}

export type HoursIssue = 'invalid_time' | 'same_time' | 'overlap';

/** Проблемы по дням (пустой объект — всё корректно). */
export function validateOpeningHours(hours: OpeningHours): Partial<Record<Weekday, HoursIssue[]>> {
  const result: Partial<Record<Weekday, HoursIssue[]>> = {};
  for (const day of WEEKDAYS) {
    const intervals = hours[day] ?? [];
    const issues = new Set<HoursIssue>();
    for (const interval of intervals) {
      if (!isValidTime(interval.open) || !isValidTime(interval.close)) issues.add('invalid_time');
      else if (interval.open === interval.close) issues.add('same_time');
    }
    const valid = intervals.filter((i) => isValidTime(i.open) && isValidTime(i.close) && i.open !== i.close).map(span).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < valid.length; i++) {
      if (valid[i]![0] < valid[i - 1]![1]) issues.add('overlap');
    }
    if (issues.size > 0) result[day] = [...issues];
  }
  return result;
}

/** Копировать часы дня на все дни недели. */
export function copyDayToAll(hours: OpeningHours, day: Weekday): OpeningHours {
  const source = hours[day] ?? [];
  return Object.fromEntries(WEEKDAYS.map((d) => [d, source.map((i) => ({ ...i }))])) as OpeningHours;
}

/** Для отправки: только заполненные корректные интервалы, пустые дни — пустой массив (выходной). */
export function cleanOpeningHours(hours: OpeningHours): OpeningHours {
  return Object.fromEntries(
    WEEKDAYS.map((day) => [
      day,
      (hours[day] ?? []).filter((i) => isValidTime(i.open) && isValidTime(i.close) && i.open !== i.close).map((i) => ({ open: i.open, close: i.close })),
    ]),
  ) as OpeningHours;
}
