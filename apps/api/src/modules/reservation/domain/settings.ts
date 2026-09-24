import { ValidationError } from '../../../shared/kernel/errors';
import { normalizeTranslatable, Translatable } from '../../../shared/kernel/translatable';

/**
 * Настройки бронирования филиала (принадлежат модулю Reservation; общие настройки точки —
 * приём броней, подтверждение телефона — в Identity.BranchSettings).
 */
export interface ReservationSettings {
  /** За сколько часов до начала напомнить гостю (0 — не напоминать). */
  reminderHoursBefore: number;
  /** Бронь на витрине — не раньше чем через N минут от текущего момента. */
  minLeadMinutes: number;
  /** На сколько дней вперёд можно бронировать на витрине. */
  maxDaysAhead: number;
  /** Текст правил брони и отмены для гостя (kk/ru/en). */
  policyText: Translatable;
}

export const DEFAULT_RESERVATION_SETTINGS: ReservationSettings = {
  reminderHoursBefore: 3,
  minLeadMinutes: 60,
  maxDaysAhead: 60,
  policyText: {},
};

const LIMITS = {
  reminderHoursBefore: [0, 72],
  minLeadMinutes: [0, 10_080],
  maxDaysAhead: [1, 365],
} as const;

export function validateSettings(settings: ReservationSettings): ReservationSettings {
  for (const [key, [min, max]] of Object.entries(LIMITS) as Array<[keyof typeof LIMITS, readonly [number, number]]>) {
    const value = settings[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new ValidationError('reservation.invalid_setting', `Setting ${key} must be an integer in [${min}, ${max}]`, { key, min, max, value });
    }
  }
  return { ...settings, policyText: normalizeTranslatable(settings.policyText as Record<string, unknown>) };
}

export function mergeSettings(current: ReservationSettings, patch: Partial<ReservationSettings>): ReservationSettings {
  const next: ReservationSettings = { ...current };
  for (const key of Object.keys(DEFAULT_RESERVATION_SETTINGS) as Array<keyof ReservationSettings>) {
    const value = patch[key];
    if (value !== undefined && value !== null) (next as unknown as Record<string, unknown>)[key] = value;
  }
  return validateSettings(next);
}
