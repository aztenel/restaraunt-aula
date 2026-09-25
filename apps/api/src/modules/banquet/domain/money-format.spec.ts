import { describe, expect, it } from 'vitest';
import { Money } from '../../../shared/kernel/money';
import { amountInWordsRu, divideMoney, formatPercent, formatTenge, integerInWordsRu, toMajorString } from './money-format';

describe('money formatting', () => {
  it('formats tenge and major strings', () => {
    expect(formatTenge(Money.tenge(1_500_000))).toBe('1 500 000 ₸');
    expect(formatTenge(Money.of(150_050))).toBe('1 500,50 ₸');
    expect(toMajorString(Money.of(150_005))).toBe('1500.05');
    expect(toMajorString(Money.of(-5))).toBe('-0.05');
    expect(formatPercent(1600)).toBe('16');
    expect(formatPercent(1250)).toBe('12,5');
    expect(formatPercent(1205)).toBe('12,05');
  });

  it('divides with half-up rounding', () => {
    expect(divideMoney(Money.of(10), 3).amount).toBe(3);
    expect(divideMoney(Money.of(11), 2).amount).toBe(6);
    expect(divideMoney(Money.of(5), 0).amount).toBe(0);
  });

  it('spells numbers in Russian with correct genders and plurals', () => {
    expect(integerInWordsRu(0)).toBe('ноль');
    expect(integerInWordsRu(1)).toBe('один');
    expect(integerInWordsRu(12)).toBe('двенадцать');
    expect(integerInWordsRu(1_000)).toBe('одна тысяча');
    expect(integerInWordsRu(2_002)).toBe('две тысячи два');
    expect(integerInWordsRu(11_000)).toBe('одиннадцать тысяч');
    expect(integerInWordsRu(21_345)).toBe('двадцать одна тысяча триста сорок пять');
    expect(integerInWordsRu(1_000_000)).toBe('один миллион');
    expect(integerInWordsRu(3_512_900)).toBe('три миллиона пятьсот двенадцать тысяч девятьсот');
  });

  it('spells amounts for invoices', () => {
    expect(amountInWordsRu(Money.of(154_000_050))).toBe('Один миллион пятьсот сорок тысяч тенге 50 тиын');
    expect(amountInWordsRu(Money.zero())).toBe('Ноль тенге 00 тиын');
  });
});
