import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MoneyDto, PageDtoOf, PageQueryDto, TranslatableDto } from '../../../shared/infrastructure/http/api-types';
import { BULK_MAPPINGS_MAX, ProductMappingView } from '../application/mapping.actions';
import { BULK_RETRY_MAX } from '../application/order-export.actions';
import { MappingSuggestion, PosBranchStatus, PosDishView, PosProductView } from '../application/pos.queries';
import { QueuedJobResult } from '../application/product-import.actions';
import { MissingMapping, ORDER_EXPORT_MACHINE, ORDER_EXPORT_STATUSES, OrderExportStatus, POS_FAILURE_REASONS, SKIP_REASONS } from '../domain/order-export';
import { POS_PRODUCT_KINDS, PosProductKind } from '../domain/pos-client';
import { EXTERNAL_ID_MAX_LENGTH, EXTERNAL_NAME_MAX_LENGTH, MAX_MODIFIER_MAPPINGS } from '../domain/product-mapping';
import { OrderExportRecord } from '../infrastructure/order-export.repository';

const PROVIDER_RE = /^[a-z0-9_]+$/;
const toBoolean = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

// ---------------------------------------------------------------- Статус

export class PosCapabilitiesDto {
  @ApiProperty({ description: 'Передаёт заказы на кухню во внешнюю систему' }) pushOrders: boolean;
  @ApiProperty({ description: 'Отдаёт стоп-лист для синхронизации' }) stopList: boolean;
  @ApiProperty({ description: 'Отдаёт номенклатуру для сопоставления' }) nomenclature: boolean;
}

export class PosStopListStatusDto {
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'Последняя успешная синхронизация' }) syncedAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'Последняя попытка' }) attemptedAt: Date | null;
  @ApiProperty({ description: 'Неудач подряд' }) failures: number;
  @ApiPropertyOptional({ type: String, nullable: true }) error: string | null;
  @ApiProperty({ description: 'Изменений стоп-листа при последней синхронизации' }) lastChanges: number;
}

export class PosProductsStatusDto {
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) requestedAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) importedAt: Date | null;
  @ApiProperty({ description: 'Товаров в импортированной номенклатуре' }) count: number;
  @ApiPropertyOptional({ type: String, nullable: true }) error: string | null;
}

export class OrderExportCountsDto {
  @ApiProperty() pending: number;
  @ApiProperty() sent: number;
  @ApiProperty() failed: number;
  @ApiProperty() skipped: number;
}

export class PosBranchStatusDto {
  @ApiProperty() branchId: string;
  @ApiProperty() branchCode: string;
  @ApiProperty({ type: TranslatableDto }) branchName: TranslatableDto;
  @ApiProperty() isActive: boolean;
  @ApiProperty({ description: 'POS филиала по маршрутизации (manual — без внешней системы)' }) provider: string;
  @ApiProperty({ description: 'Для провайдера есть адаптер' }) providerKnown: boolean;
  @ApiProperty({ description: 'Интеграция настроена для филиала' }) configured: boolean;
  @ApiProperty({ type: PosCapabilitiesDto }) capabilities: PosCapabilitiesDto;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Ошибка настройки pos.routing' }) routingError: string | null;
  @ApiProperty({ type: PosStopListStatusDto }) stopList: PosStopListStatusDto;
  @ApiProperty({ type: PosProductsStatusDto }) products: PosProductsStatusDto;
  @ApiProperty() mappingsCount: number;
  @ApiProperty({ type: OrderExportCountsDto, description: 'Передачи заказов по статусам (failed — не переданные)' })
  exports: OrderExportCountsDto;

  static from(s: PosBranchStatus): PosBranchStatusDto {
    return { ...s, capabilities: { ...s.capabilities }, stopList: { ...s.stopList }, products: { ...s.products }, exports: { ...s.exports } };
  }
}

export class PosStatusQueryDto {
  @ApiPropertyOptional({ description: 'Филиал; без него — все доступные' }) @IsOptional() @IsUUID() branchId?: string;
}

export class BranchRefDto {
  @ApiProperty() @IsUUID() branchId: string;
}

export class QueuedJobDto {
  @ApiProperty() queued: boolean;
  @ApiProperty({ description: 'Задача уже стояла в очереди — новая не ставилась' }) alreadyQueued: boolean;
  @ApiProperty() requestedAt: Date;

  static from(r: QueuedJobResult): QueuedJobDto {
    return { ...r };
  }
}

// ---------------------------------------------------------------- Передачи заказов

export class MissingOptionDto {
  @ApiProperty() optionId: string;
  @ApiProperty() name: string;
}

export class MissingMappingDto {
  @ApiProperty() dishId: string;
  @ApiProperty() dishName: string;
  @ApiProperty({ description: 'Нет сопоставления самого блюда' }) dishMissing: boolean;
  @ApiProperty({ type: [MissingOptionDto], description: 'Опции модификаторов без сопоставления' }) options: MissingOptionDto[];
  @ApiProperty({ type: [String], description: 'id опций без сопоставления (то же, что options[].optionId) — для перехода к сопоставлению' })
  optionIds: string[];

  static from(m: MissingMapping): MissingMappingDto {
    return {
      dishId: m.dishId,
      dishName: m.dishName,
      dishMissing: m.dishMissing,
      options: m.options.map((o) => ({ ...o })),
      optionIds: m.options.map((o) => o.optionId),
    };
  }
}

export class OrderExportDto {
  @ApiProperty() id: string;
  @ApiProperty() orderId: string;
  @ApiProperty() orderNumber: string;
  @ApiProperty() branchId: string;
  @ApiProperty() provider: string;
  @ApiProperty({ enum: ORDER_EXPORT_STATUSES }) status: OrderExportStatus;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Номер/идентификатор заказа в POS' }) posOrderId: string | null;
  @ApiProperty({ description: 'Попыток в текущем цикле передачи' }) attempts: number;
  @ApiProperty({ description: 'Ручных повторов' }) manualRetries: number;
  @ApiPropertyOptional({ type: String, nullable: true }) lastError: string | null;
  @ApiPropertyOptional({ nullable: true, enum: POS_FAILURE_REASONS }) failureReason: string | null;
  @ApiPropertyOptional({ nullable: true, enum: SKIP_REASONS }) skipReason: string | null;
  @ApiProperty({ type: [MissingMappingDto], description: 'Блюда и опции без сопоставления (при failureReason=missing_mapping)' })
  missingMappings: MissingMappingDto[];
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) lastAttemptAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) sentAt: Date | null;
  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'POS подтвердила создание заказа. null при status=sent — заказ принят POS в обработку, подтверждение ожидается',
  })
  confirmedAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) failedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiProperty({ description: 'Можно повторить передачу вручную' }) canRetry: boolean;

  static from(r: OrderExportRecord): OrderExportDto {
    return {
      id: r.id,
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      branchId: r.branchId,
      provider: r.provider,
      status: r.status,
      posOrderId: r.posOrderId,
      attempts: r.attempts,
      manualRetries: r.manualRetries,
      lastError: r.lastError,
      failureReason: r.failureReason,
      skipReason: r.skipReason,
      missingMappings: (r.details.missing ?? []).map(MissingMappingDto.from),
      lastAttemptAt: r.lastAttemptAt,
      sentAt: r.sentAt,
      confirmedAt: r.confirmedAt,
      failedAt: r.failedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      canRetry: ORDER_EXPORT_MACHINE.canTransition(r.status, 'pending'),
    };
  }
}

export class OrderExportsPageDto extends PageDtoOf(OrderExportDto) {}

export class RetryFailedExportsResultDto {
  @ApiProperty({ description: 'Сколько неудачных передач поставлено на повтор' }) retried: number;
  @ApiProperty({ type: [String], description: 'id повторённых передач' }) exportIds: string[];
  @ApiProperty({ description: `Неудачных передач осталось сверх лимита одного запроса (${BULK_RETRY_MAX}) — повторите запрос` }) remaining: number;
}

export class OrderExportsQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ enum: ORDER_EXPORT_STATUSES }) @IsOptional() @IsIn(ORDER_EXPORT_STATUSES) status?: OrderExportStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() orderId?: string;
}

// ---------------------------------------------------------------- Сопоставления

export class ModifierMappingDto {
  @ApiProperty({ description: 'Опция модификатора витрины' }) @IsUUID() optionId: string;
  @ApiProperty({ description: 'Товар-модификатор POS' }) @IsString() @MinLength(1) @MaxLength(EXTERNAL_ID_MAX_LENGTH) externalProductId: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Группа модификаторов POS (для групповых модификаторов)' })
  @IsOptional()
  @IsString()
  @MaxLength(EXTERNAL_ID_MAX_LENGTH)
  externalGroupId?: string | null;
}

export class ProductMappingUpdateDto {
  @ApiProperty({ description: 'Товар POS (id в номенклатуре POS)' }) @IsString() @MinLength(1) @MaxLength(EXTERNAL_ID_MAX_LENGTH) externalProductId: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Название товара в POS (по умолчанию — из импортированной номенклатуры)' })
  @IsOptional()
  @IsString()
  @MaxLength(EXTERNAL_NAME_MAX_LENGTH)
  externalName?: string | null;
  @ApiPropertyOptional({ type: [ModifierMappingDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_MODIFIER_MAPPINGS)
  @ValidateNested({ each: true })
  @Type(() => ModifierMappingDto)
  modifiers?: ModifierMappingDto[];
}

export class ProductMappingInputDto extends ProductMappingUpdateDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty({ description: 'Блюдо витрины' }) @IsUUID() dishId: string;
  @ApiPropertyOptional({ description: 'Провайдер POS; по умолчанию — POS филиала по маршрутизации' })
  @IsOptional()
  @Matches(PROVIDER_RE)
  provider?: string;
}

export class ProductMappingDto {
  @ApiProperty() id: string;
  @ApiProperty() branchId: string;
  @ApiProperty() dishId: string;
  @ApiPropertyOptional({ type: TranslatableDto, nullable: true, description: 'null — блюда больше нет в меню филиала' })
  dishName: TranslatableDto | null;
  @ApiProperty() provider: string;
  @ApiProperty() externalProductId: string;
  @ApiPropertyOptional({ type: String, nullable: true }) externalName: string | null;
  @ApiProperty({ type: [ModifierMappingDto] }) modifiers: ModifierMappingDto[];
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  static from(m: ProductMappingView): ProductMappingDto {
    return {
      id: m.id,
      branchId: m.branchId,
      dishId: m.dishId,
      dishName: m.dishName,
      provider: m.provider,
      externalProductId: m.externalProductId,
      externalName: m.externalName,
      modifiers: Object.entries(m.modifiers).map(([optionId, v]) => ({ optionId, externalProductId: v.externalProductId, externalGroupId: v.externalGroupId })),
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
  }
}

export class ProductMappingsPageDto extends PageDtoOf(ProductMappingDto) {}

export class ProductMappingsQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(PROVIDER_RE) provider?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() dishId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(EXTERNAL_ID_MAX_LENGTH) externalProductId?: string;
  @ApiPropertyOptional({ description: 'Поиск по части названия товара POS (externalName) или его id, без учёта регистра' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class BulkMappingItemDto {
  @ApiProperty() @IsUUID() dishId: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(EXTERNAL_ID_MAX_LENGTH) externalProductId: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(EXTERNAL_NAME_MAX_LENGTH) externalName?: string | null;
}

export class BulkMappingsDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiPropertyOptional() @IsOptional() @Matches(PROVIDER_RE) provider?: string;
  @ApiProperty({ type: [BulkMappingItemDto], maxItems: BULK_MAPPINGS_MAX })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_MAPPINGS_MAX)
  @ValidateNested({ each: true })
  @Type(() => BulkMappingItemDto)
  items: BulkMappingItemDto[];
}

export class BulkMappingsResultDto {
  @ApiProperty() created: number;
  @ApiProperty() updated: number;
  @ApiProperty() unchanged: number;
  @ApiProperty({ type: [ProductMappingDto] }) items: ProductMappingDto[];
}

// ---------------------------------------------------------------- Номенклатура POS и подсказки

export class PosProductDto {
  @ApiProperty() id: string;
  @ApiProperty() externalProductId: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Код/артикул товара в POS' }) sku: string | null;
  @ApiProperty({ enum: POS_PRODUCT_KINDS }) kind: PosProductKind;
  @ApiPropertyOptional({ type: String, nullable: true }) groupName: string | null;
  @ApiProperty() importedAt: Date;
  @ApiProperty({ description: 'Товар пропал из номенклатуры POS при последнем импорте' }) removed: boolean;
  @ApiProperty({ type: [String], description: 'Сопоставленные блюда' }) mappedDishIds: string[];

  static from(p: PosProductView): PosProductDto {
    return {
      id: p.id,
      externalProductId: p.externalProductId,
      name: p.name,
      sku: p.sku,
      kind: p.kind,
      groupName: p.groupName,
      importedAt: p.importedAt,
      removed: p.removedAt !== null,
      mappedDishIds: [...p.mappedDishIds],
    };
  }
}

export class PosProductsPageDto extends PageDtoOf(PosProductDto) {
  @ApiProperty({ description: 'Провайдер, чья номенклатура показана' }) provider: string;
}

export class PosProductsQueryDto extends PageQueryDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiPropertyOptional() @IsOptional() @Matches(PROVIDER_RE) provider?: string;
  @ApiPropertyOptional({ description: 'Поиск по названию, коду, id' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: POS_PRODUCT_KINDS }) @IsOptional() @IsIn(POS_PRODUCT_KINDS) kind?: PosProductKind;
  @ApiPropertyOptional({ description: 'Только несопоставленные' }) @IsOptional() @Transform(toBoolean) @IsBoolean() unmappedOnly?: boolean;
  @ApiPropertyOptional({ description: 'Показать пропавшие из POS' }) @IsOptional() @Transform(toBoolean) @IsBoolean() includeRemoved?: boolean;
}

export class SuggestionCandidateDto {
  @ApiProperty() dishId: string;
  @ApiPropertyOptional({ type: TranslatableDto, nullable: true }) dishName: TranslatableDto | null;
  @ApiProperty({ description: 'Похожесть 0..1' }) score: number;
  @ApiProperty({ enum: ['sku', 'name'], description: 'sku — совпал код; name — похожее название' }) method: 'sku' | 'name';
}

export class MappingSuggestionDto {
  @ApiProperty({ type: PosProductDto }) product: PosProductDto;
  @ApiProperty({ type: [SuggestionCandidateDto] }) candidates: SuggestionCandidateDto[];

  static from(s: MappingSuggestion): MappingSuggestionDto {
    return {
      product: PosProductDto.from({ ...s.product, mappedDishIds: [] }),
      candidates: s.candidates.map((c) => ({ ...c })),
    };
  }
}

export class MappingSuggestionsPageDto extends PageDtoOf(MappingSuggestionDto) {
  @ApiProperty() provider: string;
}

export class SuggestionsQueryDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiPropertyOptional() @IsOptional() @Matches(PROVIDER_RE) provider?: string;
  @ApiPropertyOptional({ default: 1, minimum: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100, description: 'Товаров на страницу (поиск по меню для каждого)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number;
}

// ---------------------------------------------------------------- Блюда филиала для сопоставления

export class PosDishesQueryDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiPropertyOptional({ description: 'Провайдер; по умолчанию — провайдер филиала' }) @IsOptional() @Matches(PROVIDER_RE) provider?: string;
  @ApiPropertyOptional({ description: 'Поиск по названию блюда или артикулу (sku)' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ description: 'Только блюда без сопоставления' }) @IsOptional() @Transform(toBoolean) @IsBoolean() unmappedOnly?: boolean;
}

export class PosDishOptionDto {
  @ApiProperty() optionId: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Товар-модификатор POS; null — опция не сопоставлена' })
  externalProductId: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Группа модификаторов POS' }) externalGroupId: string | null;
}

export class PosDishGroupDto {
  @ApiProperty() groupId: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty() isRequired: boolean;
  @ApiProperty({ type: [PosDishOptionDto] }) options: PosDishOptionDto[];
}

export class PosDishMappingRefDto {
  @ApiProperty({ description: 'id сопоставления (PUT/DELETE /admin/pos/mappings/{id})' }) mappingId: string;
  @ApiProperty() externalProductId: string;
  @ApiPropertyOptional({ type: String, nullable: true }) externalName: string | null;
}

export class PosDishDto {
  @ApiProperty() dishId: string;
  @ApiProperty() categoryId: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiPropertyOptional({ type: String, nullable: true }) sku: string | null;
  @ApiProperty({ type: MoneyDto }) price: MoneyDto;
  @ApiProperty({ description: 'Блюдо в стоп-листе филиала' }) stopped: boolean;
  @ApiPropertyOptional({ type: PosDishMappingRefDto, nullable: true, description: 'null — блюдо не сопоставлено с товаром POS' })
  mapping: PosDishMappingRefDto | null;
  @ApiProperty({ type: [String], description: 'Опции модификаторов без сопоставления' }) unmappedOptionIds: string[];
  @ApiProperty({ type: [PosDishGroupDto] }) modifierGroups: PosDishGroupDto[];

  static from(d: PosDishView): PosDishDto {
    return {
      dishId: d.dishId,
      categoryId: d.categoryId,
      name: d.name,
      sku: d.sku,
      price: MoneyDto.from(d.price),
      stopped: d.stopped,
      mapping: d.mapping ? { ...d.mapping } : null,
      unmappedOptionIds: [...d.unmappedOptionIds],
      modifierGroups: d.modifierGroups.map((g) => ({ ...g, options: g.options.map((o) => ({ ...o })) })),
    };
  }
}

export class PosDishCategoryDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
}

export class PosDishesDto {
  @ApiProperty() branchId: string;
  @ApiProperty({ description: 'Провайдер, чьи сопоставления показаны' }) provider: string;
  @ApiProperty({ type: [PosDishCategoryDto] }) categories: PosDishCategoryDto[];
  @ApiProperty({ type: [PosDishDto], description: 'Все блюда меню филиала (включая стоп-лист) с модификаторами' }) dishes: PosDishDto[];
}
