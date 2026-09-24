import { describe, expect, it } from 'vitest';
import { Money } from './money';

describe('Money', () => {
  it('stores integer minor units only', () => {
    expect(() => Money.of(10.5)).toThrow();
    expect(Money.tenge(1500).amount).toBe(150_000);
  });

  it('adds, subtracts, multiplies', () => {
    const a = Money.tenge(100);
    expect(a.add(Money.of(50)).amount).toBe(10_050);
    expect(a.subtract(Money.tenge(30)).amount).toBe(7_000);
    expect(a.multiply(3).amount).toBe(30_000);
  });

  it('computes percentage with half-up rounding', () => {
    expect(Money.of(1_005).percentage(1_000).amount).toBe(101); // 100.5 -> 101
    expect(Money.of(-1_005).percentage(1_000).amount).toBe(-101);
    expect(Money.of(999).percentage(3_333).amount).toBe(333);
  });

  it('computes included VAT', () => {
    // 11600 с НДС 16% -> НДС 1600
    expect(Money.of(11_600).includedTax(1_600).amount).toBe(1_600);
    expect(Money.of(100).includedTax(0).amount).toBe(0);
  });

  it('serializes to json with currency', () => {
    expect(JSON.parse(JSON.stringify({ m: Money.tenge(1) }))).toEqual({ m: { amount: 100, currency: 'KZT' } });
  });

  it('clamps to zero and compares', () => {
    expect(Money.of(-5).clampToZero().isZero()).toBe(true);
    expect(Money.of(5).greaterThan(Money.of(4))).toBe(true);
    expect(Money.sum([Money.of(1), Money.of(2)]).amount).toBe(3);
  });
});
