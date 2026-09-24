import { Injectable, Logger } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { JobQueue } from '../../../shared/infrastructure/events/event-bus';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ValidationError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';
import { BranchDirectory } from '../../identity/public';
import { PosProductRepository } from '../infrastructure/pos-product.repository';
import { SyncStateRepository } from '../infrastructure/sync-state.repository';
import { PosClientRegistry, ResolvedPosClient } from './pos-client.registry';
import { classifyPosError } from './pos-errors';

/** Задача импорта номенклатуры POS филиала. */
export const IMPORT_PRODUCTS_JOB = 'pos.import_products';
export interface ImportProductsJobPayload {
  branchId: string;
}
export const IMPORT_PRODUCTS_RETRY = { attempts: 4, backoffMs: 30_000, maxBackoffMs: 5 * 60_000 };

/** Повторный запрос импорта в течение этого времени (пока задача не выполнилась) не ставит вторую задачу. */
const IMPORT_DEDUPE_MS = 60_000;

export interface QueuedJobResult {
  queued: boolean;
  /** Задача уже стояла в очереди — новая не ставилась. */
  alreadyQueued: boolean;
  requestedAt: Date;
}

/** Запрос импорта номенклатуры из админки (для экрана сопоставления). */
@Injectable()
export class RequestProductImport {
  constructor(
    private readonly registry: PosClientRegistry,
    private readonly branches: BranchDirectory,
    private readonly state: SyncStateRepository,
    private readonly jobs: JobQueue,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, branchId: string): Promise<QueuedJobResult> {
    actor.assertCan(Permission.IntegrationsManage, branchId);
    await this.branches.get(branchId);
    const { provider, client } = await this.registry.resolve(branchId);
    if (!client.capabilities.nomenclature) {
      throw new ValidationError('pos.nomenclature_unsupported', 'The POS of this branch does not provide a nomenclature', { provider, branchId });
    }
    const now = this.clock.now();
    return this.database.transaction(async () => {
      const current = await this.state.get(branchId, { forUpdate: true });
      const requested = current.productsRequestedAt;
      const finished = current.productsImportedAt && requested && current.productsImportedAt >= requested;
      if (requested && !finished && !current.productsError && now.getTime() - requested.getTime() < IMPORT_DEDUPE_MS) {
        return { queued: true, alreadyQueued: true, requestedAt: requested };
      }
      await this.state.patch(branchId, { productsRequestedAt: now, productsProvider: provider, productsError: null });
      await this.jobs.enqueue<ImportProductsJobPayload>(IMPORT_PRODUCTS_JOB, { branchId }, { branchId });
      await this.audit.record({
        action: 'pos.products_import_requested',
        entityType: 'pos_branch',
        entityId: branchId,
        branchId,
        after: { provider },
      });
      return { queued: true, alreadyQueued: false, requestedAt: now };
    });
  }
}

/** Импорт номенклатуры POS (фоновая задача): товары добавляются/обновляются, пропавшие помечаются. */
@Injectable()
export class ImportPosProducts {
  private readonly logger = new Logger(ImportPosProducts.name);

  constructor(
    private readonly registry: PosClientRegistry,
    private readonly products: PosProductRepository,
    private readonly state: SyncStateRepository,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(branchId: string): Promise<void> {
    let resolved: ResolvedPosClient;
    try {
      resolved = await this.registry.resolve(branchId);
    } catch (err) {
      await this.state.patch(branchId, { productsError: classifyPosError(err).message.slice(0, 2000) });
      return;
    }
    const { provider, client } = resolved;
    if (!client.capabilities.nomenclature) {
      await this.state.patch(branchId, { productsProvider: provider, productsError: 'The POS of this branch does not provide a nomenclature' });
      return;
    }
    try {
      const list = await client.fetchProducts({ branchId });
      const now = this.clock.now();
      await this.database.transaction(async () => {
        const count = await this.products.replaceAll(branchId, provider, list, now);
        await this.state.patch(branchId, { productsProvider: provider, productsImportedAt: now, productsCount: count, productsError: null });
      });
      this.logger.log({ branchId, provider, count: list.length }, 'POS nomenclature imported');
    } catch (err) {
      const classified = classifyPosError(err);
      await this.state.patch(branchId, { productsProvider: provider, productsError: classified.message.slice(0, 2000) });
      // Временная ошибка — повтор через очередь с задержкой; постоянная — видна в статусе, повтор бессмыслен.
      if (classified.retryable) throw err;
    }
  }
}
