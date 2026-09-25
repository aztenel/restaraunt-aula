/**
 * Поиск и фильтры меню ↔ параметры адреса. Фильтрует СЕРВЕР
 * (GET /api/v1/public/catalog/branches/{slug}/search); витрина только переводит состояние формы
 * в человекочитаемый адрес (?q=&vegetarian=1&halal=1&spicy=1&maxPrice=3000&category=supy&page=2)
 * и адрес — в запрос к API. Цена в адресе — в тенге (как вводит гость), в API — в тиынах
 * (parseTengeToTiyn, без float).
 */
import { formatFixed2ForInput, parseTengeToTiyn } from '@aula/api-client';

/** Острота: любая / только острые (spicy=true) / только неострые (spicy=false). */
export type SpicyFilter = 'any' | 'only' | 'none';

export interface MenuFilters {
  q: string;
  vegetarian: boolean;
  halal: boolean;
  spicy: SpicyFilter;
  /** «До N тенге» — нормализованная строка тенге ('3000', '2500.50') или ''. */
  maxPrice: string;
  /** slug категории или ''. */
  category: string;
  page: number;
}

export const EMPTY_FILTERS: MenuFilters = Object.freeze({
  q: '',
  vegetarian: false,
  halal: false,
  spicy: 'any',
  maxPrice: '',
  category: '',
  page: 1,
}) as MenuFilters;

/** Названия параметров адреса. */
export const FILTER_PARAMS = {
  q: 'q',
  vegetarian: 'vegetarian',
  halal: 'halal',
  spicy: 'spicy',
  maxPrice: 'maxPrice',
  category: 'category',
  page: 'page',
} as const;

export const SEARCH_PER_PAGE = 24;
export const MAX_QUERY_LENGTH = 200;
const MAX_PAGE = 500;
/** Верхняя граница «до N тенге» — 10 млн ₸ (защита от мусора в адресе). */
const MAX_PRICE_TIYN = 10_000_000_00;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type SearchParamsInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | null
  | undefined;

function first(params: SearchParamsInput, key: string): string | undefined {
  if (!params) return undefined;
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function flag(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'on' || value === 'yes';
}

/** Ввод цены (тенге) → тиыны; null — пусто или некорректно. */
export function maxPriceToTiyn(maxPrice: string): number | null {
  if (!maxPrice.trim()) return null;
  const parsed = parseTengeToTiyn(maxPrice, { max: MAX_PRICE_TIYN });
  return parsed.ok && parsed.value > 0 ? parsed.value : null;
}

/** Нормализовать ввод цены: '3 000' → '3000', '2500,5' → '2500.50', мусор → ''. */
export function normalizeMaxPrice(raw: string | undefined): string {
  const tiyn = maxPriceToTiyn(raw ?? '');
  return tiyn === null ? '' : formatFixed2ForInput(tiyn, 'en');
}

export function parseMenuFilters(params: SearchParamsInput): MenuFilters {
  const q = (first(params, FILTER_PARAMS.q) ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
  const spicyRaw = first(params, FILTER_PARAMS.spicy);
  const spicy: SpicyFilter = spicyRaw === undefined || spicyRaw === '' ? 'any' : flag(spicyRaw) ? 'only' : spicyRaw === '0' || spicyRaw === 'false' || spicyRaw === 'no' ? 'none' : 'any';
  const category = (first(params, FILTER_PARAMS.category) ?? '').trim().toLowerCase();
  const pageRaw = first(params, FILTER_PARAMS.page);
  const page = pageRaw && /^\d{1,4}$/.test(pageRaw) ? Math.min(MAX_PAGE, Math.max(1, Number(pageRaw))) : 1;
  return {
    q,
    vegetarian: flag(first(params, FILTER_PARAMS.vegetarian)),
    halal: flag(first(params, FILTER_PARAMS.halal)),
    spicy,
    maxPrice: normalizeMaxPrice(first(params, FILTER_PARAMS.maxPrice)),
    category: category.length <= 80 && SLUG_RE.test(category) ? category : '',
    page,
  };
}

/** Фильтры → параметры адреса (стабильный порядок, значения по умолчанию не пишутся). */
export function filtersToSearchParams(filters: Partial<MenuFilters>): URLSearchParams {
  const f = { ...EMPTY_FILTERS, ...filters };
  const params = new URLSearchParams();
  const q = f.q.trim();
  if (q) params.set(FILTER_PARAMS.q, q.slice(0, MAX_QUERY_LENGTH));
  if (f.vegetarian) params.set(FILTER_PARAMS.vegetarian, '1');
  if (f.halal) params.set(FILTER_PARAMS.halal, '1');
  if (f.spicy === 'only') params.set(FILTER_PARAMS.spicy, '1');
  if (f.spicy === 'none') params.set(FILTER_PARAMS.spicy, '0');
  const maxPrice = normalizeMaxPrice(f.maxPrice);
  if (maxPrice) params.set(FILTER_PARAMS.maxPrice, maxPrice);
  if (f.category && SLUG_RE.test(f.category)) params.set(FILTER_PARAMS.category, f.category);
  if (f.page > 1) params.set(FILTER_PARAMS.page, String(Math.trunc(f.page)));
  return params;
}

/** '?q=…' или '' — для ссылок. */
export function filtersToQueryString(filters: Partial<MenuFilters>): string {
  const text = filtersToSearchParams(filters).toString();
  return text ? `?${text}` : '';
}

/**
 * Активен ли поиск/фильтр (страница показывает результаты поиска, а не разделы меню).
 * ignoreCategory — на странице категории категория задана адресом, а не фильтром.
 */
export function hasActiveFilters(filters: MenuFilters, options: { ignoreCategory?: boolean } = {}): boolean {
  return (
    filters.q !== '' ||
    filters.vegetarian ||
    filters.halal ||
    filters.spicy !== 'any' ||
    filters.maxPrice !== '' ||
    (!options.ignoreCategory && filters.category !== '')
  );
}

export function activeFilterCount(filters: MenuFilters, options: { ignoreCategory?: boolean } = {}): number {
  return [
    filters.vegetarian,
    filters.halal,
    filters.spicy !== 'any',
    filters.maxPrice !== '',
    !options.ignoreCategory && filters.category !== '',
  ].filter(Boolean).length;
}

/** Параметры запроса к API поиска (цена — в тиынах). */
export interface MenuSearchQuery {
  q?: string;
  vegetarian?: boolean;
  spicy?: boolean;
  halal?: boolean;
  maxPrice?: number;
  category?: string;
  page: number;
  perPage: number;
}

export function filtersToApiQuery(filters: MenuFilters, perPage: number = SEARCH_PER_PAGE): MenuSearchQuery {
  const query: MenuSearchQuery = { page: filters.page, perPage };
  if (filters.q) query.q = filters.q;
  if (filters.vegetarian) query.vegetarian = true;
  if (filters.halal) query.halal = true;
  if (filters.spicy !== 'any') query.spicy = filters.spicy === 'only';
  const maxPrice = maxPriceToTiyn(filters.maxPrice);
  if (maxPrice !== null) query.maxPrice = maxPrice;
  if (filters.category) query.category = filters.category;
  return query;
}
