import { ValidationError } from './errors';

/**
 * Переводимые поля: JSONB с ключами языков, а не столбцы name_ru/name_kk.
 * kk и ru — основные языки интерфейса, en — опционально.
 */
export const LOCALES = ['kk', 'ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ru';

/** Порядок подстановки, если перевода на запрошенный язык нет. */
const FALLBACK_ORDER: readonly Locale[] = ['ru', 'kk', 'en'];

export type Translatable = Partial<Record<Locale, string>>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function parseLocale(value: unknown, fallback: Locale = DEFAULT_LOCALE): Locale {
  return isLocale(value) ? value : fallback;
}

/** Нормализует: обрезает пробелы, убирает пустые и неизвестные ключи. */
export function normalizeTranslatable(input: Record<string, unknown> | null | undefined): Translatable {
  const result: Translatable = {};
  if (!input) return result;
  for (const locale of LOCALES) {
    const value = input[locale];
    if (typeof value === 'string' && value.trim().length > 0) {
      result[locale] = value.trim();
    }
  }
  return result;
}

/**
 * Проверяет, что заполнен хотя бы один из основных языков (ru или kk).
 * Недостающий перевод не блокирует сохранение — админка подсвечивает пропуски.
 */
export function assertTranslatable(value: Translatable, field: string): Translatable {
  const normalized = normalizeTranslatable(value as Record<string, unknown>);
  if (!normalized.ru && !normalized.kk) {
    throw new ValidationError('translatable.required', `Field ${field} must have ru or kk text`, { field });
  }
  return normalized;
}

export function translate(value: Translatable | null | undefined, locale: Locale): string {
  if (!value) return '';
  const direct = value[locale];
  if (direct) return direct;
  for (const fallback of FALLBACK_ORDER) {
    const text = value[fallback];
    if (text) return text;
  }
  return '';
}

export function missingLocales(value: Translatable, required: readonly Locale[] = ['kk', 'ru']): Locale[] {
  return required.filter((l) => !value[l]);
}
