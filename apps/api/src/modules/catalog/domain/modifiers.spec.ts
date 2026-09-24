import { describe, expect, it } from 'vitest';
import { Money } from '../../../shared/kernel/money';
import { isRequiredGroup, ModifierGroupRule, resolveModifierSelection, validateModifierGroupConfig } from './modifiers';

function option(id: string, price = 0, extra: Partial<{ isDefault: boolean; isActive: boolean }> = {}) {
  return { id, name: { ru: id }, price: Money.tenge(price), isDefault: false, isActive: true, sortOrder: 0, ...extra };
}

const size: ModifierGroupRule = {
  id: 'size',
  name: { ru: 'Размер порции' },
  minSelect: 1,
  maxSelect: 1,
  isActive: true,
  options: [option('standard', 0, { isDefault: true }), option('large', 1500)],
};
const sauce: ModifierGroupRule = {
  id: 'sauce',
  name: { ru: 'Соус' },
  minSelect: 0,
  maxSelect: 2,
  isActive: true,
  options: [option('garlic', 300), option('tomato', 300), option('spicy', 350), option('old', 100, { isActive: false })],
};

describe('modifier group config', () => {
  it('required = min >= 1', () => {
    expect(isRequiredGroup(size)).toBe(true);
    expect(isRequiredGroup(sauce)).toBe(false);
  });

  it('accepts valid config', () => {
    expect(() => validateModifierGroupConfig(size)).not.toThrow();
    expect(() => validateModifierGroupConfig(sauce)).not.toThrow();
  });

  it('rejects inconsistent bounds, empty groups and extra defaults', () => {
    const reason = (fn: () => void) => {
      try {
        fn();
      } catch (e) {
        return (e as { details: { reason: string } }).details.reason;
      }
      return null;
    };
    expect(reason(() => validateModifierGroupConfig({ ...size, minSelect: 2, maxSelect: 1 }))).toBe('min_greater_than_max');
    expect(reason(() => validateModifierGroupConfig({ ...size, maxSelect: 0 }))).toBe('bounds');
    expect(reason(() => validateModifierGroupConfig({ ...size, maxSelect: 21 }))).toBe('bounds');
    expect(reason(() => validateModifierGroupConfig({ ...size, options: [] }))).toBe('no_options');
    expect(reason(() => validateModifierGroupConfig({ ...size, minSelect: 3, maxSelect: 3 }))).toBe('min_exceeds_options');
    expect(
      reason(() =>
        validateModifierGroupConfig({ ...size, options: [option('a', 0, { isDefault: true }), option('b', 0, { isDefault: true })] }),
      ),
    ).toBe('too_many_defaults');
  });
});

describe('modifier selection', () => {
  it('applies defaults to required groups when nothing selected; optional stays empty', () => {
    const result = resolveModifierSelection([size, sauce], []);
    expect(result.map((r) => r.option.id)).toEqual(['standard']);
  });

  it('explicit selection replaces default and keeps group/option order', () => {
    const result = resolveModifierSelection([size, sauce], ['tomato', 'large', 'garlic']);
    expect(result.map((r) => r.option.id)).toEqual(['large', 'garlic', 'tomato']);
  });

  it('rejects options of other dishes, inactive options, duplicates', () => {
    expect(() => resolveModifierSelection([size], ['garlic'])).toThrow(/does not belong/);
    expect(() => resolveModifierSelection([size, sauce], ['old'])).toThrow(/does not belong/);
    expect(() => resolveModifierSelection([size, sauce], ['garlic', 'garlic'])).toThrow(/twice/);
  });

  it('enforces min/max per group', () => {
    expect(() => resolveModifierSelection([size], ['standard', 'large'])).toThrow(/Too many/);
    expect(() => resolveModifierSelection([sauce], ['garlic', 'tomato', 'spicy'])).toThrow(/Too many/);
    const noDefault = { ...size, options: [option('s'), option('l')] };
    expect(() => resolveModifierSelection([noDefault], [])).toThrow(/not selected/);
    try {
      resolveModifierSelection([noDefault], [], { dishId: 'd1' });
    } catch (e) {
      expect((e as { code: string }).code).toBe('catalog.modifier_invalid');
      expect((e as { details: Record<string, unknown> }).details).toMatchObject({ reason: 'too_few', dishId: 'd1', groupId: 'size' });
    }
  });

  it('inactive group is ignored (not linked effectively)', () => {
    const inactive = { ...size, isActive: false };
    expect(resolveModifierSelection([inactive, sauce], [])).toEqual([]);
    expect(() => resolveModifierSelection([inactive], ['large'])).toThrow(/does not belong/);
  });
});
