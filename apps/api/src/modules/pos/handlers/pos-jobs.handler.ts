import { Injectable } from '@nestjs/common';
import { JobHandler, Scheduled } from '../../../shared/infrastructure/events/decorators';
import { JobEnvelope } from '../../../shared/infrastructure/events/types';
import {
  CONFIRM_ORDER_JOB,
  CONFIRM_ORDER_RETRY,
  ConfirmOrderJobPayload,
  ConfirmPosOrder,
  PUSH_ORDER_JOB,
  PUSH_ORDER_RETRY,
  PushOrderJobPayload,
  PushOrderToPos,
} from '../application/order-export.actions';
import { IMPORT_PRODUCTS_JOB, IMPORT_PRODUCTS_RETRY, ImportPosProducts, ImportProductsJobPayload } from '../application/product-import.actions';
import {
  ScheduleStopListSync,
  SYNC_STOP_LIST_JOB,
  SYNC_STOP_LIST_RETRY,
  SYNC_STOP_LISTS_SCHEDULE,
  SyncStopList,
  SyncStopListJobPayload,
} from '../application/stop-list.actions';
import { STOP_LIST_SYNC_INTERVAL_MS } from '../domain/sync-policy';

/** Фоновые задачи POS: все обращения к внешней системе — только отсюда. */
@Injectable()
export class PosJobsHandler {
  constructor(
    private readonly pushOrder: PushOrderToPos,
    private readonly confirmOrder: ConfirmPosOrder,
    private readonly syncStopList: SyncStopList,
    private readonly importProducts: ImportPosProducts,
    private readonly scheduleStopListSync: ScheduleStopListSync,
  ) {}

  @JobHandler(PUSH_ORDER_JOB, PUSH_ORDER_RETRY)
  async onPushOrder(job: JobEnvelope<PushOrderJobPayload>): Promise<void> {
    await this.pushOrder.execute(job.payload.orderId);
  }

  @JobHandler(CONFIRM_ORDER_JOB, CONFIRM_ORDER_RETRY)
  async onConfirmOrder(job: JobEnvelope<ConfirmOrderJobPayload>): Promise<void> {
    await this.confirmOrder.execute(job.payload.orderId);
  }

  @JobHandler(SYNC_STOP_LIST_JOB, SYNC_STOP_LIST_RETRY)
  async onSyncStopList(job: JobEnvelope<SyncStopListJobPayload>): Promise<void> {
    await this.syncStopList.execute(job.payload.branchId);
  }

  @JobHandler(IMPORT_PRODUCTS_JOB, IMPORT_PRODUCTS_RETRY)
  async onImportProducts(job: JobEnvelope<ImportProductsJobPayload>): Promise<void> {
    await this.importProducts.execute(job.payload.branchId);
  }

  @Scheduled(SYNC_STOP_LISTS_SCHEDULE, { everyMs: STOP_LIST_SYNC_INTERVAL_MS })
  async onSyncStopListsTick(): Promise<void> {
    await this.scheduleStopListSync.execute();
  }
}
