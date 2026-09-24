/**
 * Языки и переводимые поля. Контент хранится как { kk, ru, en } (en — опционально).
 * Если перевода на запрошенный язык нет, показывается запасной: ru → kk → en (как на сервере).
 */
export const LOCALES = ['kk', 'ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ru';

/** Обязательные языки контента: хотя бы один из них должен быть заполнен, недостающий подсвечивается. */
export const REQUIRED_CONTENT_LOCALES: readonly Locale[] = ['kk', 'ru'];

const FALLBACK_ORDER: readonly Locale[] = ['ru', 'kk', 'en'];

export type Translatable = Partial<Record<Locale, string>>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Текст переводимого поля на нужном языке с запасным вариантом. */
export function translate(value: Translatable | null | undefined, locale: Locale | string): string {
  if (!value) return '';
  const direct = isLocale(locale) ? value[locale] : undefined;
  if (direct) return direct;
  for (const fallback of FALLBACK_ORDER) {
    const text = value[fallback];
    if (text) return text;
  }
  return '';
}

/** Какие из обязательных языков не заполнены (для подсветки в админке). */
export function missingLocales(value: Translatable | null | undefined, required: readonly Locale[] = REQUIRED_CONTENT_LOCALES): Locale[] {
  return required.filter((locale) => !value?.[locale]?.trim());
}
