import { ValidationError } from '../../../shared/kernel/errors';

/**
 * Правила брони места. Значения по умолчанию задаёт тип места (справочник), место может
 * переопределить любое правило (например, у одного VIP-зала дедлайн отмены 48 часов вместо 24).
 */
export interface VenueRules {
  /** Длительность брони по умолчанию, минут. */
  durationMinutes: number;
  /** Сколько держится неподтверждённая / неоплаченная бронь, минут. */
  holdMinutes: number;
  /** За сколько часов до начала можно отменить с возвратом депозита. */
  cancellationDeadlineHours: number;
  /** Бронь с витрины ждёт подтверждения персоналом (pending). */
  requiresManualConfirmation: boolean;
  /** Буфер на уборку после брони, минут: место занято в [начало, конец + буфер). */
  cleanupMinutes: number;
  /** Шаг сетки времени для подбора альтернатив, минут. */
  slotStepMinutes: number;
  /** Место можно забронировать на витрине (иначе — только через оператора). */
  bookableOnline: boolean;
}

export type VenueRuleOverrides = Partial<VenueRules>;

type NumericRule = 'durationMinutes' | 'holdMinutes' | 'cancellationDeadlineHours' | 'cleanupMinutes' | 'slotStepMinutes';
type BooleanRule = 'requiresManualConfirmation' | 'bookableOnline';

/** Допустимые диапазоны правил (совпадают с CHECK-ограничениями таблицы типов мест). */
export const RULE_LIMITS: Record<NumericRule, readonly [number, number]> = {
  durationMinutes: [15, 1440],
  holdMinutes: [1, 10080],
  cancellationDeadlineHours: [0, 720],
  cleanupMinutes: [0, 720],
  slotStepMinutes: [5, 240],
};

const NUMERIC_RULES = Object.keys(RULE_LIMITS) as NumericRule[];
const BOOLEAN_RULES: readonly BooleanRule[] = ['requiresManualConfirmation', 'bookableOnline'];
export const RULE_KEYS: ReadonlyArray<keyof VenueRules> = [...NUMERIC_RULES, ...BOOLEAN_RULES];

function assertNumericRule(key: NumericRule, value: unknown): number {
  const [min, max] = RULE_LIMITS[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError('reservation.invalid_rule', `Rule ${key} must be an integer in [${min}, ${max}]`, { key, min, max, value });
  }
  return value;
}

function assertBooleanRule(key: BooleanRule, value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError('reservation.invalid_rule', `Rule ${key} must be boolean`, { key, value });
  }
  return value;
}

/** Полный набор правил (правила типа места по умолчанию). */
export function validateRules(rules: VenueRules): VenueRules {
  const result = {} as VenueRules;
  for (const key of NUMERIC_RULES) result[key] = assertNumericRule(key, rules[key]);
  for (const key of BOOLEAN_RULES) result[key] = assertBooleanRule(key, rules[key]);
  return result;
}

/** Переопределения места: только известные ключи, null/undefined — «как у типа». */
export function validateOverrides(overrides: Record<string, unknown> | null | undefined): VenueRuleOverrides {
  const result: VenueRuleOverrides = {};
  if (!overrides) return result;
  for (const key of Object.keys(overrides)) {
    if (!(RULE_KEYS as readonly string[]).includes(key)) {
      throw new ValidationError('reservation.unknown_rule', `Unknown rule ${key}`, { key });
    }
  }
  for (const key of NUMERIC_RULES) {
    const value = overrides[key];
    if (value !== undefined && value !== null) result[key] = assertNumericRule(key, value);
  }
  for (const key of BOOLEAN_RULES) {
    const value = overrides[key];
    if (value !== undefined && value !== null) result[key] = assertBooleanRule(key, value);
  }
  return result;
}

/** Действующие правила места: правила типа + переопределения места. */
export function effectiveRules(typeDefaults: VenueRules, overrides: VenueRuleOverrides): VenueRules {
  const result: VenueRules = { ...typeDefaults };
  for (const key of RULE_KEYS) {
    const value = overrides[key];
    if (value !== undefined) (result as unknown as Record<string, unknown>)[key] = value;
  }
  return result;
}
