import { translate, Translatable } from '../../../shared/kernel/translatable';
import { MissingMapping } from './order-export';
import { PosOrderLine, PosOrderModifierLine } from './pos-client';
import { DishMapping } from './product-mapping';

/** Позиция заказа для кухни (подмножество KitchenOrder.items). */
export interface KitchenLineInput {
  dishId: string;
  name: Translatable;
  quantity: number;
  modifiers: Array<{ optionId: string; name: Translatable }>;
}

export interface ResolvedOrderLines {
  lines: PosOrderLine[];
  /** Блюда и опции без сопоставления: заказ в POS не передаётся, персонал оповещается. */
  missing: MissingMapping[];
}

/**
 * Сопоставление позиций заказа с товарами POS. Передаём заказ только целиком:
 * если хотя бы у одного блюда или опции нет сопоставления — заказ не передаётся (кухня
 * не должна получить заказ без части позиций или добавок).
 */
export function resolveOrderLines(items: readonly KitchenLineInput[], mappings: readonly DishMapping[]): ResolvedOrderLines {
  const byDish = new Map(mappings.map((m) => [m.dishId, m]));
  const lines: PosOrderLine[] = [];
  const missingByDish = new Map<string, MissingMapping>();

  for (const item of items) {
    const mapping = byDish.get(item.dishId);
    const dishName = translate(item.name, 'ru') || item.dishId;
    const modifiers = new Map<string, PosOrderModifierLine>();
    const missingOptions: Array<{ optionId: string; name: string }> = [];

    for (const option of item.modifiers) {
      const target = mapping?.modifiers[option.optionId];
      if (!target) {
        if (!missingOptions.some((o) => o.optionId === option.optionId)) {
          missingOptions.push({ optionId: option.optionId, name: translate(option.name, 'ru') || option.optionId });
        }
        continue;
      }
      // Одна и та же опция несколько раз — одна строка модификатора с количеством.
      const existing = modifiers.get(option.optionId);
      if (existing) existing.amount += 1;
      else {
        modifiers.set(option.optionId, {
          optionId: option.optionId,
          externalProductId: target.externalProductId,
          externalGroupId: target.externalGroupId,
          amount: 1,
        });
      }
    }

    if (!mapping || missingOptions.length > 0) {
      const entry = missingByDish.get(item.dishId) ?? { dishId: item.dishId, dishName, dishMissing: !mapping, options: [] };
      for (const option of missingOptions) {
        if (!entry.options.some((o) => o.optionId === option.optionId)) entry.options.push(option);
      }
      missingByDish.set(item.dishId, entry);
      continue;
    }

    lines.push({
      dishId: item.dishId,
      externalProductId: mapping.externalProductId,
      quantity: item.quantity,
      name: dishName,
      modifiers: [...modifiers.values()],
    });
  }

  return { lines, missing: [...missingByDish.values()] };
}

/** Текст для персонала: какие блюда и опции нужно сопоставить. */
export function describeMissing(missing: readonly MissingMapping[]): string {
  return missing
    .map((m) => {
      const options = m.options.map((o) => o.name).join(', ');
      if (m.dishMissing) return options ? `${m.dishName} (и опции: ${options})` : m.dishName;
      return `${m.dishName}: опции ${options}`;
    })
    .join('; ');
}
