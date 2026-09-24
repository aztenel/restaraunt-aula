import { Injectable } from '@nestjs/common';
import { Selectable, sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { PosTables, SyncStateTable } from './pos.tables';

/** Состояние синхронизации стоп-листа и импорта номенклатуры по филиалу. */
export interface SyncStateRecord {
  branchId: string;
  stopListProvider: string | null;
  stopListEnqueuedAt: Date | null;
  stopListAttemptedAt: Date | null;
  stopListSyncedAt: Date | null;
  stopListFailures: number;
  stopListError: string | null;
  stopListAlertedAt: Date | null;
  stopListChanges: number;
  productsProvider: string | null;
  productsRequestedAt: Date | null;
  productsImportedAt: Date | null;
  productsCount: number | null;
  productsError: string | null;
}

export type SyncStatePatch = Partial<Omit<SyncStateRecord, 'branchId'>>;

const COLUMNS: Record<keyof SyncStatePatch, keyof SyncStateTable> = {
  stopListProvider: 'stop_list_provider',
  stopListEnqueuedAt: 'stop_list_enqueued_at',
  stopListAttemptedAt: 'stop_list_attempted_at',
  stopListSyncedAt: 'stop_list_synced_at',
  stopListFailures: 'stop_list_failures',
  stopListError: 'stop_list_error',
  stopListAlertedAt: 'stop_list_alerted_at',
  stopListChanges: 'stop_list_changes',
  productsProvider: 'products_provider',
  productsRequestedAt: 'products_requested_at',
  productsImportedAt: 'products_imported_at',
  productsCount: 'products_count',
  productsError: 'products_error',
};

export function emptySyncState(branchId: string): SyncStateRecord {
  return {
    branchId,
    stopListProvider: null,
    stopListEnqueuedAt: null,
    stopListAttemptedAt: null,
    stopListSyncedAt: null,
    stopListFailures: 0,
    stopListError: null,
    stopListAlertedAt: null,
    stopListChanges: 0,
    productsProvider: null,
    productsRequestedAt: null,
    productsImportedAt: null,
    productsCount: null,
    productsError: null,
  };
}

function toRecord(row: Selectable<SyncStateTable>): SyncStateRecord {
  return {
    branchId: row.branch_id,
    stopListProvider: row.stop_list_provider,
    stopListEnqueuedAt: row.stop_list_enqueued_at,
    stopListAttemptedAt: row.stop_list_attempted_at,
    stopListSyncedAt: row.stop_list_synced_at,
    stopListFailures: row.stop_list_failures,
    stopListError: row.stop_list_error,
    stopListAlertedAt: row.stop_list_alerted_at,
    stopListChanges: row.stop_list_changes,
    productsProvider: row.products_provider,
    productsRequestedAt: row.products_requested_at,
    productsImportedAt: row.products_imported_at,
    productsCount: row.products_count,
    productsError: row.products_error,
  };
}

@Injectable()
export class SyncStateRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<PosTables>();
  }

  async get(branchId: string, options: { forUpdate?: boolean } = {}): Promise<SyncStateRecord> {
    let q = this.db().selectFrom('pos.sync_state').selectAll().where('branch_id', '=', branchId);
    if (options.forUpdate) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    return row ? toRecord(row) : emptySyncState(branchId);
  }

  async getMany(branchIds: string[]): Promise<Map<string, SyncStateRecord>> {
    const result = new Map<string, SyncStateRecord>();
    if (branchIds.length > 0) {
      const rows = await this.db().selectFrom('pos.sync_state').selectAll().where('branch_id', 'in', branchIds).execute();
      for (const r of rows) result.set(r.branch_id, toRecord(r));
    }
    for (const id of branchIds) if (!result.has(id)) result.set(id, emptySyncState(id));
    return result;
  }

  /** Обновить указанные поля (строка создаётся при первом обращении). */
  async patch(branchId: string, patch: SyncStatePatch): Promise<void> {
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      values[COLUMNS[key as keyof SyncStatePatch]] = value;
    }
    if (Object.keys(values).length === 0) return;
    await this.db()
      .insertInto('pos.sync_state')
      .values({ branch_id: branchId, ...values } as never)
      .onConflict((oc) => oc.column('branch_id').doUpdateSet(values as never))
      .execute();
  }

  /** Атомарно увеличить счётчик неудач синхронизации стоп-листа; возвращает новое значение. */
  async incrementStopListFailures(branchId: string, patch: SyncStatePatch): Promise<number> {
    await this.patch(branchId, patch);
    const row = await this.db()
      .updateTable('pos.sync_state')
      .set({ stop_list_failures: sql<number>`stop_list_failures + 1` })
      .where('branch_id', '=', branchId)
      .returning('stop_list_failures')
      .executeTakeFirstOrThrow();
    return row.stop_list_failures;
  }
}
