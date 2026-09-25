import { describe, expect, it } from 'vitest';
import { ApiError } from '@aula/api-client';
import { bulkAddItems, rowsForBulkAddError } from './add-dishes';

describe('добавление блюд в меню филиала одним запросом', () => {
  it('позиции запроса: цена в тиынах, код POS — по желанию', () => {
    expect(
      bulkAddItems(['d1', 'd2'], {
        d1: { price: 250_000, sku: ' PLV-1 ' },
        d2: { price: 0, sku: '' },
      }),
    ).toEqual([
      { dishId: 'd1', price: { amount: 250_000 }, sku: 'PLV-1' },
      { dishId: 'd2', price: { amount: 0 }, sku: null },
    ]);
  });

  it('нет цены хотя бы у одного блюда — запрос не собирается', () => {
    expect(bulkAddItems(['d1', 'd2'], { d1: { price: 100, sku: '' } })).toBeNull();
    expect(bulkAddItems(['d1'], { d1: { price: null, sku: '' } })).toBeNull();
    expect(bulkAddItems([], {})).toEqual([]);
  });

  const items = [
    { dishId: 'd1', price: { amount: 1 }, sku: 'A-1' },
    { dishId: 'd2', price: { amount: 1 }, sku: null },
  ];
  const error = (code: string, details: Record<string, unknown>) => new ApiError({ status: 409, code, details });

  it('ошибка по блюдам (уже в меню, не найдено) — подсветка этих строк', () => {
    expect(rowsForBulkAddError(error('catalog.dish_already_in_menu', { dishIds: ['d2'] }), items)).toEqual(['d2']);
    expect(rowsForBulkAddError(error('dish.not_found', { dishIds: ['d1', 7] }), items)).toEqual(['d1']);
  });

  it('занятый код POS — строки с этим кодом; прочие ошибки — общие', () => {
    expect(rowsForBulkAddError(error('catalog.sku_taken', { sku: 'a-1' }), items)).toEqual(['d1']);
    expect(rowsForBulkAddError(error('catalog.invalid_price', {}), items)).toEqual([]);
  });
});
