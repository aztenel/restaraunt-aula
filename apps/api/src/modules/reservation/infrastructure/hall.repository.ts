import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Translatable } from '../../../shared/kernel/translatable';
import { isStoredImage, StoredImage } from '../domain/images';
import { HallPlanSize } from '../domain/venue';
import { HallsTable, ReservationTables } from './reservation.tables';

/** Зал филиала: план (размер в условных единицах), фон плана, порядок, активность. */
export interface HallRecord {
  id: string;
  branchId: string;
  code: string;
  name: Translatable;
  description: Translatable;
  plan: HallPlanSize;
  background: StoredImage | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type HallWrite = Omit<HallRecord, 'id' | 'createdAt' | 'updatedAt' | 'background'>;

function mapHall(row: Selectable<HallsTable>): HallRecord {
  return {
    id: row.id,
    branchId: row.branch_id,
    code: row.code,
    name: row.name as Translatable,
    description: (row.description ?? {}) as Translatable,
    plan: { width: row.plan_width, height: row.plan_height },
    background: isStoredImage(row.background_image) ? row.background_image : null,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(data: HallWrite) {
  return {
    branch_id: data.branchId,
    code: data.code,
    name: JSON.stringify(data.name),
    description: JSON.stringify(data.description),
    plan_width: data.plan.width,
    plan_height: data.plan.height,
    sort_order: data.sortOrder,
    is_active: data.isActive,
  };
}

@Injectable()
export class HallRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<ReservationTables>();
  }

  async findById(id: string): Promise<HallRecord | null> {
    const row = await this.db().selectFrom('reservation.halls').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    return row ? mapHall(row) : null;
  }

  async findByCode(branchId: string, code: string): Promise<HallRecord | null> {
    const row = await this.db()
      .selectFrom('reservation.halls')
      .selectAll()
      .where('branch_id', '=', branchId)
      .where('code', '=', code)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? mapHall(row) : null;
  }

  /** Залы филиалов (branchIds = 'all' — все), по порядку сортировки. */
  async list(filter: { branchIds: 'all' | string[]; activeOnly?: boolean }): Promise<HallRecord[]> {
    if (filter.branchIds !== 'all' && filter.branchIds.length === 0) return [];
    let q = this.db().selectFrom('reservation.halls').selectAll().where('deleted_at', 'is', null);
    if (filter.branchIds !== 'all') q = q.where('branch_id', 'in', filter.branchIds);
    if (filter.activeOnly) q = q.where('is_active', '=', true);
    const rows = await q.orderBy('branch_id').orderBy('sort_order').orderBy('code').execute();
    return rows.map(mapHall);
  }

  async insert(id: string, data: HallWrite): Promise<void> {
    await this.db()
      .insertInto('reservation.halls')
      .values({ id, ...toRow(data) })
      .execute();
  }

  async update(id: string, data: HallWrite): Promise<void> {
    await this.db().updateTable('reservation.halls').set(toRow(data)).where('id', '=', id).execute();
  }

  async setBackground(id: string, background: StoredImage | null): Promise<void> {
    await this.db()
      .updateTable('reservation.halls')
      .set({ background_image: background ? JSON.stringify(background) : null })
      .where('id', '=', id)
      .execute();
  }

  async softDelete(id: string, at: Date): Promise<void> {
    await this.db().updateTable('reservation.halls').set({ deleted_at: at, is_active: false }).where('id', '=', id).execute();
  }
}
