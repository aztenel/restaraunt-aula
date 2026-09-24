/**
 * Конфигурация витрины из окружения.
 * Серверные значения читаются в рантайме (страницы рендерятся на сервере по запросу),
 * NEXT_PUBLIC_* встраиваются в клиентский код при сборке.
 */

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Публичный адрес сайта: canonical, hreflang, sitemap, OpenGraph. */
export function getSiteUrl(): string {
  return trimSlash(process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001');
}

/** API для серверного рендеринга: внутренний адрес в сети контейнеров, иначе публичный. */
export function getServerApiUrl(): string {
  return trimSlash(process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000');
}

/** API для браузера. Пустая строка — тот же origin (reverse proxy отдаёт /api/* на API). */
export function getBrowserApiUrl(): string {
  return trimSlash(process.env.NEXT_PUBLIC_API_URL ?? '');
}

/** Кэш данных витрины (меню, филиалы, контент) — секунд. */
export const CONTENT_REVALIDATE_SECONDS = 60;
