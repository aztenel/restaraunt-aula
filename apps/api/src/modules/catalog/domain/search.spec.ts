import { describe, expect, it } from 'vitest';
import { containsPattern, escapeLike, normalizeSearchQuery, prefixTsQuery, searchTokens } from './search';

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
