import { defineRouting } from 'next-intl/routing';

/**
 * Языки витрины: казахский и русский (основные), английский (опционально).
 * Все URL содержат префикс языка: /ru/..., /kk/..., /en/... — у каждой страницы
 * свой canonical и hreflang-альтернативы (SEO).
 */
export const routing = defineRouting({
  locales: ['kk', 'ru', 'en'],
  defaultLocale: 'ru',
  localePrefix: 'always',
  localeCookie: {
    name: 'NEXT_LOCALE',
    maxAge: 60 * 60 * 24 * 365,
  },
  // hreflang-альтернативы выводятся в <head> каждой страницы (lib/seo.ts), заголовок Link не нужен.
  alternateLinks: false,
});

export type AppLocale = (typeof routing.locales)[number];
