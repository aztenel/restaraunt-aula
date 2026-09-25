import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  EMPTY_FILTERS,
  filtersToApiQuery,
  filtersToQueryString,
  filtersToSearchParams,
  hasActiveFilters,
  maxPriceToTiyn,
  parseMenuFilters,
} from '@/lib/menu-filters';

describe('поиск и фильтры меню ↔ параметры адреса', () => {
  it('пустой адрес — фильтров нет', () => {
    expect(parseMenuFilters(undefined)).toEqual(EMPTY_FILTERS);
    expect(parseMenuFilters({})).toEqual(EMPTY_FILTERS);
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(filtersToQueryString(EMPTY_FILTERS)).toBe('');
  });

  it('разбирает параметры Next.js (searchParams) и URLSearchParams одинаково', () => {
    const fromRecord = parseMenuFilters({ q: '  бешбармак  ', vegetarian: '1', halal: 'true', spicy: '0', maxPrice: '3 000', category: 'supy', page: '2' });
    const fromUrl = parseMenuFilters(new URLSearchParams('q=бешбармак&vegetarian=1&halal=true&spicy=0&maxPrice=3000&category=supy&page=2'));
    expect(fromRecord).toEqual(fromUrl);
    expect(fromRecord).toEqual({ q: 'бешбармак', vegetarian: true, halal: true, spicy: 'none', maxPrice: '3000', category: 'supy', page: 2 });
  });

  it('острота: 1 — только острые, 0 — без остроты, иначе любая', () => {
    expect(parseMenuFilters({ spicy: '1' }).spicy).toBe('only');
    expect(parseMenuFilters({ spicy: '0' }).spicy).toBe('none');
    expect(parseMenuFilters({ spicy: 'maybe' }).spicy).toBe('any');
  });

  it('отбрасывает мусор: цена, slug категории, страница', () => {
    const f = parseMenuFilters({ maxPrice: 'abc', category: '../etc', page: '-4', vegetarian: 'nope' });
    expect(f).toMatchObject({ maxPrice: '', category: '', page: 1, vegetarian: false });
    expect(parseMenuFilters({ maxPrice: '0' }).maxPrice).toBe('');
    expect(parseMenuFilters({ page: '99999' }).page).toBe(1);
    expect(parseMenuFilters({ q: 'x'.repeat(500) }).q).toHaveLength(200);
  });

  it('берёт первое значение повторяющегося параметра', () => {
    expect(parseMenuFilters({ category: ['salaty', 'supy'] }).category).toBe('salaty');
  });

  it('обратное преобразование: стабильный порядок, значения по умолчанию не пишутся', () => {
    const filters = { ...EMPTY_FILTERS, q: 'манты', halal: true, spicy: 'only' as const, maxPrice: '2500,5', page: 3 };
    expect(filtersToSearchParams(filters).toString()).toBe(
      new URLSearchParams({ q: 'манты', halal: '1', spicy: '1', maxPrice: '2500.50', page: '3' }).toString(),
    );
    expect(filtersToQueryString({ ...filters, page: 1 })).not.toContain('page');
  });

  it('туда и обратно без потерь', () => {
    const filters = { q: 'лагман', vegetarian: true, halal: false, spicy: 'none' as const, maxPrice: '4000', category: 'goryachie-blyuda', page: 2 };
    expect(parseMenuFilters(filtersToSearchParams(filters))).toEqual(filters);
  });

  it('цена «до N тенге» → тиыны без плавающей точки', () => {
    expect(maxPriceToTiyn('3000')).toBe(300000);
    expect(maxPriceToTiyn('2 500,50')).toBe(250050);
    expect(maxPriceToTiyn('0.1')).toBe(10);
    expect(maxPriceToTiyn('')).toBeNull();
    expect(maxPriceToTiyn('-5')).toBeNull();
    expect(maxPriceToTiyn('1.234')).toBeNull();
  });

  it('запрос к API поиска: цена в тиынах, spicy — boolean, пустые поля не передаются', () => {
    const filters = parseMenuFilters({ q: 'шашлык', spicy: '1', maxPrice: '5000', category: 'shashlyk' });
    expect(filtersToApiQuery(filters)).toEqual({ q: 'шашлык', spicy: true, maxPrice: 500000, category: 'shashlyk', page: 1, perPage: 24 });
    expect(filtersToApiQuery(parseMenuFilters({ spicy: '0' }))).toEqual({ spicy: false, page: 1, perPage: 24 });
    expect(filtersToApiQuery(EMPTY_FILTERS, 12)).toEqual({ page: 1, perPage: 12 });
  });

  it('активные фильтры; на странице категории категория не считается фильтром', () => {
    const f = parseMenuFilters({ category: 'supy' });
    expect(hasActiveFilters(f)).toBe(true);
    expect(hasActiveFilters(f, { ignoreCategory: true })).toBe(false);
    expect(activeFilterCount(parseMenuFilters({ vegetarian: '1', halal: '1', maxPrice: '100', category: 'supy' }))).toBe(4);
    expect(activeFilterCount(parseMenuFilters({ q: 'x' }))).toBe(0);
  });
});
