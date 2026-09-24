import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { StopListSnapshotEntry } from '../domain/stop-list-diff';
import { PosTables } from './pos.tables';

/** Последний известный стоп-лист POS по сопоставленным блюдам филиала. */
@Injectable()
export class StopListSnapshotRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<PosTables>();
  }

  async list(branchId: string): Promise<StopListSnapshotEntry[]> {
    const rows = await this.db().selectFrom('pos.stop_list_snapshots').selectAll().where('branch_id', '=', branchId).execute();
    return rows.map((r) => ({ dishId: r.dish_id, provider: r.provider, externalProductId: r.external_product_id, available: r.available }));
  }

  async upsert(branchId: string, entries: StopListSnapshotEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.db()
      .insertInto('pos.stop_list_snapshots')
      .values(
        entries.map((e) => ({
          branch_id: branchId,
          dish_id: e.dishId,
          provider: e.provider,
          external_product_id: e.externalProductId,
          available: e.available,
        })),
      )
      .onConflict((oc) =>
        oc.columns(['branch_id', 'dish_id']).doUpdateSet((eb) => ({
          provider: eb.ref('excluded.provider'),
          external_product_id: eb.ref('excluded.external_product_id'),
          available: eb.ref('excluded.available'),
        })),
      )
      .execute();
  }

  async remove(branchId: string, dishIds: string[]): Promise<void> {
    if (dishIds.length === 0) return;
    await this.db().deleteFrom('pos.stop_list_snapshots').where('branch_id', '=', branchId).where('dish_id', 'in', dishIds).execute();
  }
}
