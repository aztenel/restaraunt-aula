import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/kernel/errors';
import { escapeLike, mergeFilters, normalizeCustomerFilter, phoneSearchPatterns } from './customer-filter';

const BRANCH = '0192a0b4-7a1e-7c3e-9f5e-0c1d2e3f4a5b';

describe('customer filter', () => {
  it('normalizes and drops empty fields', () => {
    expect(normalizeCustomerFilter(undefined)).toEqual({});
    expect(
      normalizeCustomerFilter({
        q: '  Асель ',
        tags: ['VIP', 'vip', ' '],
        spentMin: 0,
        spentMax: 1_000_000,
        lastActivityFrom: '2026-09-01',
        lastActivityTo: '',
        branchId: BRANCH,
        hasBanquet: true,
        marketingConsent: false,
      }),
    ).toEqual({
      q: 'Асель',
      tags: ['vip'],
      spentMin: 0,
      spentMax: 1_000_000,
      lastActivityFrom: '2026-09-01',
      branchId: BRANCH,
      hasBanquet: true,
      marketingConsent: false,
    });
  });

  it('rejects unknown fields and invalid values', () => {
    const bad = [
      { unknown: 1 },
      { spentMin: -1 },
      { spentMin: 10.5 },
      { spentMin: 10, spentMax: 5 },
      { lastActivityFrom: '01.09.2026' },
      { lastActivityFrom: '2026-09-10', lastActivityTo: '2026-09-01' },
      { branchId: 'greenline' },
      { hasBanquet: 'yes' },
      { tags: 'vip' },
      [],
    ];
    for (const raw of bad) {
      expect(() => normalizeCustomerFilter(raw), JSON.stringify(raw)).toThrow(ValidationError);
    }
  });

  it('merges a segment filter with overrides; tags are combined', () => {
    expect(mergeFilters({ tags: ['vip'], hasBanquet: true, spentMin: 100 }, { tags: ['corporate'], spentMin: 200 })).toEqual({
      tags: ['vip', 'corporate'],
      hasBanquet: true,
      spentMin: 200,
    });
  });

  it('builds phone search patterns, including the national 8 prefix', () => {
    expect(phoneSearchPatterns('8 (701) 123-45-67')).toEqual(['%87011234567%', '+77011234567%']);
    expect(phoneSearchPatterns('8 702 222')).toEqual(['%8702222%', '+7702222%']);
    expect(phoneSearchPatterns('+7 701')).toEqual(['%7701%']);
    expect(phoneSearchPatterns('4567')).toEqual(['%4567%']);
    expect(phoneSearchPatterns('45')).toEqual([]);
    expect(phoneSearchPatterns('Асель 1')).toEqual([]);
  });

  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});
