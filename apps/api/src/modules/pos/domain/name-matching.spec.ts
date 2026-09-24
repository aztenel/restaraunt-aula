import { describe, expect, it } from 'vitest';
import { nameSimilarity, normalizeProductName, rankCandidates, searchKeywords } from './name-matching';

describe('name matching', () => {
  it('normalizes case, ё, punctuation and measures', () => {
    expect(normalizeProductName('  Плов «Узбекский», 350 г ')).toBe('плов узбекский');
    expect(normalizeProductName('Айран 0,5 л')).toBe('айран');
    expect(normalizeProductName('Шашлык из телятины (1 шт)')).toBe('шашлык из телятины');
    expect(normalizeProductName('Пицца 4 сыра')).toBe('пицца 4 сыра');
    expect(normalizeProductName('Ёжики')).toBe('ежики');
  });

  it('scores identical names as 1 and unrelated as 0', () => {
    expect(nameSimilarity('Бешбармак 500 г', 'бешбармак')).toBe(1);
    expect(nameSimilarity('Лагман', 'Плов')).toBe(0);
    expect(nameSimilarity('', 'Плов')).toBe(0);
  });

  it('partial matches score between thresholds, word forms are matched', () => {
    const partial = nameSimilarity('Плов узбекский', 'Плов');
    expect(partial).toBeGreaterThanOrEqual(0.5);
    expect(partial).toBeLessThan(1);
    expect(nameSimilarity('Суп из чечевицы', 'Суп чечевичный')).toBeGreaterThan(0);
    expect(nameSimilarity('Порция плова', 'Плов')).toBeGreaterThan(0.5);
  });

  it('ranks candidates by the best of translated names', () => {
    const ranked = rankCandidates('Лагман гуйру', [
      { dishId: 'd1', names: ['Плов', 'Палау'] },
      { dishId: 'd2', names: ['Лагман гуйру', 'Гуйру лағман'] },
      { dishId: 'd3', names: ['Лагман'] },
    ]);
    expect(ranked.map((r) => r.dishId)).toEqual(['d2', 'd3']);
    expect(ranked[0]!.score).toBe(1);
  });

  it('picks significant words for menu search in order', () => {
    expect(searchKeywords('Плов узбекский 350 г')).toEqual(['плов', 'узбекский']);
    expect(searchKeywords('Суп из чечевицы с зеленью и сметаной', 2)).toEqual(['суп', 'чечевицы']);
    expect(searchKeywords('12 %')).toEqual([]);
  });
});
