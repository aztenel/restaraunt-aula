import { describe, expect, it } from 'vitest';
import { ALLERGEN_CODES, allergenLabel, isAllergenCode, normalizeAllergens } from './allergens';

describe('allergens', () => {
  it('normalizes allergens to reference codes in reference order', () => {
    expect(normalizeAllergens(['Milk', 'gluten', 'milk'])).toEqual(['gluten', 'milk']);
    expect(normalizeAllergens(null)).toEqual([]);
    expect(() => normalizeAllergens(['bread'])).toThrow(/Unknown allergen/);
  });

  it('has 14 codes with kk/ru/en labels', () => {
    expect(ALLERGEN_CODES).toHaveLength(14);
    expect(isAllergenCode('sesame')).toBe(true);
    expect(isAllergenCode('bread')).toBe(false);
    for (const code of ALLERGEN_CODES) {
      const label = allergenLabel(code);
      expect(label.ru && label.kk && label.en).toBeTruthy();
    }
  });
});
