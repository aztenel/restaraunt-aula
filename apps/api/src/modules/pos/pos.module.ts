import { Global, Module, OnModuleInit } from '@nestjs/common';
import { IntegrationCatalog } from '../../shared/infrastructure/settings/integration-catalog';
import { AlertPosStaff } from './application/alert-pos-staff.action';
import { BulkUpsertProductMappings, CreateProductMapping, DeleteProductMapping, UpdateProductMapping } from './application/mapping.actions';
import {
  ConfirmPosOrder,
  HandleCancelledOrder,
  PushOrderToPos,
  RegisterOrderExport,
  ReportOrderExportFailure,
  RetryOrderExport,
} from './application/order-export.actions';
import { POS_CLIENTS, PosClientRegistry, posRoutingDescriptor } from './application/pos-client.registry';
import { MappingSuggestionsQuery, OrderExportsQuery, PosProductsQuery, PosStatusQuery, ProductMappingsQuery } from './application/pos.queries';
import { ImportPosProducts, RequestProductImport } from './application/product-import.actions';
import { RequestStopListSync, ScheduleStopListSync, SyncStopList } from './application/stop-list.actions';
import { PosClient } from './domain/pos-client';
import { PosOrderEventsHandler } from './handlers/order-events.handler';
import { PosJobsHandler } from './handlers/pos-jobs.handler';
import { PosExportsController, PosMappingsController, PosProductsController, PosStatusController } from './http/admin/pos.controller';
import { IikoPosClient } from './infrastructure/adapters/iiko/iiko-pos.client';
import { IIKO_INTEGRATION } from './infrastructure/adapters/iiko/iiko.settings';
import { ManualPosClient } from './infrastructure/adapters/manual/manual-pos.client';
import { OrderExportRepository } from './infrastructure/order-export.repository';
import { PosProductRepository } from './infrastructure/pos-product.repository';
import { ProductMappingRepository } from './infrastructure/product-mapping.repository';
import { StopListSnapshotRepository } from './infrastructure/stop-list-snapshot.repository';
import { SyncStateRepository } from './infrastructure/sync-state.repository';

/**
 * POS: адаптер кассовой системы точки (интерфейс PosClient; адаптеры manual — по умолчанию, iiko).
 * Передача принятых заказов на кухню (очередь, не блокирует приём заказа), синхронизация стоп-листа,
 * сопоставление блюд с товарами POS. Публичных сервисов не предоставляет — только события PosEvents.
 */
@Global()
@Module({
  controllers: [PosStatusController, PosExportsController, PosMappingsController, PosProductsController],
  providers: [
    // Хранилище
    OrderExportRepository,
    ProductMappingRepository,
    PosProductRepository,
    StopListSnapshotRepository,
    SyncStateRepository,
    // Адаптеры POS
    ManualPosClient,
    IikoPosClient,
    {
      provide: POS_CLIENTS,
      useFactory: (manual: ManualPosClient, iiko: IikoPosClient): PosClient[] => [manual, iiko],
      inject: [ManualPosClient, IikoPosClient],
    },
    PosClientRegistry,
    // Действия
    AlertPosStaff,
    RegisterOrderExport,
    ReportOrderExportFailure,
    PushOrderToPos,
    ConfirmPosOrder,
    RetryOrderExport,
    HandleCancelledOrder,
    CreateProductMapping,
    UpdateProductMapping,
    DeleteProductMapping,
    BulkUpsertProductMappings,
    RequestProductImport,
    ImportPosProducts,
    ScheduleStopListSync,
    RequestStopListSync,
    SyncStopList,
    // Запросы
    PosStatusQuery,
    OrderExportsQuery,
    ProductMappingsQuery,
    PosProductsQuery,
    MappingSuggestionsQuery,
    // Подписки, задачи, расписания
    PosOrderEventsHandler,
    PosJobsHandler,
  ],
  exports: [],
})
export class PosModule implements OnModuleInit {
  constructor(
    private readonly catalog: IntegrationCatalog,
    private readonly registry: PosClientRegistry,
  ) {}

  onModuleInit(): void {
    this.catalog.register(IIKO_INTEGRATION);
    this.catalog.register(posRoutingDescriptor(this.registry.providers()));
  }
}
