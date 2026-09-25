/**
 * Фильтр базы гостей: состояние экрана ⇄ адресная строка (ссылкой на выборку можно поделиться)
 * ⇄ параметры GET /admin/customers ⇄ CustomerFilterDto (сегменты и выгрузки).
 * Суммы — тиыны, даты последней активности — локальные даты YYYY-MM-DD (Asia/Almaty), включительно.
 * Правила нормализации (теги, диапазоны) окончательно применяет сервер (normalizeCustomerFilter).
 */
import { CUSTOMER_SORTS, type CustomerFilterDto, type CustomerListQuery, type CustomerSort } from './types';

export interface CustomerListState {
  /** Поиск по телефону (цифры), имени или email. */
  q: string;
  /** Все теги должны быть у гостя. */
  tags: string[];
  /** Сумма покупок за всё время от/до, тиыны (включительно). */
  spentMin: number | null;
  spentMax: number | null;
  /** Последняя активность с/по, YYYY-MM-DD. */
  lastActivityFrom: string | null;
  lastActivityTo: string | null;
  /** Была активность в филиале. */
  branchId: string | null;
  /** null — не важно. */
  hasBanquet: boolean | null;
  marketingConsent: boolean | null;
  /** Сохранённый сегмент; поля выше уточняют его. */
  segmentId: string | null;
  includeAnonymized: boolean;
  sort: CustomerSort;
  order: 'asc' | 'desc';
  page: number;
  perPage: number;
}

export const DEFAULT_PER_PAGE = 50;

export const DEFAULT_CUSTOMER_LIST: CustomerListState = {
  q: '',
  tags: [],
  spentMin: null,
  spentMax: null,
  lastActivityFrom: null,
  lastActivityTo: null,
  branchId: null,
  hasBanquet: null,
  marketingConsent: null,
  segmentId: null,
  includeAnonymized: false,
  sort: 'lastActivity',
  order: 'desc',
  page: 1,
  perPage: DEFAULT_PER_PAGE,
};

/** Имена параметров адресной строки. */
const P = {
  q: 'q',
  tags: 'tag',
  spentMin: 'spentMin',
  spentMax: 'spentMax',
  activityFrom: 'activityFrom',
  activityTo: 'activityTo',
  branch: 'branch',
  banquet: 'banquet',
  marketing: 'marketing',
  segment: 'segment',
  anonymized: 'anonymized',
  sort: 'sort',
  order: 'order',
  page: 'page',
  perPage: 'perPage',
} as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseTiyn(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function parseDate(value: string | null): string | null {
  return value && DATE_RE.test(value) ? value : null;
}

function parseBool(value: string | null): boolean | null {
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return null;
}

function parsePositiveInt(value: string | null, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (value === null || !/^\d+$/.test(value)) return fallback;
  const n = Number(value);
  return n >= 1 && n <= max ? n : fallback;
}

function uniqueTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

/** Адресная строка → состояние экрана (некорректные значения отбрасываются). */
export function parseListState(params: URLSearchParams): CustomerListState {
  const sort = params.get(P.sort);
  const order = params.get(P.order);
  return {
    q: params.get(P.q)?.trim() ?? '',
    tags: uniqueTags((params.get(P.tags) ?? '').split(',')),
    spentMin: parseTiyn(params.get(P.spentMin)),
    spentMax: parseTiyn(params.get(P.spentMax)),
    lastActivityFrom: parseDate(params.get(P.activityFrom)),
    lastActivityTo: parseDate(params.get(P.activityTo)),
    branchId: params.get(P.branch) || null,
    hasBanquet: parseBool(params.get(P.banquet)),
    marketingConsent: parseBool(params.get(P.marketing)),
    segmentId: params.get(P.segment) || null,
    includeAnonymized: parseBool(params.get(P.anonymized)) === true,
    sort: (CUSTOMER_SORTS as readonly string[]).includes(sort ?? '') ? (sort as CustomerSort) : DEFAULT_CUSTOMER_LIST.sort,
    order: order === 'asc' || order === 'desc' ? order : DEFAULT_CUSTOMER_LIST.order,
    page: parsePositiveInt(params.get(P.page), 1),
    perPage: parsePositiveInt(params.get(P.perPage), DEFAULT_PER_PAGE, 200),
  };
}

/** Состояние экрана → адресная строка (только отличия от значений по умолчанию). */
export function serializeListState(state: CustomerListState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set(P.q, state.q.trim());
  const tags = uniqueTags(state.tags);
  if (tags.length) params.set(P.tags, tags.join(','));
  if (state.spentMin !== null) params.set(P.spentMin, String(state.spentMin));
  if (state.spentMax !== null) params.set(P.spentMax, String(state.spentMax));
  if (state.lastActivityFrom) params.set(P.activityFrom, state.lastActivityFrom);
  if (state.lastActivityTo) params.set(P.activityTo, state.lastActivityTo);
  if (state.branchId) params.set(P.branch, state.branchId);
  if (state.hasBanquet !== null) params.set(P.banquet, state.hasBanquet ? '1' : '0');
  if (state.marketingConsent !== null) params.set(P.marketing, state.marketingConsent ? '1' : '0');
  if (state.segmentId) params.set(P.segment, state.segmentId);
  if (state.includeAnonymized) params.set(P.anonymized, '1');
  if (state.sort !== DEFAULT_CUSTOMER_LIST.sort) params.set(P.sort, state.sort);
  if (state.order !== DEFAULT_CUSTOMER_LIST.order) params.set(P.order, state.order);
  if (state.page !== 1) params.set(P.page, String(state.page));
  if (state.perPage !== DEFAULT_PER_PAGE) params.set(P.perPage, String(state.perPage));
  return params;
}

/** Состояние экрана → параметры GET /admin/customers (теги — через запятую, нужны все). */
export function toListQuery(state: CustomerListState): CustomerListQuery {
  const query: CustomerListQuery = { page: state.page, perPage: state.perPage, sort: state.sort, order: state.order };
  const filter = toFilterDto(state);
  if (filter.q) query.q = filter.q;
  if (filter.tags) query.tag = filter.tags.join(',');
  if (filter.spentMin !== undefined) query.spentMin = filter.spentMin;
  if (filter.spentMax !== undefined) query.spentMax = filter.spentMax;
  if (filter.lastActivityFrom) query.lastActivityFrom = filter.lastActivityFrom;
  if (filter.lastActivityTo) query.lastActivityTo = filter.lastActivityTo;
  if (filter.branchId) query.branchId = filter.branchId;
  if (filter.hasBanquet !== undefined) query.hasBanquet = filter.hasBanquet;
  if (filter.marketingConsent !== undefined) query.marketingConsent = filter.marketingConsent;
  if (state.segmentId) query.segmentId = state.segmentId;
  if (state.includeAnonymized) query.includeAnonymized = true;
  return query;
}

/** Условия фильтра (без сегмента, сортировки и страницы) → CustomerFilterDto; пустые поля не передаются. */
export function toFilterDto(state: Pick<CustomerListState, keyof CustomerFilterDto & keyof CustomerListState>): CustomerFilterDto {
  const dto: CustomerFilterDto = {};
  const q = state.q.trim();
  if (q) dto.q = q;
  const tags = uniqueTags(state.tags);
  if (tags.length) dto.tags = tags;
  if (state.spentMin !== null) dto.spentMin = state.spentMin;
  if (state.spentMax !== null) dto.spentMax = state.spentMax;
  if (state.lastActivityFrom) dto.lastActivityFrom = state.lastActivityFrom;
  if (state.lastActivityTo) dto.lastActivityTo = state.lastActivityTo;
  if (state.branchId) dto.branchId = state.branchId;
  if (state.hasBanquet !== null) dto.hasBanquet = state.hasBanquet;
  if (state.marketingConsent !== null) dto.marketingConsent = state.marketingConsent;
  return dto;
}

/** CustomerFilterDto (сегмент) → условия экрана. Сортировка и размер страницы сохраняются, сегмент сбрасывается. */
export function stateFromFilterDto(dto: CustomerFilterDto, base: CustomerListState = DEFAULT_CUSTOMER_LIST): CustomerListState {
  return {
    ...base,
    q: dto.q ?? '',
    tags: uniqueTags(dto.tags ?? []),
    spentMin: dto.spentMin ?? null,
    spentMax: dto.spentMax ?? null,
    lastActivityFrom: dto.lastActivityFrom ?? null,
    lastActivityTo: dto.lastActivityTo ?? null,
    branchId: dto.branchId ?? null,
    hasBanquet: dto.hasBanquet ?? null,
    marketingConsent: dto.marketingConsent ?? null,
    segmentId: null,
    page: 1,
  };
}

/**
 * Фильтр сегмента + уточнения экрана — как mergeFilters на сервере: заданные уточнения перекрывают поля
 * сегмента, теги объединяются. Нужен, чтобы «сохранить текущую выборку как сегмент» при выбранном сегменте.
 */
export function mergeSegmentFilter(base: CustomerFilterDto, override: CustomerFilterDto): CustomerFilterDto {
  const merged: CustomerFilterDto = { ...base };
  for (const [key, value] of Object.entries(override) as Array<[keyof CustomerFilterDto, unknown]>) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  const tags = uniqueTags([...(base.tags ?? []), ...(override.tags ?? [])]);
  if (tags.length) merged.tags = tags;
  else delete merged.tags;
  return merged;
}

export function isFilterEmpty(dto: CustomerFilterDto): boolean {
  return Object.values(dto).every((value) => value === undefined || (Array.isArray(value) && value.length === 0));
}

/** Сколько условий задано (для кнопки «Фильтры»), без поиска и сегмента. */
export function activeFilterCount(state: CustomerListState): number {
  const { q: _q, ...rest } = toFilterDto(state);
  return Object.keys(rest).length;
}

export type FilterIssue = 'spent_range' | 'activity_range';

/** Проверка диапазонов до запроса (сервер ответит customer_filter.invalid). */
export function validateListState(state: CustomerListState): Partial<Record<'spent' | 'activity', FilterIssue>> {
  const issues: Partial<Record<'spent' | 'activity', FilterIssue>> = {};
  if (state.spentMin !== null && state.spentMax !== null && state.spentMin > state.spentMax) issues.spent = 'spent_range';
  if (state.lastActivityFrom && state.lastActivityTo && state.lastActivityFrom > state.lastActivityTo) issues.activity = 'activity_range';
  return issues;
}

/** Изменение условий — снова с первой страницы. */
export function patchListState(state: CustomerListState, patch: Partial<CustomerListState>): CustomerListState {
  return { ...state, ...patch, page: patch.page ?? 1 };
}
