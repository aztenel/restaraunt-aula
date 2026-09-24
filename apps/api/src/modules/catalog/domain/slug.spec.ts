import { describe, expect, it } from 'vitest';
import { assertSlug, generateUniqueSlug, slugCandidate, slugify, SLUG_MAX_LENGTH, transliterate } from './slug';

describe('slug', () => {
  it('transliterates russian and kazakh names to readable latin', () => {
    expect(slugify('Бешбармак по-казахски')).toBe('beshbarmak-po-kazakhski');
    expect(slugify('Чай с молоком')).toBe('chay-s-molokom');
    expect(slugify('Қазы')).toBe('qazy');
    expect(slugify('Шұбат')).toBe('shubat');
    expect(slugify('Құйрдақ')).toBe('quyrdaq');
    expect(slugify('Ет қазақша')).toBe('et-qazaqsha');
    expect(slugify('Салат «Оливье» №1')).toBe('salat-olive-no1');
    expect(transliterate('Щука')).toBe('shchuka');
  });

  it('keeps latin, strips diacritics and punctuation', () => {
    expect(slugify('  Caesar Salad!!  ')).toBe('caesar-salad');
    expect(slugify('Crème brûlée')).toBe('creme-brulee');
    expect(slugify('---')).toBe('');
    expect(slugify('😀')).toBe('');
  });

  it('limits slug length without trailing dash', () => {
    const long = slugify('очень '.repeat(40));
    expect(long.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(long.endsWith('-')).toBe(false);
  });

  it('validates manual slugs', () => {
    expect(assertSlug(' Plov ')).toBe('plov');
    expect(() => assertSlug('плов')).toThrow(/latin/);
    expect(() => assertSlug('a--b')).toThrow();
    expect(() => assertSlug('-a')).toThrow();
    expect(() => assertSlug('a'.repeat(81))).toThrow();
  });

  it('generates unique slug with numeric suffix', async () => {
    const taken = new Set(['plov', 'plov-2']);
    const slug = await generateUniqueSlug({ ru: 'Плов' }, 'dish', async (s) => taken.has(s));
    expect(slug).toBe('plov-3');
    expect(await generateUniqueSlug({ kk: 'Палау' }, 'dish', async () => false)).toBe('palau');
    expect(await generateUniqueSlug({ ru: '!!!' }, 'dish', async () => false)).toBe('dish');
    expect(slugCandidate('a'.repeat(80), 12)).toMatch(/-12$/);
    expect(slugCandidate('a'.repeat(80), 12).length).toBe(80);
  });
});
