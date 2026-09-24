import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Money } from '../../../shared/kernel/money';
import { Permission } from '../../../shared/kernel/permissions';
import { BranchDirectory } from '../../identity/public';
import { assertMenuPrice, normalizeSku } from '../domain/dish';
import { BranchMenuItemRecord, BranchMenuRepository } from '../infrastructure/branch-menu.repository';
import { guardUnique } from '../infrastructure/db-errors';
import { DishRepository } from '../infrastructure/dish.repository';
import { CatalogEventPublisher } from './catalog-events';

/**
 * Меню филиала (BranchDishPrice): блюдо есть в меню филиала, только если есть позиция с ценой.
 * Цена и стоп-лист — всегда в разрезе филиала. Каждое изменение цены — в журнал «было/стало».
 * Права: menu.prices в филиале (управляющий — в своём, контент-менеджер и собственник — во всех).
 */
export const MAX_BULK_PRICES = 500;
const ENTITY = 'branch_dish_price';

async function assertBranchExists(branches: BranchDirectory, branchId: string): Promise<void> {
  if (!(await branches.find(branchId))) throw new NotFoundError('branch', branchId);
}

/** Код POS филиала: уникален в филиале и не совпадает с общим кодом другого блюда. */
async function validateBranchSku(
  sku: string | null,
  branchId: string,
  dishId: string,
  branchMenu: BranchMenuRepository,
  dishes: DishRepository,
): Promise<string | null> {
  if (!sku) return null;
  if ((await branchMenu.skuOwnerInBranch(branchId, sku, dishId)) || (await dishes.skuOwner(sku, dishId))) {
    throw new ConflictError('catalog.sku_taken', 'This POS code is already used by another dish', { sku });
  }
  return sku;
}

function priceView(item: Pick<BranchMenuItemRecord, 'price' | 'sku'>) {
  return { price: item.price.toJSON(), sku: item.sku };
}

@Injectable()
export class AddDishToBranchMenu {
  constructor(
    private readonly branchMenu: BranchMenuRepository,
    private readonly dishes: DishRepository,
    private readonly branches: BranchDirectory,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  async execute(actor: Actor, branchId: string, input: { dishId: string; price: Money; sku?: string | null }): Promise<void> {
    actor.assertCan(Permission.MenuPrices, branchId);
    await assertBranchExists(this.branches, branchId);
    const price = assertMenuPrice(input.price);
    await guardUnique(
      () =>
        this.database.transaction(async () => {
          const dish = await this.dishes.findById(input.dishId);
          if (!dish) throw new NotFoundError('dish', input.dishId);
          if (await this.branchMenu.find(branchId, dish.id)) {
            throw new ConflictError('catalog.dish_already_in_menu', 'Dish is already in the branch menu', { dishId: dish.id });
          }
          const sku = await validateBranchSku(normalizeSku(input.sku), branchId, dish.id, this.branchMenu, this.dishes);
          await this.branchMenu.insert({ id: newId(), branchId, dishId: dish.id, price, sku, updatedBy: actor.userId });
          await this.audit.record({
            action: 'menu.item_added',
            entityType: ENTITY,
            entityId: dish.id,
            branchId,
            after: { price: price.toJSON(), sku },
          });
          await this.events.menuChanged({ branchId, dishId: dish.id, categoryId: dish.categoryId });
        }),
      'catalog.dish_already_in_menu',
      'Dish is already in the branch menu',
    );
  }
}

@Injectable()
export class RemoveDishFromBranchMenu {
  constructor(
    private readonly branchMenu: BranchMenuRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, branchId: string, dishId: string): Promise<void> {
    actor.assertCan(Permission.MenuPrices, branchId);
    await this.database.transaction(async () => {
      const item = await this.branchMenu.findForUpdate(branchId, dishId);
      if (!item) throw new NotFoundError('branch_menu_item', dishId, { branchId });
      await this.branchMenu.softDelete(item.id, this.clock.now(), actor.userId);
      await this.audit.record({
        action: 'menu.item_removed',
        entityType: ENTITY,
        entityId: dishId,
        branchId,
        before: { ...priceView(item), availability: item.availability },
      });
      await this.events.menuChanged({ branchId, dishId });
    });
  }
}

@Injectable()
export class SetBranchDishPrice {
  constructor(
    private readonly branchMenu: BranchMenuRepository,
    private readonly dishes: DishRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  /** Цена блюда в филиале (и, при необходимости, код POS филиала). Без изменений — без записи в журнал. */
  async execute(actor: Actor, branchId: string, dishId: string, input: { price: Money; sku?: string | null }): Promise<void> {
    actor.assertCan(Permission.MenuPrices, branchId);
    const price = assertMenuPrice(input.price);
    await this.database.transaction(async () => {
      const item = await this.branchMenu.findForUpdate(branchId, dishId);
      if (!item) throw new NotFoundError('branch_menu_item', dishId, { branchId });
      let changed = false;
      if (!item.price.equals(price)) {
        await this.branchMenu.updatePrice(item.id, price, actor.userId);
        await this.audit.record({
          action: 'menu.price_changed',
          entityType: ENTITY,
          entityId: dishId,
          branchId,
          before: { price: item.price.toJSON() },
          after: { price: price.toJSON() },
        });
        changed = true;
      }
      if (input.sku !== undefined) {
        const sku = await validateBranchSku(normalizeSku(input.sku), branchId, dishId, this.branchMenu, this.dishes);
        if (sku !== item.sku) {
          await this.branchMenu.updateSku(item.id, sku, actor.userId);
          await this.audit.record({
            action: 'menu.item_sku_changed',
            entityType: ENTITY,
            entityId: dishId,
            branchId,
            before: { sku: item.sku },
            after: { sku },
          });
          changed = true;
        }
      }
      if (changed) await this.events.menuChanged({ branchId, dishId });
    });
  }
}

@Injectable()
export class BulkSetBranchPrices {
  constructor(
    private readonly branchMenu: BranchMenuRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  /** Массовое изменение цен меню филиала: всё или ничего (одна транзакция). */
  async execute(actor: Actor, branchId: string, items: Array<{ dishId: string; price: Money }>): Promise<{ updated: number; unchanged: number }> {
    actor.assertCan(Permission.MenuPrices, branchId);
    if (items.length === 0 || items.length > MAX_BULK_PRICES) {
      throw new ValidationError('catalog.bulk_size', `From 1 to ${MAX_BULK_PRICES} prices per request`, { max: MAX_BULK_PRICES });
    }
    const dishIds = items.map((i) => i.dishId);
    if (new Set(dishIds).size !== dishIds.length) throw new ValidationError('catalog.duplicate_ids', 'Dish listed twice');
    const prices = items.map((i) => ({ dishId: i.dishId, price: assertMenuPrice(i.price) }));
    return this.database.transaction(async () => {
      await this.database.advisoryLock('catalog.branch_menu', branchId);
      const current = new Map((await this.branchMenu.findMany(branchId, dishIds)).map((i) => [i.dishId, i]));
      const missing = dishIds.filter((id) => !current.has(id));
      if (missing.length > 0) {
        throw new ValidationError('catalog.dish_not_in_branch_menu', 'Some dishes are not in the branch menu', { dishIds: missing });
      }
      let updated = 0;
      for (const { dishId, price } of prices) {
        const item = current.get(dishId)!;
        if (item.price.equals(price)) continue;
        await this.branchMenu.updatePrice(item.id, price, actor.userId);
        await this.audit.record({
          action: 'menu.price_changed',
          entityType: ENTITY,
          entityId: dishId,
          branchId,
          before: { price: item.price.toJSON() },
          after: { price: price.toJSON() },
          meta: { bulk: true },
        });
        updated++;
      }
      if (updated > 0) await this.events.menuChanged({ branchId });
      return { updated, unchanged: prices.length - updated };
    });
  }
}

@Injectable()
export class CopyBranchMenu {
  constructor(
    private readonly branchMenu: BranchMenuRepository,
    private readonly branches: BranchDirectory,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
  ) {}

  /**
   * Копирование меню из филиала в филиал (запуск новой точки): недостающие блюда добавляются
   * с ценой источника; цены уже имеющихся — перезаписываются только при overwritePrices.
   * Стоп-лист и коды POS филиала не копируются — это состояние конкретной точки.
   */
  async execute(
    actor: Actor,
    input: { fromBranchId: string; toBranchId: string; overwritePrices: boolean },
  ): Promise<{ added: number; updated: number; unchanged: number }> {
    actor.assertCan(Permission.MenuPrices, input.toBranchId);
    if (input.fromBranchId === input.toBranchId) {
      throw new ValidationError('catalog.copy_same_branch', 'Source and target branch must differ');
    }
    await assertBranchExists(this.branches, input.fromBranchId);
    await assertBranchExists(this.branches, input.toBranchId);
    return this.database.transaction(async () => {
      await this.database.advisoryLock('catalog.branch_menu', input.toBranchId);
      const source = await this.branchMenu.listForBranch(input.fromBranchId);
      const target = new Map((await this.branchMenu.listForBranch(input.toBranchId)).map((i) => [i.dishId, i]));
      let added = 0;
      let updated = 0;
      let unchanged = 0;
      const meta = { copiedFrom: input.fromBranchId };
      for (const item of source) {
        const existing = target.get(item.dishId);
        if (!existing) {
          await this.branchMenu.insert({
            id: newId(),
            branchId: input.toBranchId,
            dishId: item.dishId,
            price: item.price,
            sku: null,
            updatedBy: actor.userId,
          });
          await this.audit.record({
            action: 'menu.item_added',
            entityType: ENTITY,
            entityId: item.dishId,
            branchId: input.toBranchId,
            after: { price: item.price.toJSON(), sku: null },
            meta,
          });
          added++;
        } else if (input.overwritePrices && !existing.price.equals(item.price)) {
          await this.branchMenu.updatePrice(existing.id, item.price, actor.userId);
          await this.audit.record({
            action: 'menu.price_changed',
            entityType: ENTITY,
            entityId: item.dishId,
            branchId: input.toBranchId,
            before: { price: existing.price.toJSON() },
            after: { price: item.price.toJSON() },
            meta,
          });
          updated++;
        } else {
          unchanged++;
        }
      }
      await this.audit.record({
        action: 'menu.branch_menu_copied',
        entityType: 'branch_menu',
        entityId: input.toBranchId,
        branchId: input.toBranchId,
        after: { fromBranchId: input.fromBranchId, overwritePrices: input.overwritePrices, added, updated, unchanged },
      });
      if (added + updated > 0) await this.events.menuChanged({ branchId: input.toBranchId });
      return { added, updated, unchanged };
    });
  }
}
