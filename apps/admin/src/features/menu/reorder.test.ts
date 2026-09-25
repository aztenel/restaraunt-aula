import { describe, expect, it } from 'vitest';
import { applyOrder, bySortOrder, moveBy, moveById, moveItem, sameOrder } from './reorder';

const ids = ['a', 'b', 'c', 'd'];

describe('порядок элементов (категории, фото, опции)', () => {
  it('moveItem: перенос с позиции на позицию без изменения исходного массива', () => {
    expect(moveItem(ids, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(ids, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('moveItem: неверные индексы — без изменений', () => {
    expect(moveItem(ids, -1, 2)).toEqual(ids);
    expect(moveItem(ids, 1, 4)).toEqual(ids);
    expect(moveItem(ids, 2, 2)).toEqual(ids);
  });

  it('вверх/вниз: у края списка ничего не меняется', () => {
    expect(moveBy(ids, 1, -1)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveBy(ids, 1, 1)).toEqual(['a', 'c', 'b', 'd']);
    expect(moveBy(ids, 0, -1)).toEqual(ids);
    expect(moveBy(ids, 3, 1)).toEqual(ids);
  });

  it('перетаскивание по id: элемент встаёт на место цели', () => {
    const rows = ids.map((id) => ({ id }));
    expect(moveById(rows, 'd', 'b').map((r) => r.id)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveById(rows, 'a', 'c').map((r) => r.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveById(rows, 'x', 'c').map((r) => r.id)).toEqual(ids);
  });

  it('sameOrder: отправлять на сервер только изменённый порядок', () => {
    expect(sameOrder(ids, [...ids])).toBe(true);
    expect(sameOrder(ids, ['b', 'a', 'c', 'd'])).toBe(false);
    expect(sameOrder(ids, ['a', 'b', 'c'])).toBe(false);
  });

  it('bySortOrder: стабильная сортировка как на сервере', () => {
    const rows = [
      { id: 'x', sortOrder: 20 },
      { id: 'y', sortOrder: 10 },
      { id: 'z', sortOrder: 20 },
    ];
    expect(bySortOrder(rows).map((r) => r.id)).toEqual(['y', 'x', 'z']);
  });

  it('applyOrder: оптимистичный порядок в кэше, неизвестные id — в конце', () => {
    const rows = ['a', 'b', 'c', 'n'].map((id) => ({ id }));
    expect(applyOrder(rows, ['c', 'a', 'b']).map((r) => r.id)).toEqual(['c', 'a', 'b', 'n']);
  });
});
