import { describe, expect, it } from 'vitest';
import type { BanquetRequestSummary } from '../types';
import {
  activeFilterCount,
  arrivedSince,
  boardUsesList,
  breachedCount,
  columnOf,
  EMPTY_FILTERS,
  groupByStatus,
  newRequestIds,
  toListQuery,
  toPipelineQuery,
} from './pipeline-utils';

const req = (id: string, status: BanquetRequestSummary['status'], slaBreached = false) => ({ id, status, slaBreached }) as BanquetRequestSummary;

describe('фильтры воронки → параметры API', () => {
  it('по умолчанию — без параметров, доска из GET /pipeline', () => {
    expect(toPipelineQuery(EMPTY_FILTERS)).toEqual({});
    expect(boardUsesList(EMPTY_FILTERS)).toBe(false);
  });

  it('филиал, менеджер, даты мероприятия', () => {
    const filters = { ...EMPTY_FILTERS, branchId: 'b1', managerId: 'm1', dateFrom: '2026-10-01', dateTo: '2026-10-31' };
    expect(toPipelineQuery(filters)).toEqual({ branchId: 'b1', managerId: 'm1', dateFrom: '2026-10-01', dateTo: '2026-10-31' });
  });

  it('поиск и «SLA нарушен» — только у списка: доска строится из GET /requests', () => {
    const filters = { ...EMPTY_FILTERS, q: '  +7701 ', slaBreached: true };
    expect(boardUsesList(filters)).toBe(true);
    expect(toListQuery(filters)).toEqual({ q: '+7701', slaBreached: true, page: 1, perPage: 200 });
    expect(toListQuery(EMPTY_FILTERS, { status: ['new', 'in_progress'], page: 3, perPage: 50 })).toEqual({ status: ['new', 'in_progress'], page: 3, perPage: 50 });
  });

  it('счётчик активных фильтров', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTERS, managerId: 'm', dateFrom: '2026-10-01', q: 'x' })).toBe(3);
    expect(activeFilterCount({ ...EMPTY_FILTERS, branchId: 'b2' }, { ...EMPTY_FILTERS, branchId: 'b1' })).toBe(1);
  });
});

describe('колонки канбана', () => {
  it('группировка списка по статусам в порядке воронки', () => {
    const columns = groupByStatus([req('a', 'agreed'), req('b', 'new'), req('c', 'new', true), req('d', 'cancelled')]);
    expect(columns.map((c) => c.status)).toEqual(['new', 'in_progress', 'quote_sent', 'agreed', 'prepaid', 'held', 'cancelled']);
    expect(columnOf(columns, 'new')).toMatchObject({ count: 2 });
    expect(columnOf(columns, 'new').items.map((i) => i.id)).toEqual(['b', 'c']);
    expect(breachedCount(columnOf(columns, 'new'))).toBe(1);
    expect(columnOf(undefined, 'held')).toEqual({ status: 'held', count: 0, items: [] });
  });

  it('новые заявки между опросами', () => {
    const first = newRequestIds(groupByStatus([req('a', 'new')]));
    expect(arrivedSince(null, first)).toEqual([]);
    const second = newRequestIds(groupByStatus([req('a', 'new'), req('b', 'new'), req('c', 'in_progress')]));
    expect(arrivedSince(first, second)).toEqual(['b']);
  });
});
