import { describe, expect, it } from 'vitest';
import type { MappingSuggestion } from './api';
import { chunk, defaultSelection, scorePercent, toBulkPlan } from './suggestions';

const suggestion = (externalProductId: string, candidates: Array<[string, number, 'sku' | 'name']>): MappingSuggestion => ({
  product: {
    id: `p-${externalProductId}`,
    externalProductId,
    name: `Товар ${externalProductId}`,
    sku: null,
    kind: 'dish',
    groupName: null,
    importedAt: '2026-09-01T00:00:00Z',
    removed: false,
    mappedDishIds: [],
  },
  candidates: candidates.map(([dishId, score, method]) => ({ dishId, dishName: { ru: dishId }, score, method })),
});

describe('принятие подсказок автоподбора POS', () => {
  const list = [
    suggestion('ext-1', [
      ['dish-a', 0.72, 'name'],
      ['dish-b', 0.95, 'name'],
    ]),
    suggestion('ext-2', [['dish-c', 0.4, 'sku']]),
    suggestion('ext-3', [['dish-d', 0.5, 'name']]),
    suggestion('ext-4', []),
  ];

  it('по умолчанию — лучший кандидат при совпадении кода или похожести ≥ 80%', () => {
    expect(defaultSelection(list)).toEqual({ 'ext-1': 'dish-b', 'ext-2': 'dish-c', 'ext-3': null, 'ext-4': null });
    expect(defaultSelection(list, 0.5)['ext-3']).toBe('dish-d');
  });

  it('выбор → тело bulk: блюдо, товар POS и его название; невыбранные пропускаются', () => {
    const plan = toBulkPlan(list, { 'ext-1': 'dish-b', 'ext-2': 'dish-c', 'ext-3': null });
    expect(plan.items).toEqual([
      { dishId: 'dish-b', externalProductId: 'ext-1', externalName: 'Товар ext-1' },
      { dishId: 'dish-c', externalProductId: 'ext-2', externalName: 'Товар ext-2' },
    ]);
    expect(plan.skipped).toBe(2);
    expect(plan.conflicts).toEqual({});
  });

  it('одно блюдо для двух товаров — конфликт, в запрос не попадает (сервер отклонил бы весь запрос)', () => {
    const plan = toBulkPlan(list, { 'ext-1': 'dish-b', 'ext-3': 'dish-b', 'ext-2': 'dish-c' });
    expect(plan.conflicts).toEqual({ 'dish-b': ['ext-1', 'ext-3'] });
    expect(plan.items.map((i) => i.dishId)).toEqual(['dish-c']);
  });

  it('запросы — не больше 500 строк', () => {
    const items = Array.from({ length: 1201 }, (_, i) => i);
    expect(chunk(items).map((c) => c.length)).toEqual([500, 500, 201]);
    expect(chunk([])).toEqual([]);
  });

  it('похожесть в процентах', () => {
    expect(scorePercent(0.954)).toBe(95);
    expect(scorePercent(1.2)).toBe(100);
  });
});
