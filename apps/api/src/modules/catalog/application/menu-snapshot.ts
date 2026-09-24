import { Injectable } from '@nestjs/common';
import { isUuid } from '../../../shared/kernel/ids';
import { ModifierGroupRule } from '../domain/modifiers';
import { PricingDish } from '../domain/pricing';
import { BranchMenuRepository } from '../infrastructure/branch-menu.repository';
import { CategoryRepository } from '../infrastructure/category.repository';
import { DishRepository } from '../infrastructure/dish.repository';
import { ModifierGroupRecord, ModifierRepository } from '../infrastructure/modifier.repository';
import { ImageUrls } from './image-urls';

export function toGroupRule(group: ModifierGroupRecord): ModifierGroupRule {
  return {
    id: group.id,
    name: group.name,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    isActive: group.isActive,
    options: group.options.map((o) => ({
      id: o.id,
      name: o.name,
      price: o.price,
      isDefault: o.isDefault,
      isActive: o.isActive,
      sortOrder: o.sortOrder,
    })),
  };
}

/**
 * Снимок меню филиала для расчёта позиций: блюдо, его позиция в меню филиала (цена, стоп-лист),
 * группы модификаторов, обложка и код POS. Один набор запросов на всю корзину.
 */
@Injectable()
export class MenuSnapshotLoader {
  constructor(
    private readonly dishes: DishRepository,
    private readonly categories: CategoryRepository,
    private readonly branchMenu: BranchMenuRepository,
    private readonly modifiers: ModifierRepository,
    private readonly images: ImageUrls,
  ) {}

  async load(branchId: string, dishIds: readonly string[]): Promise<Map<string, PricingDish>> {
    const ids = [...new Set(dishIds.filter((id) => isUuid(id)))];
    const result = new Map<string, PricingDish>();
    if (ids.length === 0 || !isUuid(branchId)) return result;
    const [dishes, categories, items, groups, photos] = await Promise.all([
      this.dishes.findManyByIds(ids),
      this.categories.list(),
      this.branchMenu.findMany(branchId, ids),
      this.modifiers.groupsForDishes(ids),
      this.dishes.photosFor(ids),
    ]);
    const activeCategories = new Set(categories.filter((c) => c.isActive).map((c) => c.id));
    const itemByDish = new Map(items.map((i) => [i.dishId, i]));
    for (const dish of dishes) {
      const item = itemByDish.get(dish.id) ?? null;
      const cover = photos.get(dish.id)?.[0];
      result.set(dish.id, {
        dishId: dish.id,
        slug: dish.slug,
        name: dish.name,
        categoryId: dish.categoryId,
        photoUrl: cover ? this.images.url(cover, 'dishes') : null,
        weightGrams: dish.weightGrams,
        sku: item?.sku ?? dish.sku,
        isActive: dish.isActive && activeCategories.has(dish.categoryId),
        menuItem: item
          ? {
              price: item.price,
              availability: item.availability,
              stoppedUntil: item.stoppedUntil,
              stopReason: item.stopReason,
              stopSource: item.stopSource,
              stoppedAt: item.stoppedAt,
            }
          : null,
        groups: (groups.get(dish.id) ?? []).map(toGroupRule),
      });
    }
    return result;
  }
}
