/**
 * Типизированные обёртки над эндпоинтами модуля Catalog (меню, меню филиалов, стоп-лист, контент витрины).
 * Возвращают данные или бросают ApiError.
 *
 * Приведение типов (as unknown as ...) — из-за неточностей docs/openapi.json в DTO каталога:
 * nullable-поля без `type` (openapi-typescript выводит Record<string, never>), необязательные поля
 * с default описаны как обязательные. Реальные формы — в @aula/api-client/types (Category, Dish, ...).
 */
import {
  call,
  type AddMenuItemInput,
  type AllergenRef,
  type AvailabilityResult,
  type Banner,
  type BannerInput,
  type BannerPlacement,
  type BranchMenuItem,
  type BulkPricesResult,
  type Category,
  type CategoryInput,
  type ContentPage,
  type ContentPageInput,
  type CopyMenuResult,
  type Dish,
  type DishInput,
  type MenuItemAvailability,
  type ModifierGroup,
  type ModifierGroupInput,
  type Page,
  type Promotion,
  type PromotionInput,
  type Schemas,
  type SetAvailabilityInput,
  type SetMenuPriceInput,
  type TranslationEntityType,
  type TranslationReport,
} from '@aula/api-client';
import { api } from './client';

/** Числа, булевы и пустые значения → строки параметров запроса (бэкенд принимает строки). */
function query<T extends Record<string, string | number | boolean | null | undefined>>(params: T): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    result[key] = String(value);
  }
  return result;
}

function body<T>(value: unknown): T {
  return value as T;
}

/** multipart/form-data с одним файлом (поле file) или несколькими (поле files). */
export function imageFormData(files: File | readonly File[]): FormData {
  const form = new FormData();
  if (Array.isArray(files)) for (const file of files as readonly File[]) form.append('files', file, file.name);
  else form.append('file', files as File, (files as File).name);
  return form;
}

export interface DishListQuery {
  q?: string;
  categoryId?: string;
  isActive?: boolean;
  /** Только блюда, которых нет в меню филиала. */
  notInBranchId?: string;
  page?: number;
  perPage?: number;
}

export interface BranchMenuQuery {
  q?: string;
  categoryId?: string;
  availability?: MenuItemAvailability;
  page?: number;
  perPage?: number;
}

export interface TranslationReportQuery {
  /** Языки через запятую (по умолчанию kk,ru). */
  locales?: string;
  entityType?: TranslationEntityType;
}

export const catalogApi = {
  // ---------------------------------------------------------- Категории
  categories: async () => (await call(api.GET('/api/v1/admin/catalog/categories'))) as unknown as Category[],
  category: async (id: string) =>
    (await call(api.GET('/api/v1/admin/catalog/categories/{id}', { params: { path: { id } } }))) as unknown as Category,
  createCategory: async (input: CategoryInput) =>
    (await call(
      api.POST('/api/v1/admin/catalog/categories', { body: body<Schemas['CategoryInputDto']>(input) }),
    )) as unknown as Category,
  updateCategory: async (id: string, input: CategoryInput) =>
    (await call(
      api.PUT('/api/v1/admin/catalog/categories/{id}', { params: { path: { id } }, body: body<Schemas['CategoryInputDto']>(input) }),
    )) as unknown as Category,
  deleteCategory: (id: string) => call(api.DELETE('/api/v1/admin/catalog/categories/{id}', { params: { path: { id } } })),
  /** Все категории в нужном порядке; ответ — список в новом порядке. */
  reorderCategories: async (ids: string[]) =>
    (await call(api.PUT('/api/v1/admin/catalog/categories/order', { body: { ids } }))) as unknown as Category[],
  uploadCategoryImage: async (id: string, file: File) =>
    (await call(
      api.POST('/api/v1/admin/catalog/categories/{id}/image', {
        params: { path: { id } },
        body: body<{ file: string }>(imageFormData(file)),
      }),
    )) as unknown as Category,
  removeCategoryImage: async (id: string) =>
    (await call(api.DELETE('/api/v1/admin/catalog/categories/{id}/image', { params: { path: { id } } }))) as unknown as Category,

  // ---------------------------------------------------------- Блюда
  dishes: async (params: DishListQuery) =>
    (await call(api.GET('/api/v1/admin/catalog/dishes', { params: { query: query({ ...params }) } }))) as unknown as Page<Dish>,
  dish: async (id: string) => (await call(api.GET('/api/v1/admin/catalog/dishes/{id}', { params: { path: { id } } }))) as unknown as Dish,
  createDish: async (input: DishInput) =>
    (await call(api.POST('/api/v1/admin/catalog/dishes', { body: body<Schemas['DishInputDto']>(input) }))) as unknown as Dish,
  updateDish: async (id: string, input: DishInput) =>
    (await call(
      api.PUT('/api/v1/admin/catalog/dishes/{id}', { params: { path: { id } }, body: body<Schemas['DishInputDto']>(input) }),
    )) as unknown as Dish,
  deleteDish: (id: string) => call(api.DELETE('/api/v1/admin/catalog/dishes/{id}', { params: { path: { id } } })),
  uploadDishPhotos: async (id: string, files: readonly File[]) =>
    (await call(
      api.POST('/api/v1/admin/catalog/dishes/{id}/photos', {
        params: { path: { id } },
        body: body<{ files: string[] }>(imageFormData(files)),
      }),
    )) as unknown as Dish,
  deleteDishPhoto: async (id: string, photoId: string) =>
    (await call(
      api.DELETE('/api/v1/admin/catalog/dishes/{id}/photos/{photoId}', { params: { path: { id, photoId } } }),
    )) as unknown as Dish,
  /** Все фото блюда в нужном порядке; первое — обложка. */
  reorderDishPhotos: async (id: string, photoIds: string[]) =>
    (await call(
      api.PUT('/api/v1/admin/catalog/dishes/{id}/photos/order', { params: { path: { id } }, body: { photoIds } }),
    )) as unknown as Dish,

  // ---------------------------------------------------------- Модификаторы
  modifierGroups: async () => (await call(api.GET('/api/v1/admin/catalog/modifier-groups'))) as unknown as ModifierGroup[],
  createModifierGroup: async (input: ModifierGroupInput) =>
    (await call(
      api.POST('/api/v1/admin/catalog/modifier-groups', { body: body<Schemas['ModifierGroupInputDto']>(input) }),
    )) as unknown as ModifierGroup,
  updateModifierGroup: async (id: string, input: ModifierGroupInput) =>
    (await call(
      api.PUT('/api/v1/admin/catalog/modifier-groups/{id}', {
        params: { path: { id } },
        body: body<Schemas['ModifierGroupInputDto']>(input),
      }),
    )) as unknown as ModifierGroup,
  deleteModifierGroup: (id: string) => call(api.DELETE('/api/v1/admin/catalog/modifier-groups/{id}', { params: { path: { id } } })),

  // ---------------------------------------------------------- Справочники и отчёты
  allergens: async () => (await call(api.GET('/api/v1/admin/catalog/allergens'))) as unknown as AllergenRef[],
  translations: async (params: TranslationReportQuery) =>
    (await call(
      api.GET('/api/v1/admin/catalog/translations', { params: { query: query({ ...params }) } }),
    )) as unknown as TranslationReport,
};

/** Меню филиала: цены (menu.prices) и стоп-лист (menu.stoplist) — всегда в разрезе филиала. */
export const branchMenuApi = {
  list: async (branchId: string, params: BranchMenuQuery) =>
    (await call(
      api.GET('/api/v1/admin/catalog/branches/{branchId}/menu', { params: { path: { branchId }, query: query({ ...params }) } }),
    )) as unknown as Page<BranchMenuItem>,
  add: async (branchId: string, input: AddMenuItemInput) =>
    (await call(
      api.POST('/api/v1/admin/catalog/branches/{branchId}/menu', {
        params: { path: { branchId } },
        body: body<Schemas['AddMenuItemDto']>(input),
      }),
    )) as unknown as BranchMenuItem,
  remove: (branchId: string, dishId: string) =>
    call(api.DELETE('/api/v1/admin/catalog/branches/{branchId}/menu/{dishId}', { params: { path: { branchId, dishId } } })),
  setPrice: async (branchId: string, dishId: string, input: SetMenuPriceInput) =>
    (await call(
      api.PUT('/api/v1/admin/catalog/branches/{branchId}/menu/{dishId}/price', {
        params: { path: { branchId, dishId } },
        body: body<Schemas['SetPriceDto']>(input),
      }),
    )) as unknown as BranchMenuItem,
  /** Массовое изменение цен: всё или ничего. */
  bulkPrices: async (branchId: string, items: Array<{ dishId: string; price: { amount: number } }>) =>
    (await call(
      api.POST('/api/v1/admin/catalog/branches/{branchId}/menu/bulk-prices', {
        params: { path: { branchId } },
        body: body<Schemas['BulkPricesDto']>({ items }),
      }),
    )) as unknown as BulkPricesResult,
  copy: async (branchId: string, input: { fromBranchId: string; overwritePrices: boolean }) =>
    (await call(
      api.POST('/api/v1/admin/catalog/branches/{branchId}/menu/copy', {
        params: { path: { branchId } },
        body: input,
      }),
    )) as unknown as CopyMenuResult,
  setAvailability: async (branchId: string, dishId: string, input: SetAvailabilityInput) =>
    (await call(
      api.PUT('/api/v1/admin/catalog/branches/{branchId}/menu/{dishId}/availability', {
        params: { path: { branchId, dishId } },
        body: body<Schemas['SetAvailabilityDto']>(input),
      }),
    )) as unknown as AvailabilityResult,
  stopList: async (branchId: string) =>
    (await call(
      api.GET('/api/v1/admin/catalog/branches/{branchId}/stop-list', { params: { path: { branchId } } }),
    )) as unknown as BranchMenuItem[],
};

/** Контент витрины (content.manage): баннеры, акции, страницы. */
export const contentApi = {
  banners: async (params: { placement?: BannerPlacement; branchId?: string }) =>
    (await call(api.GET('/api/v1/admin/content/banners', { params: { query: query({ ...params }) } }))) as unknown as Banner[],
  createBanner: async (input: BannerInput) =>
    (await call(api.POST('/api/v1/admin/content/banners', { body: body<Schemas['BannerInputDto']>(input) }))) as unknown as Banner,
  updateBanner: async (id: string, input: BannerInput) =>
    (await call(
      api.PUT('/api/v1/admin/content/banners/{id}', { params: { path: { id } }, body: body<Schemas['BannerInputDto']>(input) }),
    )) as unknown as Banner,
  deleteBanner: (id: string) => call(api.DELETE('/api/v1/admin/content/banners/{id}', { params: { path: { id } } })),
  uploadBannerImage: async (id: string, file: File) =>
    (await call(
      api.POST('/api/v1/admin/content/banners/{id}/image', {
        params: { path: { id } },
        body: body<{ file: string }>(imageFormData(file)),
      }),
    )) as unknown as Banner,

  promotions: async () => (await call(api.GET('/api/v1/admin/content/promotions'))) as unknown as Promotion[],
  createPromotion: async (input: PromotionInput) =>
    (await call(
      api.POST('/api/v1/admin/content/promotions', { body: body<Schemas['PromotionInputDto']>(input) }),
    )) as unknown as Promotion,
  updatePromotion: async (id: string, input: PromotionInput) =>
    (await call(
      api.PUT('/api/v1/admin/content/promotions/{id}', { params: { path: { id } }, body: body<Schemas['PromotionInputDto']>(input) }),
    )) as unknown as Promotion,
  deletePromotion: (id: string) => call(api.DELETE('/api/v1/admin/content/promotions/{id}', { params: { path: { id } } })),
  uploadPromotionImage: async (id: string, file: File) =>
    (await call(
      api.POST('/api/v1/admin/content/promotions/{id}/image', {
        params: { path: { id } },
        body: body<{ file: string }>(imageFormData(file)),
      }),
    )) as unknown as Promotion,

  pages: async () => (await call(api.GET('/api/v1/admin/content/pages'))) as unknown as ContentPage[],
  page: async (id: string) => (await call(api.GET('/api/v1/admin/content/pages/{id}', { params: { path: { id } } }))) as unknown as ContentPage,
  createPage: async (input: ContentPageInput) =>
    (await call(api.POST('/api/v1/admin/content/pages', { body: body<Schemas['PageInputDto']>(input) }))) as unknown as ContentPage,
  updatePage: async (id: string, input: ContentPageInput) =>
    (await call(
      api.PUT('/api/v1/admin/content/pages/{id}', { params: { path: { id } }, body: body<Schemas['PageInputDto']>(input) }),
    )) as unknown as ContentPage,
  deletePage: (id: string) => call(api.DELETE('/api/v1/admin/content/pages/{id}', { params: { path: { id } } })),
};
