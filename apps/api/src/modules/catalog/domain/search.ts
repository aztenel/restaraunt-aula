/**
 * Поиск по меню: полнотекстовый поиск PostgreSQL (ru — конфигурация 'russian' со стеммингом,
 * kk/en — 'simple') плюс pg_trgm по названиям для частичных совпадений («бешб» -> «Бешбармак»).
 * Здесь — чистая подготовка запроса; SQL — в репозитории.
 */
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;
const MAX_TOKENS = 8;

/** Нормализация строки запроса: пробелы, длина. null — искать нечего. */
export function normalizeSearchQuery(raw: string | null | undefined): string | null {
  const q = (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX_LENGTH).trim();
  return q.length >= SEARCH_MIN_LENGTH ? q : null;
}

/** Слова запроса (буквы и цифры любого алфавита), в нижнем регистре. */
export function searchTokens(q: string): string[] {
  return (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_TOKENS);
}

/** Префиксный tsquery для набора по мере ввода: 'бешб:* & казах:*'. null — нет слов. */
export function prefixTsQuery(q: string): string | null {
  const tokens = searchTokens(q);
  return tokens.length > 0 ? tokens.map((t) => `${t}:*`).join(' & ') : null;
}

/** Экранирование для LIKE/ILIKE: % _ \. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Подстрока для поиска по названиям (pg_trgm-индекс поддерживает LIKE '%...%'). */
export function containsPattern(q: string): string {
  return `%${escapeLike(q.toLowerCase())}%`;
}
