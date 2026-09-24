import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Currency, Money } from '../../../shared/kernel/money';
import { Translatable } from '../../../shared/kernel/translatable';
import { CatalogTables, ModifierGroupsTable, ModifierOptionsTable } from './catalog.tables';

export interface ModifierOptionRecord {
  id: string;
  groupId: string;
  name: Translatable;
  price: Money;
  isDefault: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface ModifierGroupRecord {
  id: string;
  code: string;
  name: Translatable;
  description: Translatable;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  isActive: boolean;
  options: ModifierOptionRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ModifierGroupWrite {
  code: string;
  name: Translatable;
  description: Translatable;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  isActive: boolean;
}

export type ModifierOptionWrite = Omit<ModifierOptionRecord, 'groupId'>;

function mapOption(row: Selectable<ModifierOptionsTable>): ModifierOptionRecord {
  return {
    id: row.id,
    groupId: row.group_id,
    name: row.name as Translatable,
    price: Money.of(row.price_amount, row.price_currency as Currency),
    isDefault: row.is_default,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

function mapGroup(row: Selectable<ModifierGroupsTable>, options: ModifierOptionRecord[]): ModifierGroupRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name as Translatable,
    description: (row.description ?? {}) as Translatable,
    minSelect: row.min_select,
    maxSelect: row.max_select,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    options,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class ModifierRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<CatalogTables>();
  }

  private async withOptions(rows: Array<Selectable<ModifierGroupsTable>>): Promise<ModifierGroupRecord[]> {
    if (rows.length === 0) return [];
    const options = await this.db()
      .selectFrom('catalog.modifier_options')
      .selectAll()
      .where(
        'group_id',
        'in',
        rows.map((r) => r.id),
      )
      .where('deleted_at', 'is', null)
      .orderBy('sort_order')
      .orderBy('created_at')
      .execute();
    const byGroup = new Map<string, ModifierOptionRecord[]>();
    for (const o of options) byGroup.set(o.group_id, [...(byGroup.get(o.group_id) ?? []), mapOption(o)]);
    return rows.map((r) => mapGroup(r, byGroup.get(r.id) ?? []));
  }

  async findById(id: string): Promise<ModifierGroupRecord | null> {
    const row = await this.db()
      .selectFrom('catalog.modifier_groups')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? ((await this.withOptions([row]))[0] ?? null) : null;
  }

  async findByCode(code: string): Promise<ModifierGroupRecord | null> {
    const row = await this.db()
      .selectFrom('catalog.modifier_groups')
      .selectAll()
      .where('code', '=', code)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? ((await this.withOptions([row]))[0] ?? null) : null;
  }

  async codeTaken(code: string, exceptId?: string): Promise<boolean> {
    let q = this.db().selectFrom('catalog.modifier_groups').select('id').where('code', '=', code).where('deleted_at', 'is', null);
    if (exceptId) q = q.where('id', '!=', exceptId);
    return !!(await q.executeTakeFirst());
  }

  async list(): Promise<ModifierGroupRecord[]> {
    const rows = await this.db()
      .selectFrom('catalog.modifier_groups')
      .selectAll()
      .where('deleted_at', 'is', null)
      .orderBy('sort_order')
      .orderBy('created_at')
      .execute();
    return this.withOptions(rows);
  }

  async findByIds(ids: readonly string[]): Promise<ModifierGroupRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.db()
      .selectFrom('catalog.modifier_groups')
      .selectAll()
      .where('id', 'in', [...ids])
      .where('deleted_at', 'is', null)
      .execute();
    return this.withOptions(rows);
  }

  /** Группы модификаторов блюд в порядке привязки к блюду. */
  async groupsForDishes(dishIds: readonly string[]): Promise<Map<string, ModifierGroupRecord[]>> {
    const result = new Map<string, ModifierGroupRecord[]>();
    if (dishIds.length === 0) return result;
    const links = await this.db()
      .selectFrom('catalog.dish_modifier_groups')
      .select(['dish_id', 'group_id'])
      .where('dish_id', 'in', [...dishIds])
      .orderBy('dish_id')
      .orderBy('sort_order')
      .execute();
    const groups = new Map((await this.findByIds([...new Set(links.map((l) => l.group_id))])).map((g) => [g.id, g]));
    for (const link of links) {
      const group = groups.get(link.group_id);
      if (group) result.set(link.dish_id, [...(result.get(link.dish_id) ?? []), group]);
    }
    return result;
  }

  async dishIdsUsing(groupId: string): Promise<string[]> {
    const rows = await this.db().selectFrom('catalog.dish_modifier_groups').select('dish_id').where('group_id', '=', groupId).execute();
    return rows.map((r) => r.dish_id);
  }

  async dishCounts(): Promise<Map<string, number>> {
    const rows = await this.db()
      .selectFrom('catalog.dish_modifier_groups as l')
      .innerJoin('catalog.dishes as d', 'd.id', 'l.dish_id')
      .select(['l.group_id', (eb) => eb.fn.countAll<string>().as('n')])
      .where('d.deleted_at', 'is', null)
      .groupBy('l.group_id')
      .execute();
    return new Map(rows.map((r) => [r.group_id, Number(r.n)]));
  }

  async unlinkFromDishes(groupId: string): Promise<void> {
    await this.db().deleteFrom('catalog.dish_modifier_groups').where('group_id', '=', groupId).execute();
  }

  async insertGroup(id: string, data: ModifierGroupWrite): Promise<void> {
    await this.db()
      .insertInto('catalog.modifier_groups')
      .values({ id, ...this.groupRow(data), deleted_at: null })
      .execute();
  }

  async updateGroup(id: string, data: ModifierGroupWrite): Promise<void> {
    await this.db().updateTable('catalog.modifier_groups').set(this.groupRow(data)).where('id', '=', id).execute();
  }

  async softDeleteGroup(id: string, at: Date): Promise<void> {
    await this.db().updateTable('catalog.modifier_groups').set({ deleted_at: at, is_active: false }).where('id', '=', id).execute();
    await this.db().updateTable('catalog.modifier_options').set({ deleted_at: at, is_active: false }).where('group_id', '=', id).execute();
  }

  /**
   * Синхронизация опций группы: существующие обновляются, новые создаются, отсутствующие в списке —
   * логически удаляются (прошлые заказы хранят снимок названия и цены).
   */
  async syncOptions(groupId: string, options: readonly ModifierOptionWrite[], at: Date): Promise<void> {
    const existing = await this.db()
      .selectFrom('catalog.modifier_options')
      .select('id')
      .where('group_id', '=', groupId)
      .where('deleted_at', 'is', null)
      .execute();
    const keep = new Set(options.map((o) => o.id));
    const removed = existing.map((e) => e.id).filter((id) => !keep.has(id));
    if (removed.length > 0) {
      await this.db()
        .updateTable('catalog.modifier_options')
        .set({ deleted_at: at, is_active: false })
        .where('id', 'in', removed)
        .execute();
    }
    const existingIds = new Set(existing.map((e) => e.id));
    for (const option of options) {
      const row = {
        name: JSON.stringify(option.name),
        price_amount: option.price.amount,
        price_currency: option.price.currency,
        is_default: option.isDefault,
        sort_order: option.sortOrder,
        is_active: option.isActive,
      };
      if (existingIds.has(option.id)) {
        await this.db().updateTable('catalog.modifier_options').set(row).where('id', '=', option.id).execute();
      } else {
        await this.db()
          .insertInto('catalog.modifier_options')
          .values({ id: option.id, group_id: groupId, ...row, deleted_at: null })
          .execute();
      }
    }
  }

  private groupRow(data: ModifierGroupWrite) {
    return {
      code: data.code,
      name: JSON.stringify(data.name),
      description: JSON.stringify(data.description),
      min_select: data.minSelect,
      max_select: data.maxSelect,
      sort_order: data.sortOrder,
      is_active: data.isActive,
    };
  }
}
