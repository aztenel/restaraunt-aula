import type { TFunction } from 'i18next';

/**
 * Перевод по динамическому ключу (статусы, коды, разделы), когда ключ неизвестен на этапе
 * компиляции. fallback — если перевода нет.
 */
export function tx(t: TFunction, key: string, fallback?: string, options?: Record<string, unknown>): string {
  const translate = t as unknown as (k: string, o?: Record<string, unknown>) => string;
  return translate(key, { defaultValue: fallback ?? key, ...options });
}
