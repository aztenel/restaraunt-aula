import { describe, expect, it } from 'vitest';
import { changedPrices } from './bulk-prices';

const items = [
  { dishId: 'a', price: { amount: 250000, currency: 'KZT' as const } },
  { dishId: 'b', price: { amount: 180050, currency: 'KZT' as const } },
  { dishId: 'c', price: { amount: 99000, currency: 'KZT' as const } },
];

describe('массовое изменение цен: только изменённые, в тиынах', () => {
  it('пустые и равные текущей цены не отправляются', () => {
    expect(changedPrices(items, { a: 260000, b: 180050, c: null })).toEqual([{ dishId: 'a', price: { amount: 260000 } }]);
  });

  it('неизвестные блюда и нецелые значения игнорируются, порядок — как в меню', () => {
    expect(changedPrices(items, { x: 1, c: 0, b: 1.5, a: 1 })).toEqual([
      { dishId: 'a', price: { amount: 1 } },
      { dishId: 'c', price: { amount: 0 } },
    ]);
  });
});
