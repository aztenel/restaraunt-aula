import { describe, expect, it } from 'vitest';
import { Money } from '../../../shared/kernel/money';
import { averageAmount, formatDecimal, formatTenge, ratio } from './amounts';

describe('averageAmount', () => {
  it('rounds half-up to a whole tiyn without floats', () => {
    expect(averageAmount(Money.of(1000), 3).amount).toBe(333);
    expect(averageAmount(Money.of(1001), 2).amount).toBe(501);
    expect(averageAmount(Money.of(-1001), 2).amount).toBe(-501);
    expect(averageAmount(Money.of(900_000_000_000), 7).amount).toBe(128_571_428_571);
  });

  it('is zero for an empty set', () => {
    expect(averageAmount(Money.of(500), 0).isZero()).toBe(true);
  });
});

describe('ratio', () => {
  it('returns 4-digit precision and null for zero denominator', () => {
    expect(ratio(1, 3)).toBe(0.3333);
    expect(ratio(2, 2)).toBe(1);
    expect(ratio(5, 0)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats tenge for staff messages', () => {
    expect(formatTenge(Money.of(123_456_700))).toBe('1 234 567 ₸');
    expect(formatTenge(Money.of(50))).toBe('0,50 ₸');
    expect(formatTenge(Money.of(-100_000))).toBe('−1 000 ₸');
  });

  it('formats decimals for accounting XML', () => {
    expect(formatDecimal(123_450)).toBe('1234.50');
    expect(formatDecimal(5)).toBe('0.05');
    expect(formatDecimal(-250)).toBe('-2.50');
    expect(formatDecimal(0)).toBe('0.00');
  });
});
