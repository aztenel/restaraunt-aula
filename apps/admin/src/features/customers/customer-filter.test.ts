import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  DEFAULT_CUSTOMER_LIST,
  isFilterEmpty,
  mergeSegmentFilter,
  parseListState,
  patchListState,
  serializeListState,
  stateFromFilterDto,
  toFilterDto,
  toListQuery,
  validateListState,
  type CustomerListState,
} from './customer-filter';

const BRANCH = '0b6f2f7e-5a8c-4d1e-9b0a-2f3c4d5e6f70';
const SEGMENT = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';

const full: CustomerListState = {
  q: '701 123',
  tags: ['regular', 'vip'],
  spentMin: 5_000_000,
  spentMax: 20_000_000,
  lastActivityFrom: '2026-09-01',
  lastActivityTo: '2026-09-30',
  branchId: BRANCH,
  hasBanquet: true,
  marketingConsent: false,
  segmentId: SEGMENT,
  includeAnonymized: true,
  sort: 'totalSpent',
  order: 'asc',
  page: 3,
  perPage: 100,
};

describe('фильтр гостей ⇄ адресная строка', () => {
  it('пустой адрес — значения по умолчанию', () => {
    expect(parseListState(new URLSearchParams())).toEqual(DEFAULT_CUSTOMER_LIST);
    expect(serializeListState(DEFAULT_CUSTOMER_LIST).toString()).toBe('');
  });

  it('туда и обратно без потерь', () => {
    const params = serializeListState(full);
    expect(Object.fromEntries(params)).toEqual({
      q: '701 123',
      tag: 'regular,vip',
      spentMin: '5000000',
      spentMax: '20000000',
      activityFrom: '2026-09-01',
      activityTo: '2026-09-30',
      branch: BRANCH,
      banquet: '1',
      marketing: '0',
      segment: SEGMENT,
      anonymized: '1',
      sort: 'totalSpent',
      order: 'asc',
      page: '3',
      perPage: '100',
    });
    expect(parseListState(new URLSearchParams(params.toString()))).toEqual(full);
  });

  it('некорректные значения из адреса отбрасываются', () => {
    const state = parseListState(
      new URLSearchParams('spentMin=-5&spentMax=abc&activityFrom=01.09.2026&banquet=maybe&sort=random&order=up&page=0&perPage=5000&tag=,,a,,a'),
    );
    expect(state.spentMin).toBeNull();
    expect(state.spentMax).toBeNull();
    expect(state.lastActivityFrom).toBeNull();
    expect(state.hasBanquet).toBeNull();
    expect(state.sort).toBe('lastActivity');
    expect(state.order).toBe('desc');
    expect(state.page).toBe(1);
    expect(state.perPage).toBe(50);
    expect(state.tags).toEqual(['a']);
  });

  it('изменение условий возвращает на первую страницу', () => {
    expect(patchListState(full, { q: 'Айгерим' }).page).toBe(1);
    expect(patchListState(full, { page: 7 }).page).toBe(7);
  });
});

describe('фильтр гостей → запрос API', () => {
  it('GET /admin/customers: теги через запятую, булевы — как есть, сегмент и обезличенные', () => {
    expect(toListQuery(full)).toEqual({
      page: 3,
      perPage: 100,
      sort: 'totalSpent',
      order: 'asc',
      q: '701 123',
      tag: 'regular,vip',
      spentMin: 5_000_000,
      spentMax: 20_000_000,
      lastActivityFrom: '2026-09-01',
      lastActivityTo: '2026-09-30',
      branchId: BRANCH,
      hasBanquet: true,
      marketingConsent: false,
      segmentId: SEGMENT,
      includeAnonymized: true,
    });
  });

  it('пустые условия в запрос не попадают', () => {
    expect(toListQuery(DEFAULT_CUSTOMER_LIST)).toEqual({ page: 1, perPage: 50, sort: 'lastActivity', order: 'desc' });
  });

  it('CustomerFilterDto для сегментов и выгрузок — без сегмента, сортировки и страницы', () => {
    expect(toFilterDto(full)).toEqual({
      q: '701 123',
      tags: ['regular', 'vip'],
      spentMin: 5_000_000,
      spentMax: 20_000_000,
      lastActivityFrom: '2026-09-01',
      lastActivityTo: '2026-09-30',
      branchId: BRANCH,
      hasBanquet: true,
      marketingConsent: false,
    });
    expect(toFilterDto({ ...DEFAULT_CUSTOMER_LIST, q: '   ' })).toEqual({});
    expect(isFilterEmpty(toFilterDto(DEFAULT_CUSTOMER_LIST))).toBe(true);
  });

  it('фильтр сегмента → условия экрана (сортировка сохраняется)', () => {
    const state = stateFromFilterDto({ tags: ['banquet'], hasBanquet: true }, { ...full });
    expect(state.tags).toEqual(['banquet']);
    expect(state.hasBanquet).toBe(true);
    expect(state.q).toBe('');
    expect(state.segmentId).toBeNull();
    expect(state.sort).toBe('totalSpent');
    expect(state.page).toBe(1);
    expect(toFilterDto(state)).toEqual({ tags: ['banquet'], hasBanquet: true });
  });

  it('сегмент + уточнения: уточнения перекрывают, теги объединяются (как на сервере)', () => {
    expect(mergeSegmentFilter({ tags: ['regular'], marketingConsent: true, branchId: BRANCH }, { tags: ['vip', 'regular'], spentMin: 100 })).toEqual({
      tags: ['regular', 'vip'],
      marketingConsent: true,
      branchId: BRANCH,
      spentMin: 100,
    });
    expect(mergeSegmentFilter({ hasBanquet: true }, { hasBanquet: false })).toEqual({ hasBanquet: false });
  });

  it('проверка диапазонов и счётчик условий', () => {
    expect(validateListState(full)).toEqual({});
    expect(validateListState({ ...full, spentMin: 30_000_000 })).toEqual({ spent: 'spent_range' });
    expect(validateListState({ ...full, lastActivityFrom: '2026-10-01' })).toEqual({ activity: 'activity_range' });
    expect(activeFilterCount(full)).toBe(8);
    expect(activeFilterCount(DEFAULT_CUSTOMER_LIST)).toBe(0);
  });
});
