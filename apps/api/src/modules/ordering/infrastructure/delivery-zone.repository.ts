import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { GeoPolygon } from '../../../shared/kernel/geo';
import { Currency, Money } from '../../../shared/kernel/money';
import { Translatable } from '../../../shared/kernel/translatable';
import { DeliveryZoneDefinition, DeliveryZoneState } from '../domain/delivery-zone';
import { DeliveryZonesTable, OrderingTables } from './ordering.tables';

function mapZone(row: Selectable<DeliveryZonesTable>): DeliveryZoneState {
  return {
    id: row.id,
    branchId: row.branch_id,
    name: row.name as Translatable,
    polygon: row.polygon as GeoPolygon,
    minOrderAmount: Money.of(row.min_order_amount, row.min_order_currency as Currency),
    deliveryFee: Money.of(row.delivery_fee_amount, row.delivery_fee_currency as Currency),
    freeDeliveryFrom:
      row.free_delivery_from_amount === null ? null : Money.of(row.free_delivery_from_amount, row.free_delivery_from_currency as Currency),
    etaMinutes: row.eta_minutes,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

function toRow(def: DeliveryZoneDefinition) {
  return {
    name: JSON.stringify(def.name),
    polygon: JSON.stringify(def.polygon),
    min_order_amount: def.minOrderAmount.amount,
    min_order_currency: def.minOrderAmount.currency,
    delivery_fee_amount: def.deliveryFee.amount,
    delivery_fee_currency: def.deliveryFee.currency,
    free_delivery_from_amount: def.freeDeliveryFrom?.amount ?? null,
    free_delivery_from_currency: def.freeDeliveryFrom?.currency ?? 'KZT',
    eta_minutes: def.etaMinutes,
    is_active: def.isActive,
    sort_order: def.sortOrder,
  };
}

/** Зоны доставки филиалов. Удаление логическое (deleted_at). */
@Injectable()
export class DeliveryZoneRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<OrderingTables>();
  }

  /** includeDeleted — для карточки прошлого заказа (зона могла быть удалена позже). */
  async findById(id: string, options: { includeDeleted?: boolean } = {}): Promise<DeliveryZoneState | null> {
    let q = this.db().selectFrom('ordering.delivery_zones').selectAll().where('id', '=', id);
    if (!options.includeDeleted) q = q.where('deleted_at', 'is', null);
    const row = await q.executeTakeFirst();
    return row ? mapZone(row) : null;
  }

  async listForBranch(branchId: string, options: { activeOnly?: boolean } = {}): Promise<DeliveryZoneState[]> {
    let q = this.db().selectFrom('ordering.delivery_zones').selectAll().where('branch_id', '=', branchId).where('deleted_at', 'is', null);
    if (options.activeOnly) q = q.where('is_active', '=', true);
    const rows = await q.orderBy('sort_order').orderBy('created_at').execute();
    return rows.map(mapZone);
  }

  async listForBranches(branches: 'all' | string[], options: { activeOnly?: boolean } = {}): Promise<DeliveryZoneState[]> {
    let q = this.db().selectFrom('ordering.delivery_zones').selectAll().where('deleted_at', 'is', null);
    if (branches !== 'all') {
      if (branches.length === 0) return [];
      q = q.where('branch_id', 'in', branches);
    }
    if (options.activeOnly) q = q.where('is_active', '=', true);
    const rows = await q.orderBy('branch_id').orderBy('sort_order').orderBy('created_at').execute();
    return rows.map(mapZone);
  }

  async insert(id: string, branchId: string, def: DeliveryZoneDefinition): Promise<void> {
    await this.db()
      .insertInto('ordering.delivery_zones')
      .values({ id, branch_id: branchId, deleted_at: null, ...toRow(def) })
      .execute();
  }

  async update(id: string, def: DeliveryZoneDefinition): Promise<void> {
    await this.db().updateTable('ordering.delivery_zones').set(toRow(def)).where('id', '=', id).execute();
  }

  async softDelete(id: string, at: Date): Promise<void> {
    await this.db().updateTable('ordering.delivery_zones').set({ deleted_at: at, is_active: false }).where('id', '=', id).execute();
  }
}
