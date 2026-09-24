import { ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { Translatable } from '../../../shared/kernel/translatable';
import { PricedLine, PricedLineRequest } from '../public';
import { ModifierGroupRule, resolveModifierSelection } from './modifiers';
import { effectiveAvailability, StopListState } from './stop-list';

/**
 * Расчёт позиции по меню филиала (сервер — единственный источник цены):
 * - блюдо должно быть в меню филиала (есть строка цены, блюдо и категория активны);
 * - блюдо не в стоп-листе (с учётом истёкшего «до»);
 * - количество — целое 1..99;
 * - опции модификаторов — только из групп блюда, min/max и обязательность соблюдены;
 * - unitPrice = цена филиала + сумма опций; lineTotal = unitPrice × количество.
 */
export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 99;

export interface PricingDish {
  dishId: string;
  slug: string;
  name: Translatable;
  categoryId: string;
  photoUrl: string | null;
  weightGrams: number | null;
  /** Код POS: переопределение филиала или общий код блюда. */
  sku: string | null;
  /** Блюдо и его категория активны и не удалены. */
  isActive: boolean;
  /** Позиция меню филиала; null — блюда нет в меню филиала. */
  menuItem: (StopListState & { price: Money }) | null;
  /** Группы модификаторов блюда в порядке привязки. */
  groups: ModifierGroupRule[];
}

export function assertQuantity(quantity: unknown, dishId?: string): number {
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < MIN_QUANTITY || quantity > MAX_QUANTITY) {
    throw new ValidationError('catalog.quantity_invalid', `Quantity must be an integer ${MIN_QUANTITY}..${MAX_QUANTITY}`, {
      dishId,
      quantity,
    });
  }
  return quantity;
}

/** Есть ли блюдо в меню филиала (для публичной витрины, поиска и проверки корзины). */
export function isInBranchMenu(dish: PricingDish | undefined | null): dish is PricingDish & { menuItem: NonNullable<PricingDish['menuItem']> } {
  return !!dish && dish.isActive && dish.menuItem !== null;
}

export function priceLine(dish: PricingDish | undefined, request: PricedLineRequest, now: Date): PricedLine {
  const quantity = assertQuantity(request.quantity, request.dishId);
  if (!isInBranchMenu(dish)) {
    throw new ValidationError('catalog.dish_not_in_branch_menu', 'Dish is not in the branch menu', { dishId: request.dishId });
  }
  if (effectiveAvailability(dish.menuItem, now) !== 'available') {
    throw new ValidationError('catalog.dish_unavailable', 'Dish is in the stop-list', { dishId: request.dishId });
  }
  if (!Array.isArray(request.modifierOptionIds)) {
    throw new ValidationError('catalog.modifier_invalid', 'modifierOptionIds must be an array', { dishId: request.dishId, reason: 'format' });
  }
  const resolved = resolveModifierSelection(dish.groups, request.modifierOptionIds, { dishId: dish.dishId });
  const basePrice = dish.menuItem.price;
  const modifiers = resolved.map(({ group, option }) => ({
    groupId: group.id,
    groupName: group.name,
    optionId: option.id,
    optionName: option.name,
    price: option.price,
  }));
  const unitPrice = modifiers.reduce((acc, m) => acc.add(m.price), basePrice);
  return {
    dishId: dish.dishId,
    dishSlug: dish.slug,
    dishName: dish.name,
    categoryId: dish.categoryId,
    photoUrl: dish.photoUrl,
    weightGrams: dish.weightGrams,
    quantity,
    basePrice,
    modifiers,
    unitPrice,
    lineTotal: unitPrice.multiply(quantity),
    sku: dish.sku,
  };
}

/** Позиции заказа/сметы: каждая строка считается независимо, первая ошибка прерывает расчёт. */
export function priceLines(dishes: ReadonlyMap<string, PricingDish>, requests: readonly PricedLineRequest[], now: Date): PricedLine[] {
  return requests.map((r) => priceLine(dishes.get(r.dishId), r, now));
}
