import { Injectable, Logger } from '@nestjs/common';
import { RequestContext } from '../../../shared/infrastructure/context/request-context';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { isUuid } from '../../../shared/kernel/ids';
import { BranchDirectory } from '../../identity/public';
import { normalizeSku } from '../domain/dish';
import { isRequiredGroup } from '../domain/modifiers';
import { isInBranchMenu, priceLines } from '../domain/pricing';
import { normalizeSearchQuery } from '../domain/search';
import { displayAvailability, effectiveAvailability, StopListMode } from '../domain/stop-list';
import { BranchMenuRepository } from '../infrastructure/branch-menu.repository';
import { CategoryRepository } from '../infrastructure/category.repository';
import { DishRepository } from '../infrastructure/dish.repository';
import { MenuReadRepository, MenuRow } from '../infrastructure/menu-read.repository';
import { ModifierRepository } from '../infrastructure/modifier.repository';
import {
  BranchOrderMenu,
  DishAvailability,
  DishCard,
  DishSummary,
  MenuPricing,
  MenuQuery,
  PricedLine,
  PricedLineRequest,
  StopListControl,
} from '../public';
import { ImageUrls } from './image-urls';
import { MenuSnapshotLoader } from './menu-snapshot';
import { SetDishAvailability } from './stop-list.actions';

/** Сколько позиций можно посчитать за один вызов (корзина, смета). */
export const MAX_PRICED_LINES = 200;

async function stopListMode(branches: BranchDirectory, branchId: string): Promise<StopListMode | null> {
  if (!isUuid(branchId)) return null;
  const branch = await branches.find(branchId);
  return branch ? branch.settings.stopListMode : null;
}

/** Расчёт позиций по актуальному меню филиала (корзина, телефонный заказ, смета банкета). */
@Injectable()
export class MenuPricingService extends MenuPricing {
  constructor(
    private readonly snapshots: MenuSnapshotLoader,
    private readonly branches: BranchDirectory,
    private readonly clock: Clock,
  ) {
    super();
  }

  async priceLines(branchId: string, lines: PricedLineRequest[]): Promise<PricedLine[]> {
    if (lines.length === 0) return [];
    if (lines.length > MAX_PRICED_LINES) {
      throw new ValidationError('catalog.too_many_lines', `At most ${MAX_PRICED_LINES} lines`, { max: MAX_PRICED_LINES });
    }
    const dishes = await this.snapshots.load(
      branchId,
      lines.map((l) => l.dishId),
    );
    return priceLines(dishes, lines, this.clock.now());
  }

  async checkAvailability(branchId: string, dishIds: string[]): Promise<Record<string, DishAvailability | 'not_in_menu'>> {
    const result: Record<string, DishAvailability | 'not_in_menu'> = {};
    const mode = await stopListMode(this.branches, branchId);
    const dishes = mode ? await this.snapshots.load(branchId, dishIds) : new Map();
    const now = this.clock.now();
    for (const id of dishIds) {
      const dish = dishes.get(id);
      result[id] = mode && isInBranchMenu(dish) ? displayAvailability(effectiveAvailability(dish.menuItem, now), mode) : 'not_in_menu';
    }
    return result;
  }
}

/** Поиск по меню филиала для конструктора сметы и телефонного заказа (включая блюда в стопе). */
@Injectable()
export class MenuQueryService extends MenuQuery {
  constructor(
    private readonly menu: MenuReadRepository,
    private readonly dishes: DishRepository,
    private readonly branches: BranchDirectory,
    private readonly images: ImageUrls,
    private readonly clock: Clock,
    private readonly modifiers: ModifierRepository,
    private readonly categories: CategoryRepository,
  ) {
    super();
  }

  private async summaries(rows: MenuRow[], mode: StopListMode): Promise<DishSummary[]> {
    const photos = await this.dishes.photosFor(rows.map((r) => r.dish.id));
    const now = this.clock.now();
    return rows.map((r) => ({
      dishId: r.dish.id,
      slug: r.dish.slug,
      name: r.dish.name,
      categoryId: r.dish.categoryId,
      price: r.item.price,
      availability: displayAvailability(effectiveAvailability(r.item, now), mode),
      photoUrl: this.images.url(photos.get(r.dish.id)?.[0], 'dishes'),
      weightGrams: r.dish.weightGrams,
    }));
  }

  async searchBranchDishes(branchId: string, query: string, limit = 20): Promise<DishSummary[]> {
    const mode = await stopListMode(this.branches, branchId);
    if (!mode) return [];
    const perPage = Math.min(Math.max(Math.trunc(limit) || 20, 1), 100);
    const { rows } = await this.menu.list(
      { branchId, now: this.clock.now(), hideStopped: false, q: normalizeSearchQuery(query) },
      { page: 1, perPage },
    );
    return this.summaries(rows, mode);
  }

  async getDishes(branchId: string, dishIds: string[]): Promise<DishSummary[]> {
    const mode = await stopListMode(this.branches, branchId);
    const ids = dishIds.filter((id) => isUuid(id));
    if (!mode || ids.length === 0) return [];
    const { rows } = await this.menu.list({ branchId, now: this.clock.now(), hideStopped: false, dishIds: ids });
    const byId = new Map((await this.summaries(rows, mode)).map((s) => [s.dishId, s]));
    return ids.map((id) => byId.get(id)).filter((s): s is DishSummary => !!s);
  }

  async describeDishes(dishIds: string[]): Promise<DishCard[]> {
    const ids = [...new Set(dishIds.filter((id) => isUuid(id)))];
    if (ids.length === 0) return [];
    const [records, photos] = await Promise.all([this.dishes.findManyByIds(ids), this.dishes.photosFor(ids)]);
    const byId = new Map(records.map((d) => [d.id, d]));
    return ids
      .map((id) => byId.get(id))
      .filter((d) => d !== undefined)
      .map((d) => ({
        dishId: d.id,
        slug: d.slug,
        name: d.name,
        photoUrl: this.images.url(photos.get(d.id)?.[0], 'dishes'),
        weightGrams: d.weightGrams,
      }));
  }

  async branchOrderMenu(branchId: string): Promise<BranchOrderMenu> {
    const mode = await stopListMode(this.branches, branchId);
    if (!mode) throw new NotFoundError('branch', branchId);
    const now = this.clock.now();
    const [{ rows }, categories] = await Promise.all([
      this.menu.list({ branchId, now, hideStopped: false }),
      this.categories.list({ activeOnly: true }),
    ]);
    const ids = rows.map((r) => r.dish.id);
    const [photos, groups] = await Promise.all([this.dishes.photosFor(ids), this.modifiers.groupsForDishes(ids)]);
    const used = new Set(rows.map((r) => r.dish.categoryId));
    return {
      branchId,
      categories: categories.filter((c) => used.has(c.id)).map((c) => ({ id: c.id, slug: c.slug, name: c.name })),
      dishes: rows.map((r) => {
        const stopped = effectiveAvailability(r.item, now) === 'stopped';
        return {
          dishId: r.dish.id,
          slug: r.dish.slug,
          categoryId: r.dish.categoryId,
          name: r.dish.name,
          price: r.item.price,
          availability: displayAvailability(effectiveAvailability(r.item, now), mode),
          stopped,
          stoppedUntil: stopped ? r.item.stoppedUntil : null,
          stopReason: stopped ? r.item.stopReason : null,
          photoUrl: this.images.url(photos.get(r.dish.id)?.[0], 'dishes'),
          weightGrams: r.dish.weightGrams,
          sku: r.item.sku ?? r.dish.sku,
          modifierGroups: (groups.get(r.dish.id) ?? [])
            .filter((g) => g.isActive && g.options.some((o) => o.isActive))
            .map((g) => ({
              id: g.id,
              name: g.name,
              minSelect: g.minSelect,
              maxSelect: g.maxSelect,
              isRequired: isRequiredGroup(g),
              options: g.options
                .filter((o) => o.isActive)
                .map((o) => ({ id: o.id, name: o.name, price: o.price, isDefault: o.isDefault })),
            })),
        };
      }),
    };
  }
}

/**
 * Управление стоп-листом извне (синхронизация с POS). Действие выполняется от имени текущего
 * актора (сотрудник или фоновая задача). Позиция не из меню сайта при синхронизации с POS
 * пропускается (в POS бывают позиции, которых нет на витрине), при ручном вызове — ошибка.
 */
@Injectable()
export class StopListControlService extends StopListControl {
  private readonly logger = new Logger(StopListControlService.name);

  constructor(
    private readonly setDishAvailability: SetDishAvailability,
    private readonly branchMenu: BranchMenuRepository,
    private readonly dishes: DishRepository,
  ) {
    super();
  }

  async setAvailability(branchId: string, dishId: string, available: boolean, source: 'manual' | 'pos'): Promise<void> {
    const contextActor = RequestContext.actor();
    const actor = contextActor && contextActor.kind !== 'guest' ? contextActor : Actor.system(`stop-list:${source}`);
    if (!isUuid(branchId) || !isUuid(dishId) || !(await this.branchMenu.find(branchId, dishId))) {
      if (source === 'pos') {
        this.logger.warn({ branchId, dishId }, 'POS stop-list item is not in the branch menu, skipped');
        return;
      }
      throw new ValidationError('catalog.dish_not_in_branch_menu', 'Dish is not in the branch menu', { dishId, branchId });
    }
    await this.setDishAvailability.execute(actor, { branchId, dishId, available, source });
  }

  async findDishIdBySku(sku: string): Promise<string | null> {
    const code = safeSku(sku);
    if (!code) return null;
    const owner = await this.dishes.skuOwner(code);
    if (owner) return owner;
    const byBranch = await this.branchMenu.dishIdsByBranchSku(code);
    return byBranch.length === 1 ? byBranch[0]! : null;
  }

  override async findDishIdBySkuInBranch(branchId: string, sku: string): Promise<string | null> {
    const code = safeSku(sku);
    if (!code) return null;
    if (isUuid(branchId)) {
      const own = await this.branchMenu.skuOwnerInBranch(branchId, code);
      if (own) return own;
    }
    return this.dishes.skuOwner(code);
  }
}

function safeSku(sku: string): string | null {
  try {
    return normalizeSku(sku);
  } catch {
    return null;
  }
}
