import { describe, expect, it } from 'vitest';
import type { BanquetRequestSummary, PipelineColumn } from '../types';
import { activeFilterCount, arrivedSince, breachedCount, columnOf, EMPTY_FILTERS, newRequestIds, toListQuery, toPipelineQuery } from './pipeline-utils';

const req = (id: string, status: BanquetRequestSummary['status'], slaBreached = false) => ({ id, status, slaBreached }) as BanquetRequestSummary;
const column = (status: PipelineColumn['status'], items: BanquetRequestSummary[]): PipelineColumn => ({ status, count: items.length, items });

describe('фильтры воронки → параметры API (доска и список — одинаково)', () => {
  it('по умолчанию — без параметров', () => {
    expect(toPipelineQuery(EMPTY_FILTERS)).toEqual({});
  });

  it('филиал, менеджер, даты мероприятия, поиск, выезд, SLA — все уходят в GET /pipeline', () => {
    const filters = {
      ...EMPTY_FILTERS,
      branchId: 'b1',
      managerId: 'm1',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      q: '  +7701 ',
      place: 'offsite' as const,
      slaBreached: true,
    };
    expect(toPipelineQuery(filters)).toEqual({
      branchId: 'b1',
      managerId: 'm1',
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
      q: '+7701',
      offsite: true,
      slaBreached: true,
    });
    expect(toPipelineQuery({ ...EMPTY_FILTERS, place: 'branch' })).toEqual({ offsite: false });
  });

  it('список: те же фильтры плюс статусы и страница', () => {
    expect(toListQuery({ ...EMPTY_FILTERS, q: 'GL-B' }, { status: ['new', 'in_progress'], page: 3, perPage: 20 })).toEqual({
      q: 'GL-B',
      status: ['new', 'in_progress'],
      page: 3,
      perPage: 20,
    });
    expect(toListQuery(EMPTY_FILTERS)).toEqual({ page: 1, perPage: 50 });
  });

  it('счётчик активных фильтров', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTERS, managerId: 'm', dateFrom: '2026-10-01', q: 'x', place: 'branch' })).toBe(4);
    expect(activeFilterCount({ ...EMPTY_FILTERS, branchId: 'b2' }, { ...EMPTY_FILTERS, branchId: 'b1' })).toBe(1);
  });
});

describe('колонки канбана', () => {
  it('колонка по статусу и число нарушений SLA', () => {
    const columns = [column('new', [req('b', 'new'), req('c', 'new', true)]), column('agreed', [req('a', 'agreed')])];
    expect(columnOf(columns, 'new').items.map((i) => i.id)).toEqual(['b', 'c']);
    expect(breachedCount(columnOf(columns, 'new'))).toBe(1);
    expect(columnOf(undefined, 'held')).toEqual({ status: 'held', count: 0, items: [] });
  });

  it('новые заявки между опросами', () => {
    const first = newRequestIds([column('new', [req('a', 'new')])]);
    expect(arrivedSince(null, first)).toEqual([]);
    const second = newRequestIds([column('new', [req('a', 'new'), req('b', 'new')]), column('in_progress', [req('c', 'in_progress')])]);
    expect(arrivedSince(first, second)).toEqual(['b']);
  });
});
