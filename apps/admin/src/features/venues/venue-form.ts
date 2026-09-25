/**
 * Формы конфигурации залов ⇄ тела запросов API: правила брони типа места (полный набор),
 * переопределения правил у места («как у типа» или своё значение), депозит места (тиыны ⇄ Money),
 * тип места, зал, место, настройки филиала. Границы значений — как у сервера (domain/venue-rules.ts,
 * domain/venue.ts, domain/settings.ts); окончательно всё проверяет сервер.
 */
import type { Money, Translatable } from '@aula/api-client';
import type {
  BooleanRuleKey,
  Hall,
  HallInput,
  HallPatch,
  MoneyInputValue,
  NumericRuleKey,
  ReservationSettings,
  ReservationSettingsInput,
  RuleKey,
  Venue,
  VenueInput,
  VenuePosition,
  VenueRuleOverrides,
  VenueRules,
  VenueShape,
  VenueType,
  VenueTypeInput,
} from './types';

// ---------------------------------------------------------------- правила брони

export const NUMERIC_RULES: readonly NumericRuleKey[] = [
  'durationMinutes',
  'holdMinutes',
  'cancellationDeadlineHours',
  'cleanupMinutes',
  'slotStepMinutes',
];
export const BOOLEAN_RULES: readonly BooleanRuleKey[] = ['requiresManualConfirmation', 'bookableOnline'];
export const RULE_KEYS: readonly RuleKey[] = [...NUMERIC_RULES, ...BOOLEAN_RULES];

/** Допустимые диапазоны (совпадают с RULE_LIMITS на сервере). */
export const RULE_LIMITS: Record<NumericRuleKey, readonly [number, number]> = {
  durationMinutes: [15, 1440],
  holdMinutes: [1, 10080],
  cancellationDeadlineHours: [0, 720],
  cleanupMinutes: [0, 720],
  slotStepMinutes: [5, 240],
};

/** Правила нового типа по умолчанию (стол: 2 часа, удержание 30 минут, отмена за сутки). */
export const DEFAULT_RULES: VenueRules = {
  durationMinutes: 120,
  holdMinutes: 30,
  cancellationDeadlineHours: 24,
  requiresManualConfirmation: false,
  cleanupMinutes: 15,
  slotStepMinutes: 30,
  bookableOnline: true,
};

export function isNumericRule(key: RuleKey): key is NumericRuleKey {
  return (NUMERIC_RULES as readonly string[]).includes(key);
}

export function ruleInRange(key: NumericRuleKey, value: unknown): value is number {
  const [min, max] = RULE_LIMITS[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Полный набор правил (тип места): только известные ключи, числа — целые. */
export function rulesToForm(rules: VenueRules | null | undefined): VenueRules {
  return { ...DEFAULT_RULES, ...(rules ?? {}) };
}

export function formToRules(values: Partial<VenueRules>): VenueRules {
  const result = { ...DEFAULT_RULES };
  for (const key of NUMERIC_RULES) {
    const value = values[key];
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = Math.round(value);
  }
  for (const key of BOOLEAN_RULES) {
    const value = values[key];
    if (typeof value === 'boolean') result[key] = value;
  }
  return result;
}

/** Правило в форме места: своё значение (custom) или «как у типа» (значение типа только для показа). */
export type OverrideField<K extends RuleKey> = { custom: boolean; value: VenueRules[K] };
export type OverridesFormValues = { [K in RuleKey]: OverrideField<K> };

export function overridesToForm(overrides: VenueRuleOverrides | null | undefined, typeRules: VenueRules): OverridesFormValues {
  const result = {} as Record<RuleKey, OverrideField<RuleKey>>;
  for (const key of RULE_KEYS) {
    const own = overrides?.[key];
    const custom = own !== undefined && own !== null;
    result[key] = { custom, value: (custom ? own : typeRules[key]) as VenueRules[RuleKey] };
  }
  return result as OverridesFormValues;
}

/**
 * Переопределения для PATCH /admin/venues (полная замена): своё значение — число/булево,
 * «как у типа» — null. Если своих правил нет — null (всё как у типа).
 */
export function formToOverrides(form: Partial<Record<RuleKey, Partial<OverrideField<RuleKey>> | undefined>>): VenueRuleOverrides | null {
  const result: Record<string, number | boolean | null> = {};
  let any = false;
  for (const key of RULE_KEYS) {
    const field = form[key];
    const value = field?.value;
    if (field?.custom && value !== undefined && value !== null) {
      result[key] = isNumericRule(key) ? Math.round(value as number) : Boolean(value);
      any = true;
    } else {
      result[key] = null;
    }
  }
  return any ? (result as VenueRuleOverrides) : null;
}

/** Действующее значение для подсказки в форме (своё или типа) — как показывает сервер в Venue.rules. */
export function effectiveRuleValue<K extends RuleKey>(field: OverrideField<K> | undefined, typeRules: VenueRules, key: K): VenueRules[K] {
  return field?.custom ? field.value : typeRules[key];
}

// ---------------------------------------------------------------- депозит места (тиыны)

export interface DepositFormValues {
  /** У места есть депозит (онлайн-предоплата). */
  depositEnabled: boolean;
  /** Сумма в тиынах (MoneyInput). */
  depositAmount: number | null;
}

export function depositToForm(deposit: Money | null | undefined): DepositFormValues {
  return deposit ? { depositEnabled: true, depositAmount: deposit.amount } : { depositEnabled: false, depositAmount: null };
}

export type DepositIssue = 'deposit_required' | 'deposit_positive';

/** Депозит — положительная сумма или его нет (как на сервере: reservation.invalid_deposit). */
export function depositIssue(values: DepositFormValues): DepositIssue | null {
  if (!values.depositEnabled) return null;
  if (values.depositAmount === null || values.depositAmount === undefined) return 'deposit_required';
  if (!Number.isSafeInteger(values.depositAmount) || values.depositAmount <= 0) return 'deposit_positive';
  return null;
}

/** Тело депозита: тиыны целым числом (без float), валюта — тенге; null — убрать депозит. */
export function formToDeposit(values: DepositFormValues): MoneyInputValue | null {
  if (!values.depositEnabled || depositIssue(values) !== null) return null;
  return { amount: values.depositAmount as number, currency: 'KZT' };
}

// ---------------------------------------------------------------- тип места

export interface VenueTypeFormValues {
  code: string;
  name: Translatable;
  description: Translatable;
  rules: VenueRules;
  sortOrder: number;
  isActive: boolean;
}

export function venueTypeToForm(type: VenueType | null): VenueTypeFormValues {
  return {
    code: type?.code ?? '',
    name: type?.name ?? {},
    description: type?.description ?? {},
    rules: rulesToForm(type?.rules),
    sortOrder: type?.sortOrder ?? 0,
    isActive: type?.isActive ?? true,
  };
}

export function formToVenueTypeInput(values: VenueTypeFormValues): VenueTypeInput {
  return {
    code: values.code.trim().toLowerCase(),
    name: values.name,
    description: values.description ?? null,
    rules: formToRules(values.rules),
    sortOrder: values.sortOrder ?? 0,
    isActive: values.isActive,
  };
}

// ---------------------------------------------------------------- зал

export const PLAN_LIMITS = { min: 100, max: 10_000 } as const;
export const DEFAULT_PLAN = { width: 1000, height: 600 } as const;

export interface HallFormValues {
  code: string;
  name: Translatable;
  description: Translatable;
  planWidth: number;
  planHeight: number;
  sortOrder: number;
  isActive: boolean;
}

export function hallToForm(hall: Hall | null): HallFormValues {
  return {
    code: hall?.code ?? '',
    name: hall?.name ?? {},
    description: hall?.description ?? {},
    planWidth: hall?.planWidth ?? DEFAULT_PLAN.width,
    planHeight: hall?.planHeight ?? DEFAULT_PLAN.height,
    sortOrder: hall?.sortOrder ?? 0,
    isActive: hall?.isActive ?? true,
  };
}

export function formToHallInput(values: HallFormValues, branchId: string): HallInput {
  return { branchId, ...formToHallPatch(values), code: values.code.trim().toLowerCase(), name: values.name };
}

export function formToHallPatch(values: HallFormValues): Required<Pick<HallPatch, 'code' | 'name' | 'planWidth' | 'planHeight' | 'sortOrder' | 'isActive'>> &
  Pick<HallPatch, 'description'> {
  return {
    code: values.code.trim().toLowerCase(),
    name: values.name,
    description: values.description ?? null,
    planWidth: Math.round(values.planWidth),
    planHeight: Math.round(values.planHeight),
    sortOrder: values.sortOrder ?? 0,
    isActive: values.isActive,
  };
}

// ---------------------------------------------------------------- место

export const MAX_VENUE_CAPACITY = 1000;
export const DEFAULT_POSITION: VenuePosition = { x: 0, y: 0, w: 60, h: 60, shape: 'rect', rotation: 0 };

export interface VenueFormValues extends DepositFormValues {
  hallId: string;
  typeId: string;
  code: string;
  name: Translatable;
  description: Translatable;
  capacityMin: number;
  capacityMax: number;
  overrides: OverridesFormValues;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: VenueShape;
  rotation: number;
  sortOrder: number;
  isActive: boolean;
}

export function venueToForm(venue: Venue | null, defaults: { hallId: string; typeId: string; typeRules: VenueRules; position?: VenuePosition }): VenueFormValues {
  const position = venue?.position ?? defaults.position ?? DEFAULT_POSITION;
  return {
    hallId: venue?.hallId ?? defaults.hallId,
    typeId: venue?.typeId ?? defaults.typeId,
    code: venue?.code ?? '',
    name: venue?.name ?? {},
    description: venue?.description ?? {},
    capacityMin: venue?.capacityMin ?? 1,
    capacityMax: venue?.capacityMax ?? 4,
    ...depositToForm(venue?.deposit),
    overrides: overridesToForm(venue?.ruleOverrides, defaults.typeRules),
    x: position.x,
    y: position.y,
    w: position.w,
    h: position.h,
    shape: position.shape,
    rotation: position.rotation,
    sortOrder: venue?.sortOrder ?? 0,
    isActive: venue?.isActive ?? true,
  };
}

export type CapacityIssue = 'capacity_range' | 'capacity_order';

export function capacityIssue(min: number | null | undefined, max: number | null | undefined): CapacityIssue | null {
  const ok = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_VENUE_CAPACITY;
  if (!ok(min) || !ok(max)) return 'capacity_range';
  if (max < min) return 'capacity_order';
  return null;
}

export function formToVenueInput(values: VenueFormValues): VenueInput {
  return {
    hallId: values.hallId,
    typeId: values.typeId,
    code: values.code.trim(),
    name: values.name,
    description: values.description ?? null,
    capacityMin: values.capacityMin,
    capacityMax: values.capacityMax,
    deposit: formToDeposit(values),
    rules: formToOverrides(values.overrides),
    position: {
      x: Math.round(values.x),
      y: Math.round(values.y),
      w: Math.round(values.w),
      h: Math.round(values.h),
      shape: values.shape,
      rotation: Math.round(values.rotation),
    },
    sortOrder: values.sortOrder ?? 0,
    isActive: values.isActive,
  };
}

// ---------------------------------------------------------------- настройки филиала

export const SETTINGS_LIMITS = {
  reminderHoursBefore: [0, 72],
  minLeadMinutes: [0, 10_080],
  maxDaysAhead: [1, 365],
} as const;

export interface SettingsFormValues {
  reminderHoursBefore: number;
  minLeadMinutes: number;
  maxDaysAhead: number;
  policyText: Translatable;
}

export function settingsToForm(settings: ReservationSettings): SettingsFormValues {
  return {
    reminderHoursBefore: settings.reminderHoursBefore,
    minLeadMinutes: settings.minLeadMinutes,
    maxDaysAhead: settings.maxDaysAhead,
    policyText: settings.policyText ?? {},
  };
}

export function formToSettings(values: SettingsFormValues): ReservationSettingsInput {
  return {
    reminderHoursBefore: Math.round(values.reminderHoursBefore),
    minLeadMinutes: Math.round(values.minLeadMinutes),
    maxDaysAhead: Math.round(values.maxDaysAhead),
    policyText: values.policyText ?? {},
  };
}
