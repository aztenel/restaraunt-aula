import { Injectable, Logger } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Config } from '../../../shared/infrastructure/config/config';
import { Database } from '../../../shared/infrastructure/database/database';
import { JobQueue } from '../../../shared/infrastructure/events/event-bus';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ValidationError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';
import { StopListControl } from '../../catalog/public';
import { BranchDirectory } from '../../identity/public';
import { stopListSyncAlert } from '../domain/alert-texts';
import { diffStopList } from '../domain/stop-list-diff';
import { isSyncQueued, shouldAlertSyncFailure, shouldScheduleSync } from '../domain/sync-policy';
import { ProductMappingRepository } from '../infrastructure/product-mapping.repository';
import { StopListSnapshotRepository } from '../infrastructure/stop-list-snapshot.repository';
import { SyncStateRecord, SyncStateRepository } from '../infrastructure/sync-state.repository';
import { AlertPosStaff } from './alert-pos-staff.action';
import { assertCanOperatePos } from './pos-access';
import { PosClientRegistry, ResolvedPosClient } from './pos-client.registry';
import { ClassifiedPosError, classifyPosError } from './pos-errors';
import { QueuedJobResult } from './product-import.actions';

/** Периодическая постановка синхронизации стоп-листа (каждые 5 минут). */
export const SYNC_STOP_LISTS_SCHEDULE = 'pos.sync_stop_lists';
/** Синхронизация стоп-листа одного филиала. */
export const SYNC_STOP_LIST_JOB = 'pos.sync_stop_list';
export interface SyncStopListJobPayload {
  branchId: string;
}
/**
 * Одна попытка на задачу: повтор при недоступности POS — следующая постановка по расписанию
 * с экспоненциальной паузой (domain/sync-policy), а не повторы очереди (иначе очередь неудач
 * засорялась бы каждые 5 минут, пока POS лежит).
 */
export const SYNC_STOP_LIST_RETRY = { attempts: 1, backoffMs: 60_000 };

function queueSyncState(s: SyncStateRecord) {
  return { enqueuedAt: s.stopListEnqueuedAt, attemptedAt: s.stopListAttemptedAt, failures: s.stopListFailures };
}

/** По расписанию: поставить синхронизацию для филиалов, направленных в POS со стоп-листом. */
@Injectable()
export class ScheduleStopListSync {
  private readonly logger = new Logger(ScheduleStopListSync.name);

  constructor(
    private readonly branches: BranchDirectory,
    private readonly registry: PosClientRegistry,
    private readonly state: SyncStateRepository,
    private readonly jobs: JobQueue,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  /** Возвращает филиалы, для которых поставлена задача. */
  async execute(): Promise<string[]> {
    const queued: string[] = [];
    for (const branch of await this.branches.list({ activeOnly: true })) {
      let resolved: ResolvedPosClient;
      try {
        resolved = await this.registry.resolve(branch.id);
      } catch (err) {
        // Ошибка настройки маршрутизации видна в статусе POS; стоп-лист не синхронизируем.
        this.logger.warn({ branchId: branch.id, err: err instanceof Error ? err.message : String(err) }, 'POS routing is invalid');
        continue;
      }
      if (!resolved.client.capabilities.stopList) continue;
      const enqueued = await this.database.transaction(async () => {
        const now = this.clock.now();
        const current = await this.state.get(branch.id, { forUpdate: true });
        if (!shouldScheduleSync(queueSyncState(current), now)) return false;
        await this.jobs.enqueue<SyncStopListJobPayload>(SYNC_STOP_LIST_JOB, { branchId: branch.id }, { branchId: branch.id });
        await this.state.patch(branch.id, { stopListEnqueuedAt: now });
        return true;
      });
      if (enqueued) queued.push(branch.id);
    }
    return queued;
  }
}

/** Ручной запуск синхронизации стоп-листа из админки (без ожидания расписания и паузы после ошибок). */
@Injectable()
export class RequestStopListSync {
  constructor(
    private readonly branches: BranchDirectory,
    private readonly registry: PosClientRegistry,
    private readonly state: SyncStateRepository,
    private readonly jobs: JobQueue,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, branchId: string): Promise<QueuedJobResult> {
    assertCanOperatePos(actor, branchId);
    await this.branches.get(branchId);
    const { provider, client } = await this.registry.resolve(branchId);
    if (!client.capabilities.stopList) {
      throw new ValidationError('pos.stop_list_unsupported', 'The POS of this branch does not provide a stop-list', { provider, branchId });
    }
    return this.database.transaction(async () => {
      const now = this.clock.now();
      const current = await this.state.get(branchId, { forUpdate: true });
      if (isSyncQueued(queueSyncState(current), now)) {
        return { queued: true, alreadyQueued: true, requestedAt: current.stopListEnqueuedAt! };
      }
      await this.jobs.enqueue<SyncStopListJobPayload>(SYNC_STOP_LIST_JOB, { branchId }, { branchId });
      await this.state.patch(branchId, { stopListEnqueuedAt: now });
      await this.audit.record({
        action: 'pos.stop_list_sync_requested',
        entityType: 'pos_branch',
        entityId: branchId,
        branchId,
        after: { provider },
      });
      return { queued: true, alreadyQueued: false, requestedAt: now };
    });
  }
}

export interface StopListSyncResult {
  status: 'synced' | 'failed' | 'skipped';
  changes: number;
}

/**
 * Синхронизация стоп-листа филиала (фоновая задача): стоп-лист POS -> блюда по сопоставлениям ->
 * сравнение со снимком -> StopListControl.setAvailability(..., 'pos') только для изменившихся блюд.
 */
@Injectable()
export class SyncStopList {
  private readonly logger = new Logger(SyncStopList.name);

  constructor(
    private readonly registry: PosClientRegistry,
    private readonly mappings: ProductMappingRepository,
    private readonly snapshots: StopListSnapshotRepository,
    private readonly state: SyncStateRepository,
    private readonly stopList: StopListControl,
    private readonly alert: AlertPosStaff,
    private readonly database: Database,
    private readonly config: Config,
    private readonly clock: Clock,
  ) {}

  async execute(branchId: string): Promise<StopListSyncResult> {
    await this.state.patch(branchId, { stopListAttemptedAt: this.clock.now() });
    let resolved: ResolvedPosClient;
    try {
      resolved = await this.registry.resolve(branchId);
    } catch (err) {
      await this.recordFailure(branchId, null, classifyPosError(err));
      return { status: 'failed', changes: 0 };
    }
    const { provider, client } = resolved;
    // Филиал перевели на POS без стоп-листа, пока задача ждала очереди.
    if (!client.capabilities.stopList) return { status: 'skipped', changes: 0 };

    let items;
    try {
      items = await client.fetchStopList({ branchId });
    } catch (err) {
      await this.recordFailure(branchId, provider, classifyPosError(err));
      return { status: 'failed', changes: 0 };
    }

    const diff = diffStopList({
      provider,
      mappings: await this.mappings.listForBranch(branchId, provider),
      stopList: items,
      snapshot: await this.snapshots.list(branchId),
    });
    const failed = new Set<string>();
    for (const change of diff.changes) {
      const entry = diff.snapshot.find((s) => s.dishId === change.dishId)!;
      try {
        await this.database.transaction(async () => {
          await this.stopList.setAvailability(branchId, change.dishId, change.available, 'pos');
          await this.snapshots.upsert(branchId, [entry]);
        });
      } catch (err) {
        failed.add(change.dishId);
        this.logger.warn({ branchId, dishId: change.dishId, err: err instanceof Error ? err.message : String(err) }, 'Stop-list change failed');
      }
    }
    const applied = diff.changes.length - failed.size;
    await this.database.transaction(async () => {
      await this.snapshots.upsert(
        branchId,
        diff.snapshot.filter((s) => !failed.has(s.dishId)),
      );
      await this.snapshots.remove(branchId, diff.staleDishIds);
      await this.state.patch(branchId, {
        stopListProvider: provider,
        stopListSyncedAt: this.clock.now(),
        stopListFailures: 0,
        stopListError: failed.size > 0 ? `Stop-list was not applied to ${failed.size} dish(es); will retry on next sync` : null,
        stopListAlertedAt: null,
        stopListChanges: applied,
      });
    });
    if (applied > 0) this.logger.log({ branchId, provider, changes: applied }, 'POS stop-list synced');
    return { status: 'synced', changes: applied };
  }

  private async recordFailure(branchId: string, provider: string | null, error: ClassifiedPosError): Promise<void> {
    await this.database.transaction(async () => {
      const current = await this.state.get(branchId, { forUpdate: true });
      const failures = current.stopListFailures + 1;
      const alert = shouldAlertSyncFailure({ failures, retryable: error.retryable, alreadyAlerted: current.stopListAlertedAt !== null });
      await this.state.patch(branchId, {
        stopListProvider: provider ?? current.stopListProvider,
        stopListFailures: failures,
        stopListError: error.message.slice(0, 2000),
        ...(alert ? { stopListAlertedAt: this.clock.now() } : {}),
      });
      if (alert) {
        const text = stopListSyncAlert({
          providerTitle: provider ?? 'POS',
          failures,
          error: error.message,
          link: `${this.config.app.adminUrl}/integrations/pos`,
        });
        await this.alert.execute({
          branchId,
          ...text,
          dedupeKey: `pos:stop_list:${branchId}:${this.clock.now().toISOString()}`,
          feed: { stream: 'system', entityId: branchId },
          related: { type: 'branch', id: branchId },
          permission: Permission.MenuStopList,
        });
      }
    });
    this.logger.warn({ branchId, provider, err: error.message }, 'POS stop-list sync failed');
  }
}
