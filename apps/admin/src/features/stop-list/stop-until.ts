/**
 * Стоп-лист «до»: быстрые варианты для планшета на точке и подпись срока стопа.
 * Сервер (SetDishAvailability) сам считает «до конца дня» по часовому поясу филиала (untilEndOfDay)
 * и проверяет, что «до» в будущем и не дальше 30 дней; здесь — только выбор и подсказка до отправки.
 */
import { dayjs, DISPLAY_TIMEZONE } from '@/shared/lib/dates';

export const STOP_PRESETS = ['end_of_day', 'hour_1', 'hour_2', 'manual', 'custom'] as const;
export type StopPreset = (typeof STOP_PRESETS)[number];

/** Как на сервере (MAX_STOP_DAYS): дальше — только бессрочный стоп до ручного возврата. */
export const MAX_STOP_DAYS = 30;

/** Поля запроса PUT .../availability для стопа. */
export interface StopUntilPayload {
  until: string | null;
  untilEndOfDay?: boolean;
}

export type StopUntilError = 'custom_required' | 'past' | 'too_far';

export type StopUntilResult = { ok: true; payload: StopUntilPayload } | { ok: false; error: StopUntilError };

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export function resolveStopUntil(preset: StopPreset, now: Date, custom?: Date | null): StopUntilResult {
  switch (preset) {
    case 'end_of_day':
      return { ok: true, payload: { until: null, untilEndOfDay: true } };
    case 'hour_1':
      return { ok: true, payload: { until: new Date(now.getTime() + HOUR_MS).toISOString() } };
    case 'hour_2':
      return { ok: true, payload: { until: new Date(now.getTime() + 2 * HOUR_MS).toISOString() } };
    case 'manual':
      return { ok: true, payload: { until: null } };
    case 'custom': {
      if (!custom || Number.isNaN(custom.getTime())) return { ok: false, error: 'custom_required' };
      if (custom.getTime() <= now.getTime()) return { ok: false, error: 'past' };
      if (custom.getTime() > now.getTime() + MAX_STOP_DAYS * DAY_MS) return { ok: false, error: 'too_far' };
      return { ok: true, payload: { until: custom.toISOString() } };
    }
  }
}

export type UntilDescription =
  | { kind: 'manual' }
  | { kind: 'expired' }
  | { kind: 'end_of_day' }
  | { kind: 'today'; time: string }
  | { kind: 'date'; date: string };

/**
 * Подпись срока стопа: «до ручного возврата», «до конца дня» (ближайшая полночь филиала),
 * «до 18:30» (сегодня) или «до 27.09 12:00».
 */
export function describeUntil(until: string | null | undefined, now: Date, timeZone: string = DISPLAY_TIMEZONE): UntilDescription {
  if (!until) return { kind: 'manual' };
  const moment = dayjs(until);
  if (!moment.isValid()) return { kind: 'manual' };
  if (moment.valueOf() <= now.getTime()) return { kind: 'expired' };
  const local = moment.tz(timeZone);
  const today = dayjs(now).tz(timeZone);
  const nextMidnight = dayjs.tz(today.format('YYYY-MM-DD'), timeZone).add(1, 'day');
  if (local.valueOf() === nextMidnight.valueOf()) return { kind: 'end_of_day' };
  if (local.format('YYYY-MM-DD') === today.format('YYYY-MM-DD')) return { kind: 'today', time: local.format('HH:mm') };
  return { kind: 'date', date: local.format('DD.MM HH:mm') };
}
