import { ValidationError } from '../../../shared/kernel/errors';
import {
  addDays,
  addMinutes,
  isIsoDate,
  OpeningHours,
  openingRangesForDate,
  TimeRange,
  toLocalDate,
  toLocalTime,
} from '../../../shared/kernel/time';

/**
 * Время заказа (docs/decisions.md): «как можно скорее» или к определённому времени в часы работы
 * филиала, не раньше чем через deliveryLeadMinutes / pickupLeadMinutes и не дальше maxScheduleDaysAhead дней.
 *
 * - «Как можно скорее» доступно, только когда филиал открыт и заказ успевают приготовить до закрытия
 *   (сейчас + время приготовления ≤ закрытие).
 * - Заказ ко времени: момент внутри интервала работы, не раньше открытия + время приготовления
 *   (кухня не начинает до открытия) и не раньше «сейчас + время приготовления».
 * - Слоты витрины — с шагом 15 минут.
 */
export const SLOT_STEP_MINUTES = 15;

export interface ScheduleRules {
  openingHours: OpeningHours;
  timezone: string;
  leadMinutes: number;
  maxScheduleDaysAhead: number;
}

export interface AsapAvailability {
  available: boolean;
  /** Почему недоступно: филиал закрыт или до закрытия не успеть. */
  reason: 'closed' | 'closing_soon' | null;
  /** Когда заказ будет готов к выдаче/доставке при оформлении сейчас. */
  readyAt: Date | null;
}

const STEP_MS = SLOT_STEP_MINUTES * 60_000;

function ceilToStep(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / STEP_MS) * STEP_MS);
}

function currentRanges(rules: ScheduleRules, at: Date): TimeRange[] {
  return openingRangesForDate(rules.openingHours, toLocalDate(at, rules.timezone), rules.timezone);
}

export function asapAvailability(rules: ScheduleRules, now: Date): AsapAvailability {
  const open = currentRanges(rules, now).filter((r) => r.contains(now));
  if (open.length === 0) return { available: false, reason: 'closed', readyAt: null };
  const readyAt = addMinutes(now, rules.leadMinutes);
  if (!open.some((r) => readyAt.getTime() <= r.end.getTime())) {
    return { available: false, reason: 'closing_soon', readyAt: null };
  }
  return { available: true, reason: null, readyAt };
}

/** Последняя локальная дата, на которую можно оформить заказ ко времени. */
export function lastSchedulableDate(rules: ScheduleRules, now: Date): string {
  return addDays(toLocalDate(now, rules.timezone), rules.maxScheduleDaysAhead);
}

/** Даты, доступные для заказа ко времени: сегодня … сегодня + maxScheduleDaysAhead. */
export function schedulableDates(rules: ScheduleRules, now: Date): string[] {
  const today = toLocalDate(now, rules.timezone);
  return Array.from({ length: rules.maxScheduleDaysAhead + 1 }, (_, i) => addDays(today, i));
}

function earliestFor(rules: ScheduleRules, range: TimeRange, now: Date): Date {
  const byOpening = addMinutes(range.start, rules.leadMinutes);
  const byNow = addMinutes(now, rules.leadMinutes);
  return byOpening > byNow ? byOpening : byNow;
}

/** Слоты заказа ко времени на локальную дату филиала (шаг 15 минут). */
export function orderSlots(rules: ScheduleRules, now: Date, date: string): Date[] {
  if (!isIsoDate(date)) throw new ValidationError('order.invalid_date', 'Date must be YYYY-MM-DD', { date });
  const today = toLocalDate(now, rules.timezone);
  if (date < today || date > lastSchedulableDate(rules, now)) return [];
  const result = new Map<number, Date>();
  for (const range of openingRangesForDate(rules.openingHours, date, rules.timezone)) {
    for (let t = ceilToStep(earliestFor(rules, range, now)); t.getTime() <= range.end.getTime(); t = addMinutes(t, SLOT_STEP_MINUTES)) {
      if (toLocalDate(t, rules.timezone) === date) result.set(t.getTime(), t);
    }
  }
  return [...result.values()].sort((a, b) => a.getTime() - b.getTime());
}

/** Проверка времени заказа «ко времени». Бросает ValidationError с машинным кодом. */
export function assertSchedulable(rules: ScheduleRules, now: Date, at: Date): void {
  const earliest = addMinutes(now, rules.leadMinutes);
  if (at.getTime() < earliest.getTime()) {
    throw new ValidationError('order.schedule_too_early', 'Scheduled time is earlier than the preparation time allows', {
      earliest: earliest.toISOString(),
      leadMinutes: rules.leadMinutes,
    });
  }
  const localDate = toLocalDate(at, rules.timezone);
  if (localDate > lastSchedulableDate(rules, now)) {
    throw new ValidationError('order.schedule_too_far', 'Scheduled time is too far ahead', {
      maxScheduleDaysAhead: rules.maxScheduleDaysAhead,
    });
  }
  const fits = openingRangesForDate(rules.openingHours, localDate, rules.timezone).some(
    (r) => at.getTime() >= earliestFor(rules, r, now).getTime() && at.getTime() <= r.end.getTime(),
  );
  if (!fits) {
    throw new ValidationError('order.schedule_outside_hours', 'Scheduled time is outside the branch opening hours', {
      date: localDate,
      time: toLocalTime(at, rules.timezone),
    });
  }
}

/** Проверка «как можно скорее». */
export function assertAsapAvailable(rules: ScheduleRules, now: Date): Date {
  const asap = asapAvailability(rules, now);
  if (!asap.available || !asap.readyAt) {
    throw new ValidationError(
      asap.reason === 'closing_soon' ? 'order.asap_closing_soon' : 'order.branch_closed',
      'The branch cannot accept an ASAP order now, choose a time',
      { reason: asap.reason },
    );
  }
  return asap.readyAt;
}

/**
 * Обещанное время: для заказа ко времени — это время; для «как можно скорее» — момент отсчёта
 * (оформление или принятие) + ориентировочная длительность.
 */
export function promisedTime(input: { scheduledFor: Date | null; from: Date; etaMinutes: number; current?: Date | null }): Date {
  if (input.scheduledFor) return input.scheduledFor;
  const candidate = addMinutes(input.from, input.etaMinutes);
  return input.current && input.current.getTime() > candidate.getTime() ? input.current : candidate;
}
