import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { ModifierGroupRule } from './modifiers';
import { assertQuantity, isInBranchMenu, PricingDish, priceLine, priceLines } from './pricing';
import { AVAILABLE, stopItem } from './stop-list';

const now = new Date('2026-10-01T06:00:00Z');

const size: ModifierGroupRule = {
  id: 'g-size',
  name: { ru: 'Размер порции', kk: 'Порция көлемі' },
  minSelect: 1,
  maxSelect: 1,
  isActive: true,
  options: [
    { id: 'o-std', name: { ru: 'Стандарт' }, price: Money.zero(), isDefault: true, isActive: true, sortOrder: 0 },
    { id: 'o-big', name: { ru: 'Большая' }, price: Money.tenge(1500), isDefault: false, isActive: true, sortOrder: 1 },
  ],
};
const extras: ModifierGroupRule = {
  id: 'g-extra',
  name: { ru: 'Добавки' },
  minSelect: 0,
  maxSelect: 3,
  isActive: true,
  options: [{ id: 'o-baursak', name: { ru: 'Баурсаки 5 шт.' }, price: Money.tenge(600), isDefault: false, isActive: true, sortOrder: 0 }],
};

function dish(overrides: Partial<PricingDish> = {}): PricingDish {
  return {
    dishId: 'd-besh',
    slug: 'beshbarmak',
    name: { ru: 'Бешбармак', kk: 'Ет' },
    categoryId: 'c-hot',
    photoUrl: null,
    weightGrams: 450,
    sku: 'POS-1',
    isActive: true,
    menuItem: { ...AVAILABLE, price: Money.tenge(4900) },
    groups: [size, extras],
    ...overrides,
  };
}

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).code;
  }
  return null;
}

describe('pricing', () => {
  it('unitPrice = branch price + options, lineTotal = unitPrice × qty', () => {
    const line = priceLine(dish(), { dishId: 'd-besh', quantity: 3, modifierOptionIds: ['o-baursak', 'o-big'] }, now);
    expect(line.basePrice.amount).toBe(490_000);
    expect(line.modifiers.map((m) => m.optionId)).toEqual(['o-big', 'o-baursak']);
    expect(line.unitPrice.amount).toBe(490_000 + 150_000 + 60_000);
    expect(line.lineTotal.amount).toBe(700_000 * 3);
    expect(line.sku).toBe('POS-1');
    expect(line.modifiers[0]).toMatchObject({ groupId: 'g-size', groupName: { ru: 'Размер порции', kk: 'Порция көлемі' } });
  });

  it('applies default option of required group when nothing selected', () => {
    const line = priceLine(dish(), { dishId: 'd-besh', quantity: 1, modifierOptionIds: [] }, now);
    expect(line.modifiers.map((m) => m.optionId)).toEqual(['o-std']);
    expect(line.unitPrice.amount).toBe(490_000);
  });

  it('quantity must be integer 1..99', () => {
    for (const quantity of [0, -1, 100, 1.5, Number.NaN]) {
      expect(codeOf(() => priceLine(dish(), { dishId: 'd-besh', quantity, modifierOptionIds: [] }, now))).toBe('catalog.quantity_invalid');
    }
    expect(assertQuantity(99)).toBe(99);
  });

  it('dish must be in the branch menu and active', () => {
    expect(codeOf(() => priceLine(undefined, { dishId: 'x', quantity: 1, modifierOptionIds: [] }, now))).toBe(
      'catalog.dish_not_in_branch_menu',
    );
    expect(codeOf(() => priceLine(dish({ menuItem: null }), { dishId: 'd-besh', quantity: 1, modifierOptionIds: [] }, now))).toBe(
      'catalog.dish_not_in_branch_menu',
    );
    expect(codeOf(() => priceLine(dish({ isActive: false }), { dishId: 'd-besh', quantity: 1, modifierOptionIds: [] }, now))).toBe(
      'catalog.dish_not_in_branch_menu',
    );
    expect(isInBranchMenu(dish())).toBe(true);
  });

  it('stopped dish is unavailable until the stop expires', () => {
    const stopped = stopItem(AVAILABLE, { until: new Date(now.getTime() + 3_600_000), source: 'manual', now }).state;
    const d = dish({ menuItem: { ...stopped, price: Money.tenge(4900) } });
    expect(codeOf(() => priceLine(d, { dishId: 'd-besh', quantity: 1, modifierOptionIds: [] }, now))).toBe('catalog.dish_unavailable');
    const later = new Date(now.getTime() + 3_600_000);
    expect(priceLine(d, { dishId: 'd-besh', quantity: 1, modifierOptionIds: [] }, later).unitPrice.amount).toBe(490_000);
  });

  it('options must belong to the dish and respect min/max', () => {
    expect(codeOf(() => priceLine(dish(), { dishId: 'd-besh', quantity: 1, modifierOptionIds: ['foreign'] }, now))).toBe(
      'catalog.modifier_invalid',
    );
    expect(codeOf(() => priceLine(dish(), { dishId: 'd-besh', quantity: 1, modifierOptionIds: ['o-std', 'o-big'] }, now))).toBe(
      'catalog.modifier_invalid',
    );
    expect(codeOf(() => priceLine(dish({ groups: [extras] }), { dishId: 'd-besh', quantity: 1, modifierOptionIds: ['o-std'] }, now))).toBe(
      'catalog.modifier_invalid',
    );
  });

  it('prices several lines independently', () => {
    const plov = dish({ dishId: 'd-plov', slug: 'plov', groups: [], menuItem: { ...AVAILABLE, price: Money.tenge(3200) } });
    const lines = priceLines(
      new Map([
        ['d-besh', dish()],
        ['d-plov', plov],
      ]),
      [
        { dishId: 'd-plov', quantity: 2, modifierOptionIds: [] },
        { dishId: 'd-besh', quantity: 1, modifierOptionIds: [] },
      ],
      now,
    );
    expect(lines.map((l) => l.lineTotal.amount)).toEqual([640_000, 490_000]);
    expect(Money.sum(lines.map((l) => l.lineTotal)).amount).toBe(1_130_000);
  });
});
