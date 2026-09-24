import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { pageRequest } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import { BulkUpsertProductMappings, CreateProductMapping, DeleteProductMapping, UpdateProductMapping } from '../../application/mapping.actions';
import { RetryOrderExport } from '../../application/order-export.actions';
import { POS_OPERATIONS_PERMISSIONS } from '../../application/pos-access';
import { MappingSuggestionsQuery, OrderExportsQuery, PosProductsQuery, PosStatusQuery, ProductMappingsQuery } from '../../application/pos.queries';
import { RequestProductImport } from '../../application/product-import.actions';
import { RequestStopListSync } from '../../application/stop-list.actions';
import {
  BranchRefDto,
  BulkMappingsDto,
  BulkMappingsResultDto,
  MappingSuggestionDto,
  MappingSuggestionsPageDto,
  OrderExportDto,
  OrderExportsPageDto,
  OrderExportsQueryDto,
  PosBranchStatusDto,
  PosProductDto,
  PosProductsPageDto,
  PosProductsQueryDto,
  PosStatusQueryDto,
  ProductMappingDto,
  ProductMappingInputDto,
  ProductMappingsPageDto,
  ProductMappingsQueryDto,
  ProductMappingUpdateDto,
  QueuedJobDto,
  SuggestionsQueryDto,
} from '../dto';

/**
 * Состояние интеграции POS по филиалам и ручной запуск синхронизации стоп-листа.
 * Доступно администратору интеграций и сотрудникам, ведущим заказы филиала.
 */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/pos')
export class PosStatusController {
  constructor(
    private readonly status: PosStatusQuery,
    private readonly requestSync: RequestStopListSync,
  ) {}

  @RequirePermissions(...POS_OPERATIONS_PERMISSIONS)
  @Get('status')
  @ApiOkResponse({ type: [PosBranchStatusDto] })
  async getStatus(@CurrentActor() actor: Actor, @Query() query: PosStatusQueryDto): Promise<PosBranchStatusDto[]> {
    return (await this.status.execute(actor, query.branchId)).map(PosBranchStatusDto.from);
  }

  @RequirePermissions(...POS_OPERATIONS_PERMISSIONS)
  @Post('stop-list/sync')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: QueuedJobDto })
  async syncStopList(@CurrentActor() actor: Actor, @Body() dto: BranchRefDto): Promise<QueuedJobDto> {
    return QueuedJobDto.from(await this.requestSync.execute(actor, dto.branchId));
  }
}

/** Передачи заказов в POS: список (очередь неудач POS) и ручной повтор. */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/pos/exports')
export class PosExportsController {
  constructor(
    private readonly exports: OrderExportsQuery,
    private readonly retryExport: RetryOrderExport,
  ) {}

  @RequirePermissions(...POS_OPERATIONS_PERMISSIONS)
  @Get()
  @ApiOkResponse({ type: OrderExportsPageDto })
  async list(@CurrentActor() actor: Actor, @Query() query: OrderExportsQueryDto): Promise<OrderExportsPageDto> {
    const page = await this.exports.execute(
      actor,
      { branchId: query.branchId, status: query.status, orderId: query.orderId },
      pageRequest(query.page, query.perPage),
    );
    return { ...page, items: page.items.map(OrderExportDto.from) };
  }

  @RequirePermissions(...POS_OPERATIONS_PERMISSIONS)
  @Post(':id/retry')
  @HttpCode(200)
  @ApiOkResponse({ type: OrderExportDto })
  async retry(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<OrderExportDto> {
    return OrderExportDto.from(await this.retryExport.execute(actor, id));
  }
}

/** Сопоставление блюд с товарами POS (администратор интеграций). */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/pos/mappings')
export class PosMappingsController {
  constructor(
    private readonly mappings: ProductMappingsQuery,
    private readonly suggestions: MappingSuggestionsQuery,
    private readonly createMapping: CreateProductMapping,
    private readonly updateMapping: UpdateProductMapping,
    private readonly deleteMapping: DeleteProductMapping,
    private readonly bulkUpsert: BulkUpsertProductMappings,
  ) {}

  @RequirePermissions(Permission.IntegrationsManage)
  @Get()
  @ApiOkResponse({ type: ProductMappingsPageDto })
  async list(@CurrentActor() actor: Actor, @Query() query: ProductMappingsQueryDto): Promise<ProductMappingsPageDto> {
    const page = await this.mappings.execute(
      actor,
      { branchId: query.branchId, provider: query.provider, dishId: query.dishId, externalProductId: query.externalProductId },
      pageRequest(query.page, query.perPage),
    );
    return { ...page, items: page.items.map(ProductMappingDto.from) };
  }

  /** Автоподбор: несопоставленные товары POS и похожие блюда меню филиала. */
  @RequirePermissions(Permission.IntegrationsManage)
  @Get('suggestions')
  @ApiOkResponse({ type: MappingSuggestionsPageDto })
  async suggest(@CurrentActor() actor: Actor, @Query() query: SuggestionsQueryDto): Promise<MappingSuggestionsPageDto> {
    const page = await this.suggestions.execute(
      actor,
      { branchId: query.branchId, provider: query.provider },
      pageRequest(query.page, query.perPage ?? 25),
    );
    return { ...page, items: page.items.map(MappingSuggestionDto.from) };
  }

  @RequirePermissions(Permission.IntegrationsManage)
  @Post()
  @ApiCreatedResponse({ type: ProductMappingDto })
  async create(@CurrentActor() actor: Actor, @Body() dto: ProductMappingInputDto): Promise<ProductMappingDto> {
    return ProductMappingDto.from(await this.createMapping.execute(actor, dto));
  }

  /** Массовое сохранение (принять подсказки автоподбора). */
  @RequirePermissions(Permission.IntegrationsManage)
  @Post('bulk')
  @HttpCode(200)
  @ApiOkResponse({ type: BulkMappingsResultDto })
  async bulk(@CurrentActor() actor: Actor, @Body() dto: BulkMappingsDto): Promise<BulkMappingsResultDto> {
    const result = await this.bulkUpsert.execute(actor, dto);
    return { ...result, items: result.items.map(ProductMappingDto.from) };
  }

  @RequirePermissions(Permission.IntegrationsManage)
  @Put(':id')
  @ApiOkResponse({ type: ProductMappingDto })
  async update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProductMappingUpdateDto): Promise<ProductMappingDto> {
    return ProductMappingDto.from(await this.updateMapping.execute(actor, id, dto));
  }

  @RequirePermissions(Permission.IntegrationsManage)
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteMapping.execute(actor, id);
  }
}

/** Номенклатура POS: импорт (фоновая задача) и просмотр для экрана сопоставления. */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/pos/products')
export class PosProductsController {
  constructor(
    private readonly products: PosProductsQuery,
    private readonly requestImport: RequestProductImport,
  ) {}

  @RequirePermissions(Permission.IntegrationsManage)
  @Get()
  @ApiOkResponse({ type: PosProductsPageDto })
  async list(@CurrentActor() actor: Actor, @Query() query: PosProductsQueryDto): Promise<PosProductsPageDto> {
    const page = await this.products.execute(
      actor,
      {
        branchId: query.branchId,
        provider: query.provider,
        q: query.q,
        kind: query.kind,
        unmappedOnly: query.unmappedOnly,
        includeRemoved: query.includeRemoved,
      },
      pageRequest(query.page, query.perPage),
    );
    return { ...page, items: page.items.map(PosProductDto.from) };
  }

  @RequirePermissions(Permission.IntegrationsManage)
  @Post('import')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: QueuedJobDto })
  async import(@CurrentActor() actor: Actor, @Body() dto: BranchRefDto): Promise<QueuedJobDto> {
    return QueuedJobDto.from(await this.requestImport.execute(actor, dto.branchId));
  }
}
