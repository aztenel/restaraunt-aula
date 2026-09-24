import { Injectable } from '@nestjs/common';
import { Selectable, sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Currency, Money } from '../../../shared/kernel/money';
import { MenuItemAvailability, StopListState, StopSource } from '../domain/stop-list';
import { BranchMenuItemsTable, CatalogTables } from './catalog.tables';

/** Позиция меню филиала (BranchDishPrice): цена и стоп-лист в разрезе филиала. */
export interface BranchMenuItemRecord extends StopListState {
  id: string;
  branchId: string;
  dishId: string;
  price: Money;
  sku: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function mapMenuItem(row: Selectable<BranchMenuItemsTable>): BranchMenuItemRecord {
  return {
    id: row.id,
    branchId: row.branch_id,
    dishId: row.dish_id,
    price: Money.of(row.price_amount, row.price_currency as Currency),
    availability: row.availability as MenuItemAvailability,
    stoppedUntil: row.stopped_until,
    stopReason: row.stop_reason,
    stopSource: row.stop_source as StopSource | null,
    stoppedAt: row.stopped_at,
    sku: row.sku,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class BranchMenuRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<CatalogTables>();
  }

  async find(branchId: string, dishId: string): Promise<BranchMenuItemRecord | null> {
    const row = await this.db()
      .selectFrom('catalog.branch_menu_items')
      .selectAll()
      .where('branch_id', '=', branchId)
      .where('dish_id', '=', dishId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? mapMenuItem(row) : null;
  }

  /** С блокировкой строки до конца транзакции (конкурентные изменения цены и стоп-листа). */
  async findForUpdate(branchId: string, dishId: string): Promise<BranchMenuItemRecord | null> {
    const row = await this.db()
      .selectFrom('catalog.branch_menu_items')
      .selectAll()
      .where('branch_id', '=', branchId)
      .where('dish_id', '=', dishId)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    return row ? mapMenuItem(row) : null;
  }

  async findMany(branchId: string, dishIds: readonly string[]): Promise<BranchMenuItemRecord[]> {
    if (dishIds.length === 0) return [];
    const rows = await this.db()
      .selectFrom('catalog.branch_menu_items')
      .selectAll()
      .where('branch_id', '=', branchId)
      .where('dish_id', 'in', [...dishIds])
      .where('deleted_at', 'is', null)
      .execute();
    return rows.map(mapMenuItem);
  }

  async listForBranch(branchId: string): Promise<BranchMenuItemRecord[]> {
    const rows = await this.db()
      .selectFrom('catalog.branch_menu_items')
      .selectAll()
      .where('branch_id', '=', branchId)
      .where('deleted_at', 'is', null)
      .execute();
    return rows.map(mapMenuItem);
  }

  async listForDish(dishId: string): Promise<BranchMenuItemRecord[]> {
    const rows = await this.db()
      .selectFrom('catalog.branch_menu_items')
      .selectAll()
      .where('dish_id', '=', dishId)
      .where('deleted_at', 'is', null)
      .orderBy('branch_id')
      .execute();
    return rows.map(mapMenuItem);
  }

  async insert(item: { id: string; branchId: string; dishId: string; price: Money; sku: string | null; updatedBy: string | null }): Promise<void> {
    await this.db()
      .insertInto('catalog.branch_menu_items')
      .values({
        id: item.id,
        branch_id: item.branchId,
        dish_id: item.dishId,
        price_amount: item.price.amount,
        price_currency: item.price.currency,
        availability: 'available',
        stopped_until: null,
        stop_reason: null,
        stop_source: null,
        stopped_at: null,
        sku: item.sku,
        updated_by: item.updatedBy,
        deleted_at: null,
      })
      .execute();
  }

  async updatePrice(id: string, price: Money, updatedBy: string | null): Promise<void> {
    await this.db()
      .updateTable('catalog.branch_menu_items')
      .set({ price_amount: price.amount, price_currency: price.currency, updated_by: updatedBy })
      .where('id', '=', id)
      .execute();
  }

  async updateSku(id: string, sku: string | null, updatedBy: string | null): Promise<void> {
    await this.db().updateTable('catalog.branch_menu_items').set({ sku, updated_by: updatedBy }).where('id', '=', id).execute();
  }

  async updateStopState(id: string, state: StopListState, updatedBy: string | null): Promise<void> {
    await this.db()
      .updateTable('catalog.branch_menu_items')
      .set({
        availability: state.availability,
        stopped_until: state.stoppedUntil,
        stop_reason: state.stopReason,
        stop_source: state.stopSource,
        stopped_at: state.stoppedAt,
        updated_by: updatedBy,
      })
      .where('id', '=', id)
      .execute();
  }

  async softDelete(id: string, at: Date, updatedBy: string | null): Promise<void> {
    await this.db().updateTable('catalog.branch_menu_items').set({ deleted_at: at, updated_by: updatedBy }).where('id', '=', id).execute();
  }

  /** Убрать блюдо из меню всех филиалов (удаление блюда). Возвращает затронутые позиции. */
  async softDeleteAllForDish(dishId: string, at: Date, updatedBy: string | null): Promise<BranchMenuItemRecord[]> {
    const rows = await this.db()
      .updateTable('catalog.branch_menu_items')
      .set({ deleted_at: at, updated_by: updatedBy })
      .where('dish_id', '=', dishId)
      .where('deleted_at', 'is', null)
      .returningAll()
      .execute();
    return rows.map(mapMenuItem);
  }

  /** Чей код POS в филиале (кроме блюда exceptDishId). */
  async skuOwnerInBranch(branchId: string, sku: string, exceptDishId?: string): Promise<string | null> {
    let q = this.db()
      .selectFrom('catalog.branch_menu_items')
      .select('dish_id')
      .where('branch_id', '=', branchId)
      .where('sku', '=', sku)
      .where('deleted_at', 'is', null);
    if (exceptDishId) q = q.where('dish_id', '!=', exceptDishId);
    return (await q.executeTakeFirst())?.dish_id ?? null;
  }

  /** Блюда, у которых код POS переопределён в каком-либо филиале. */
  async dishIdsByBranchSku(sku: string): Promise<string[]> {
    const rows = await this.db()
      .selectFrom('catalog.branch_menu_items')
      .select('dish_id')
      .distinct()
      .where('sku', '=', sku)
      .where('deleted_at', 'is', null)
      .execute();
    return rows.map((r) => r.dish_id);
  }

  /** Стопы с истёкшим «до» — для автоматического возврата. */
  async expiredStops(now: Date, limit = 500): Promise<BranchMenuItemRecord[]> {
    const rows = await this.db()
      .selectFrom('catalog.branch_menu_items')
      .selectAll()
      .where('deleted_at', 'is', null)
      .where('availability', '=', 'stopped')
      .where('stopped_until', 'is not', null)
      .where('stopped_until', '<=', now)
      .orderBy('stopped_until')
      .limit(limit)
      .execute();
    return rows.map(mapMenuItem);
  }

  /** Последнее изменение меню по филиалам (для sitemap). */
  async lastChangedByBranch(): Promise<Map<string, Date>> {
    const rows = await this.db()
      .selectFrom('catalog.branch_menu_items')
      .select(['branch_id', sql<Date>`max(updated_at)`.as('at')])
      .where('deleted_at', 'is', null)
      .groupBy('branch_id')
      .execute();
    return new Map(rows.map((r) => [r.branch_id, r.at]));
  }
}
