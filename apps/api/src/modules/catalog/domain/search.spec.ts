import { describe, expect, it } from 'vitest';
import { imageKey, pickVariant, assertUploadableImage, assertImageDimensions } from './images';
import { containsPattern, escapeLike, normalizeSearchQuery, prefixTsQuery, searchTokens } from './search';
import { missingTranslations } from './translations';

describe('search query', () => {
  it('normalizes whitespace and minimal length', () => {
    expect(normalizeSearchQuery('  бешбармак   по-казахски ')).toBe('бешбармак по-казахски');
    expect(normalizeSearchQuery('a')).toBeNull();
    expect(normalizeSearchQuery(undefined)).toBeNull();
    expect(normalizeSearchQuery('x'.repeat(300))!.length).toBe(100);
  });

  it('builds prefix tsquery from letters of any alphabet', () => {
    expect(searchTokens('Қазы & шұжық!')).toEqual(['қазы', 'шұжық']);
    expect(prefixTsQuery('бешб каз')).toBe('бешб:* & каз:*');
    expect(prefixTsQuery("'):*|!")).toBeNull();
  });

  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(containsPattern('Плов')).toBe('%плов%');
  });
});

describe('images', () => {
  it('validates type, size and width', () => {
    expect(() => assertUploadableImage({ mimetype: 'image/gif', size: 10 })).toThrow(/JPEG/);
    expect(() => assertUploadableImage({ mimetype: 'image/png', size: 11 * 1024 * 1024 })).toThrow(/10 MB/);
    expect(() => assertUploadableImage({ mimetype: 'image/webp', size: 1000 })).not.toThrow();
    expect(() => assertImageDimensions(200, 200)).toThrow(/300px/);
    expect(() => assertImageDimensions(undefined, 10)).toThrow();
  });

  it('keys and variant selection', () => {
    expect(imageKey('dishes', 'd1', 'p1', 600)).toBe('catalog/dishes/d1/p1-600.webp');
    const image = {
      id: 'p1',
      variants: [
        { width: 1200, height: 800, key: 'a' },
        { width: 600, height: 400, key: 'b' },
        { width: 300, height: 200, key: 'c' },
      ],
    };
    expect(pickVariant(image, 600)?.key).toBe('b');
    expect(pickVariant(image, 500)?.key).toBe('b');
    expect(pickVariant(image, 2000)?.key).toBe('a');
    expect(pickVariant({ id: 'x', variants: [] }, 600)).toBeNull();
  });
});

describe('translation completeness', () => {
  it('required fields need kk and ru; optional only if started', () => {
    expect(
      missingTranslations([
        { field: 'name', value: { ru: 'Плов' }, required: true },
        { field: 'description', value: {}, required: false },
        { field: 'composition', value: { kk: 'Күріш' }, required: false },
        { field: 'seoTitle', value: { kk: 'Палау', ru: 'Плов' }, required: false },
      ]),
    ).toEqual([
      { field: 'name', missing: ['kk'] },
      { field: 'composition', missing: ['ru'] },
    ]);
    expect(missingTranslations([{ field: 'name', value: { ru: 'Плов', kk: ' ' }, required: true }], ['kk', 'ru', 'en'])).toEqual([
      { field: 'name', missing: ['kk', 'en'] },
    ]);
  });
});
