import { ValidationError } from '../../../shared/kernel/errors';
import { DEFAULT_CURRENCY, Money } from '../../../shared/kernel/money';
import { assertTranslatable, LOCALES, normalizeTranslatable, Translatable } from '../../../shared/kernel/translatable';
import { AllergenCode, normalizeAllergens } from './allergens';

/**
 * Правила карточки блюда. Цена НЕ хранится в блюде (инвариант ТЗ) — она в меню филиала.
 */
export const SPICY_LEVELS = [0, 1, 2, 3] as const;
export type SpicyLevel = (typeof SPICY_LEVELS)[number];

export const TEXT_LIMITS = {
  name: 200,
  description: 4000,
  composition: 2000,
  seoTitle: 120,
  seoDescription: 320,
  stopReason: 500,
} as const;

/** Верхняя граница цены позиции меню (защита от опечатки в тиынах): 10 млн ₸. */
export const MAX_MENU_PRICE_TIYN = 1_000_000_000;

const SKU_RE = /^[\p{L}\p{N}._:/-]{1,64}$/u;

/** Длина переводимого поля по каждому языку. */
export function assertTextLimit(value: Translatable, max: number, field: string): Translatable {
  for (const locale of LOCALES) {
    const text = value[locale];
    if (text && text.length > max) {
      throw new ValidationError('catalog.text_too_long', `${field}.${locale} is longer than ${max} characters`, { field, locale, max });
    }
  }
  return value;
}

/** Обязательное переводимое поле: хотя бы ru или kk (недостающий перевод подсвечивает отчёт в админке). */
export function requiredText(value: Translatable | null | undefined, max: number, field: string): Translatable {
  return assertTextLimit(assertTranslatable(value ?? {}, field), max, field);
}

/** Необязательное переводимое поле: пустые языки убираются. */
export function optionalText(value: Translatable | null | undefined, max: number, field: string): Translatable {
  return assertTextLimit(normalizeTranslatable((value ?? {}) as Record<string, unknown>), max, field);
}

export function normalizeSku(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const sku = value.trim();
  if (sku === '') return null;
  if (!SKU_RE.test(sku)) {
    throw new ValidationError('catalog.invalid_sku', 'SKU: 1-64 letters, digits and . _ : / -', { sku: value });
  }
  return sku;
}

function optionalInt(value: number | null | undefined, min: number, max: number, code: string, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(code, `${field} must be an integer ${min}..${max}`, { field, value });
  }
  return value;
}

export interface DishAttributesInput {
  weightGrams?: number | null;
  calories?: number | null;
  spicyLevel?: number | null;
  isVegetarian?: boolean | null;
  isHalal?: boolean | null;
  allergens?: string[] | null;
}

export interface DishAttributes {
  weightGrams: number | null;
  calories: number | null;
  spicyLevel: SpicyLevel;
  isVegetarian: boolean;
  isHalal: boolean;
  allergens: AllergenCode[];
}

/**
 * Атрибуты блюда: вес (г), калорийность (ккал на порцию), острота 0..3, вегетарианское,
 * халал (по умолчанию да — сеть сертифицирована халал), аллергены.
 */
export function validateDishAttributes(input: DishAttributesInput, current?: DishAttributes | null): DishAttributes {
  const spicy = input.spicyLevel ?? current?.spicyLevel ?? 0;
  if (!(SPICY_LEVELS as readonly number[]).includes(spicy)) {
    throw new ValidationError('catalog.invalid_spicy_level', 'Spicy level must be 0..3', { spicyLevel: spicy });
  }
  return {
    weightGrams: optionalInt(
      input.weightGrams === undefined ? current?.weightGrams : input.weightGrams,
      1,
      100_000,
      'catalog.invalid_weight',
      'weightGrams',
    ),
    calories: optionalInt(input.calories === undefined ? current?.calories : input.calories, 0, 20_000, 'catalog.invalid_calories', 'calories'),
    spicyLevel: spicy as SpicyLevel,
    isVegetarian: input.isVegetarian ?? current?.isVegetarian ?? false,
    isHalal: input.isHalal ?? current?.isHalal ?? true,
    allergens: input.allergens === undefined || input.allergens === null ? (current?.allergens ?? []) : normalizeAllergens(input.allergens),
  };
}

/** Цена позиции меню филиала: целые тиыны, не отрицательная, в тенге, в разумных пределах. */
export function assertMenuPrice(price: Money): Money {
  if (price.currency !== DEFAULT_CURRENCY) {
    throw new ValidationError('catalog.invalid_price', 'Only KZT prices are supported', { currency: price.currency });
  }
  if (price.isNegative() || price.amount > MAX_MENU_PRICE_TIYN) {
    throw new ValidationError('catalog.invalid_price', 'Price must be between 0 and 10 000 000 KZT', { amount: price.amount });
  }
  return price;
}
