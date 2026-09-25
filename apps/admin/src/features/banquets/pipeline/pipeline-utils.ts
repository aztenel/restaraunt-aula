/**
 * Воронка заявок: фильтры → параметры API, колонки канбана, новые заявки между опросами.
 * Доска и список фильтруются сервером одинаково (филиал, менеджер, даты мероприятия, поиск,
 * выезд / в зале, нарушен SLA): GET /pipeline и GET /requests.
 */
import type { BanquetStatus, PipelineColumn, PipelineQuery, RequestListQuery } from '../types';

export type PlaceFilter = 'all' | 'branch' | 'offsite';

export interface PipelineFilters {
  branchId: string | null;
  managerId: string | null;
  /** Дата мероприятия, YYYY-MM-DD, включительно. */
  dateFrom: string | null;
  dateTo: string | null;
  slaBreached: boolean;
  q: string;
  /** Выездные / в залах филиалов / все. */
  place: PlaceFilter;
}

export const EMPTY_FILTERS: PipelineFilters = { branchId: null, managerId: null, dateFrom: null, dateTo: null, slaBreached: false, q: '', place: 'all' };

export function toPipelineQuery(filters: PipelineFilters): PipelineQuery {
  const q = filters.q.trim();
  return {
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.managerId ? { managerId: filters.managerId } : {}),
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
    ...(q ? { q } : {}),
    ...(filters.place !== 'all' ? { offsite: filters.place === 'offsite' } : {}),
    ...(filters.slaBreached ? { slaBreached: true } : {}),
  };
}

export function toListQuery(filters: PipelineFilters, extra: { status?: BanquetStatus[]; page?: number; perPage?: number } = {}): RequestListQuery {
  return {
    ...toPipelineQuery(filters),
    ...(extra.status && extra.status.length > 0 ? { status: extra.status } : {}),
    page: extra.page ?? 1,
    perPage: extra.perPage ?? 50,
  };
}

export function columnOf(columns: readonly PipelineColumn[] | undefined, status: BanquetStatus): PipelineColumn {
  return columns?.find((c) => c.status === status) ?? { status, count: 0, items: [] };
}

/** id заявок в колонке «Новые». */
export function newRequestIds(columns: readonly PipelineColumn[] | undefined): Set<string> {
  return new Set(columnOf(columns, 'new').items.map((i) => i.id));
}

/** Появившиеся с прошлого опроса новые заявки; первый ответ (previous = null) — не «новые». */
export function arrivedSince(previous: ReadonlySet<string> | null, current: ReadonlySet<string>): string[] {
  if (previous === null) return [];
  return [...current].filter((id) => !previous.has(id));
}

/** Сколько новых заявок с нарушенным SLA (для заголовка колонки и виджета). */
export function breachedCount(column: PipelineColumn): number {
  return column.items.filter((i) => i.slaBreached).length;
}

/** Активных фильтров (для бейджа кнопки «Сбросить»). */
export function activeFilterCount(filters: PipelineFilters, defaults: PipelineFilters = EMPTY_FILTERS): number {
  let n = 0;
  if (filters.branchId !== defaults.branchId) n += 1;
  if (filters.managerId) n += 1;
  if (filters.dateFrom || filters.dateTo) n += 1;
  if (filters.slaBreached) n += 1;
  if (filters.q.trim()) n += 1;
  if (filters.place !== 'all') n += 1;
  return n;
}
