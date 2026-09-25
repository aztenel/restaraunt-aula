/**
 * POS (модуль Pos): состояние интеграции по филиалам и ручная синхронизация стоп-листа, передачи заказов
 * (очередь неудач и повтор), сопоставление блюд с товарами POS, номенклатура и её импорт.
 * Типы — из сгенерированной схемы (docs/openapi.json). Возвращают данные или бросают ApiError.
 */
import { call, type Schemas } from '@aula/api-client';
import { api } from '@/shared/api/client';

export type PosBranchStatus = Schemas['PosBranchStatusDto'];
export type OrderExport = Schemas['OrderExportDto'];
export type OrderExportStatus = OrderExport['status'];
export type ProductMapping = Schemas['ProductMappingDto'];
export type ProductMappingInput = Schemas['ProductMappingInputDto'];
export type ProductMappingUpdate = Schemas['ProductMappingUpdateDto'];
export type MappingSuggestion = Schemas['MappingSuggestionDto'];
export type SuggestionCandidate = Schemas['SuggestionCandidateDto'];
export type PosProduct = Schemas['PosProductDto'];
export type PosProductKind = PosProduct['kind'];
export type BulkMappingItem = Schemas['BulkMappingItemDto'];
export type BulkMappingsResult = Schemas['BulkMappingsResultDto'];
export type QueuedJob = Schemas['QueuedJobDto'];

export const ORDER_EXPORT_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;
export const POS_PRODUCT_KINDS = ['dish', 'good', 'modifier', 'service', 'other'] as const;

/** Публичное меню филиала (для выбора блюда при сопоставлении — доступно без прав меню). */
export interface PublicMenuDish {
  id: string;
  slug: string;
  name: string;
  categoryName: string;
}

/** Опция модификатора блюда с витрины (для сопоставления модификаторов). */
export interface PublicModifierOption {
  id: string;
  name: string;
  groupName: string;
}

export const posKeys = {
  all: ['pos'] as const,
  status: (branchId: string | null) => ['pos', 'status', branchId ?? 'all'] as const,
  exports: (params: object) => ['pos', 'exports', params] as const,
  mappings: (params: object) => ['pos', 'mappings', params] as const,
  suggestions: (params: object) => ['pos', 'suggestions', params] as const,
  products: (params: object) => ['pos', 'products', params] as const,
  menu: (branchSlug: string, locale: string) => ['pos', 'menu', branchSlug, locale] as const,
  dishOptions: (branchSlug: string, dishSlug: string, locale: string) => ['pos', 'dish-options', branchSlug, dishSlug, locale] as const,
};

export const posApi = {
  status: (branchId: string | null) => call(api.GET('/api/v1/admin/pos/status', { params: { query: branchId ? { branchId } : {} } })),
  syncStopList: (branchId: string) => call(api.POST('/api/v1/admin/pos/stop-list/sync', { body: { branchId } })),

  exports: (params: { branchId?: string; status?: OrderExportStatus; orderId?: string; page: number; perPage: number }) =>
    call(api.GET('/api/v1/admin/pos/exports', { params: { query: params } })),
  retryExport: (id: string) => call(api.POST('/api/v1/admin/pos/exports/{id}/retry', { params: { path: { id } } })),

  mappings: (params: { branchId?: string; provider?: string; dishId?: string; externalProductId?: string; page: number; perPage: number }) =>
    call(api.GET('/api/v1/admin/pos/mappings', { params: { query: params } })),
  suggestions: (params: { branchId: string; provider?: string; page: number; perPage: number }) =>
    call(api.GET('/api/v1/admin/pos/mappings/suggestions', { params: { query: params } })),
  createMapping: (input: ProductMappingInput) => call(api.POST('/api/v1/admin/pos/mappings', { body: input })),
  updateMapping: (id: string, input: ProductMappingUpdate) =>
    call(api.PUT('/api/v1/admin/pos/mappings/{id}', { params: { path: { id } }, body: input })),
  deleteMapping: (id: string) => call(api.DELETE('/api/v1/admin/pos/mappings/{id}', { params: { path: { id } } })),
  bulkMappings: (input: { branchId: string; provider?: string; items: BulkMappingItem[] }) =>
    call(api.POST('/api/v1/admin/pos/mappings/bulk', { body: input })),

  products: (params: {
    branchId: string;
    provider?: string;
    q?: string;
    kind?: PosProductKind;
    unmappedOnly?: boolean;
    includeRemoved?: boolean;
    page: number;
    perPage: number;
  }) => call(api.GET('/api/v1/admin/pos/products', { params: { query: params } })),
  importProducts: (branchId: string) => call(api.POST('/api/v1/admin/pos/products/import', { body: { branchId } })),

  /** Блюда меню филиала с витрины (названия на языке интерфейса). */
  publicMenu: async (branchSlug: string, locale: 'kk' | 'ru' | 'en'): Promise<PublicMenuDish[]> => {
    const menu = (await call(
      api.GET('/api/v1/public/catalog/branches/{branchSlug}/menu', { params: { path: { branchSlug }, query: { locale } } }),
    )) as unknown as { categories: Array<{ name: string; dishes: Array<{ id: string; slug: string; name: string }> }> };
    return menu.categories.flatMap((c) => c.dishes.map((d) => ({ id: d.id, slug: d.slug, name: d.name, categoryName: c.name })));
  },

  /** Опции модификаторов блюда (витрина). */
  publicDishOptions: async (branchSlug: string, dishSlug: string, locale: 'kk' | 'ru' | 'en'): Promise<PublicModifierOption[]> => {
    const dish = (await call(
      api.GET('/api/v1/public/catalog/branches/{branchSlug}/dishes/{dishSlug}', {
        params: { path: { branchSlug, dishSlug }, query: { locale } },
      }),
    )) as unknown as { modifierGroups?: Array<{ name: string; options: Array<{ id: string; name: string }> }> };
    return (dish.modifierGroups ?? []).flatMap((g) => g.options.map((o) => ({ id: o.id, name: o.name, groupName: g.name })));
  },
};
