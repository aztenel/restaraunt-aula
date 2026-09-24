import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { offsetOf, Page, pageOf, PageRequest } from '../../../shared/kernel/pagination';
import { DishMapping, ModifierMapping, parseModifierMappings } from '../domain/product-mapping';
import { PosTables, ProductMappingsTable } from './pos.tables';

export interface ProductMappingRecord {
  id: string;
  branchId: string;
  dishId: string;
  provider: string;
  externalProductId: string;
  externalName: string | null;
  modifiers: Record<string, ModifierMapping>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductMappingWrite {
  externalProductId: string;
  externalName: string | null;
  modifiers: Record<string, ModifierMapping>;
}

export interface ProductMappingFilter {
  branchIds: 'all' | string[];
  provider?: string;
  dishId?: string;
  externalProductId?: string;
}

function toRecord(row: Selectable<ProductMappingsTable>): ProductMappingRecord {
  return {
    id: row.id,
    branchId: row.branch_id,
    dishId: row.dish_id,
    provider: row.provider,
    externalProductId: row.external_product_id,
    externalName: row.external_name,
    modifiers: parseModifierMappings(row.modifier_mappings),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class ProductMappingRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<PosTables>();
  }

  private active() {
    return this.db().selectFrom('pos.product_mappings').where('deleted_at', 'is', null);
  }

  async findById(id: string): Promise<ProductMappingRecord | null> {
    const row = await this.active().selectAll().where('id', '=', id).executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async findActive(branchId: string, provider: string, dishId: string): Promise<ProductMappingRecord | null> {
    const row = await this.active()
      .selectAll()
      .where('branch_id', '=', branchId)
      .where('provider', '=', provider)
      .where('dish_id', '=', dishId)
      .executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  /** Сопоставления блюд заказа (для передачи в POS). */
  async forDishes(branchId: string, provider: string, dishIds: string[]): Promise<DishMapping[]> {
    if (dishIds.length === 0) return [];
    const rows = await this.active()
      .select(['dish_id', 'external_product_id', 'modifier_mappings'])
      .where('branch_id', '=', branchId)
      .where('provider', '=', provider)
      .where('dish_id', 'in', [...new Set(dishIds)])
      .execute();
    return rows.map((r) => ({ dishId: r.dish_id, externalProductId: r.external_product_id, modifiers: parseModifierMappings(r.modifier_mappings) }));
  }

  /** Все сопоставления филиала (для стоп-листа). */
  async listForBranch(branchId: string, provider: string): Promise<Array<{ dishId: string; externalProductId: string }>> {
    const rows = await this.active()
      .select(['dish_id', 'external_product_id'])
      .where('branch_id', '=', branchId)
      .where('provider', '=', provider)
      .orderBy('dish_id')
      .execute();
    return rows.map((r) => ({ dishId: r.dish_id, externalProductId: r.external_product_id }));
  }

  async list(filter: ProductMappingFilter, page: PageRequest): Promise<Page<ProductMappingRecord>> {
    if (filter.branchIds !== 'all' && filter.branchIds.length === 0) return pageOf([], 0, page);
    let q = this.active();
    if (filter.branchIds !== 'all') q = q.where('branch_id', 'in', filter.branchIds);
    if (filter.provider) q = q.where('provider', '=', filter.provider);
    if (filter.dishId) q = q.where('dish_id', '=', filter.dishId);
    if (filter.externalProductId) q = q.where('external_product_id', '=', filter.externalProductId);
    const total = await q.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirst();
    const rows = await q.selectAll().orderBy('created_at', 'desc').orderBy('id').limit(page.perPage).offset(offsetOf(page)).execute();
    return pageOf(rows.map(toRecord), Number(total?.n ?? 0), page);
  }

  /** Число сопоставлений по филиалам и провайдерам: ключ `${branchId}|${provider}`. */
  async countsByBranch(branchIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (branchIds.length === 0) return result;
    const rows = await this.active()
      .select(['branch_id', 'provider', (eb) => eb.fn.countAll<string>().as('n')])
      .where('branch_id', 'in', branchIds)
      .groupBy(['branch_id', 'provider'])
      .execute();
    for (const r of rows) result.set(`${r.branch_id}|${r.provider}`, Number(r.n));
    return result;
  }

  /** Товар POS -> блюда, с которыми он сопоставлен. */
  async dishesByExternal(branchId: string, provider: string, externalIds?: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (externalIds && externalIds.length === 0) return result;
    let q = this.active().select(['dish_id', 'external_product_id']).where('branch_id', '=', branchId).where('provider', '=', provider);
    if (externalIds) q = q.where('external_product_id', 'in', externalIds);
    for (const r of await q.execute()) {
      result.set(r.external_product_id, [...(result.get(r.external_product_id) ?? []), r.dish_id]);
    }
    return result;
  }

  async mappedDishIds(branchId: string, provider: string): Promise<Set<string>> {
    const rows = await this.active().select('dish_id').where('branch_id', '=', branchId).where('provider', '=', provider).execute();
    return new Set(rows.map((r) => r.dish_id));
  }

  async insert(input: { id: string; branchId: string; dishId: string; provider: string; now: Date } & ProductMappingWrite): Promise<void> {
    await this.db()
      .insertInto('pos.product_mappings')
      .values({
        id: input.id,
        branch_id: input.branchId,
        dish_id: input.dishId,
        provider: input.provider,
        external_product_id: input.externalProductId,
        external_name: input.externalName,
        modifier_mappings: JSON.stringify(input.modifiers),
        created_at: input.now,
        deleted_at: null,
      })
      .execute();
  }

  async update(id: string, data: ProductMappingWrite): Promise<void> {
    await this.db()
      .updateTable('pos.product_mappings')
      .set({
        external_product_id: data.externalProductId,
        external_name: data.externalName,
        modifier_mappings: JSON.stringify(data.modifiers),
      })
      .where('id', '=', id)
      .execute();
  }

  async softDelete(id: string, now: Date): Promise<void> {
    await this.db().updateTable('pos.product_mappings').set({ deleted_at: now }).where('id', '=', id).execute();
  }
}
