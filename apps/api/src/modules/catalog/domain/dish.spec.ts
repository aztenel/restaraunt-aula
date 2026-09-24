import { describe, expect, it } from 'vitest';
import { Money } from '../../../shared/kernel/money';
import { assertMenuPrice, normalizeSku, optionalText, requiredText, validateDishAttributes } from './dish';

describe('dish rules', () => {
  it('defaults: halal by default, not vegetarian, not spicy', () => {
    expect(validateDishAttributes({})).toEqual({
      weightGrams: null,
      calories: null,
      spicyLevel: 0,
      isVegetarian: false,
      isHalal: true,
      allergens: [],
    });
  });

  it('validates spicy level 0..3, weight and calories', () => {
    expect(validateDishAttributes({ spicyLevel: 3, weightGrams: 350, calories: 620 })).toMatchObject({
      spicyLevel: 3,
      weightGrams: 350,
      calories: 620,
    });
    expect(() => validateDishAttributes({ spicyLevel: 4 })).toThrow(/Spicy/);
    expect(() => validateDishAttributes({ spicyLevel: 1.5 })).toThrow();
    expect(() => validateDishAttributes({ weightGrams: 0 })).toThrow(/weightGrams/);
    expect(() => validateDishAttributes({ weightGrams: 12.5 })).toThrow();
    expect(() => validateDishAttributes({ calories: -1 })).toThrow(/calories/);
  });

  it('keeps current values on partial update, null clears optional numbers', () => {
    const current = validateDishAttributes({ weightGrams: 300, calories: 500, spicyLevel: 2, allergens: ['milk'] });
    expect(validateDishAttributes({ isVegetarian: true }, current)).toMatchObject({ weightGrams: 300, spicyLevel: 2, allergens: ['milk'] });
    expect(validateDishAttributes({ weightGrams: null }, current).weightGrams).toBeNull();
  });

  it('validates POS sku', () => {
    expect(normalizeSku('  ')).toBeNull();
    expect(normalizeSku(' 0012-A ')).toBe('0012-A');
    expect(normalizeSku('3fa85f64-5717-4562-b3fc-2c963f66afa6')).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
    expect(() => normalizeSku('bad sku')).toThrow();
  });

  it('requires ru or kk text for names and limits length', () => {
    expect(requiredText({ kk: ' Палау ' }, 200, 'name')).toEqual({ kk: 'Палау' });
    expect(() => requiredText({ en: 'Plov' }, 200, 'name')).toThrow(/ru or kk/);
    expect(() => requiredText({ ru: 'x'.repeat(201) }, 200, 'name')).toThrow(/longer/);
    expect(optionalText({ ru: '', kk: 'Сипаттама' }, 100, 'description')).toEqual({ kk: 'Сипаттама' });
    expect(optionalText(null, 100, 'description')).toEqual({});
  });

  it('menu price is non-negative integer tiyn within limits', () => {
    expect(assertMenuPrice(Money.tenge(3500)).amount).toBe(350_000);
    expect(assertMenuPrice(Money.zero()).amount).toBe(0);
    expect(() => assertMenuPrice(Money.of(-1))).toThrow();
    expect(() => assertMenuPrice(Money.tenge(20_000_000))).toThrow();
  });
});
