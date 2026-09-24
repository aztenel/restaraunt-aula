import { Locale, Translatable } from '../../../shared/kernel/translatable';

/**
 * Полнота переводов (решение №10): контент kk/ru, каждое поле переводимое. Обязателен хотя бы один
 * из kk/ru, недостающий перевод подсвечивается в админке, витрина показывает запасной язык.
 *
 * Правило отчёта: обязательное поле (название, заголовок) — нужен текст на всех проверяемых языках;
 * необязательное поле (описание, SEO) проверяется, только если заполнено хотя бы на одном языке.
 */
export const REQUIRED_LOCALES: readonly Locale[] = ['kk', 'ru'];

export interface TranslatableField {
  field: string;
  value: Translatable | null | undefined;
  required: boolean;
}

export interface MissingTranslation {
  field: string;
  missing: Locale[];
}

export function missingTranslations(fields: readonly TranslatableField[], locales: readonly Locale[] = REQUIRED_LOCALES): MissingTranslation[] {
  const result: MissingTranslation[] = [];
  for (const { field, value, required } of fields) {
    const v = value ?? {};
    const filled = Object.values(v).some((text) => typeof text === 'string' && text.trim().length > 0);
    if (!required && !filled) continue;
    const missing = locales.filter((l) => !(v[l] && v[l]!.trim().length > 0));
    if (missing.length > 0) result.push({ field, missing });
  }
  return result;
}
