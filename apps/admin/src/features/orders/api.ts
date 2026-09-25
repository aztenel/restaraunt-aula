/**
 * Эндпоинты заказов в админке (модуль Ordering) и справочники витрины для телефонного заказа.
 * Возвращают данные или бросают ApiError. Приведение типов — см. ./types.ts.
 *
 * Ключи запросов заказов начинаются с 'orders' — их инвалидирует лента событий (useAdminFeed).
 */
import { call, type Page } from '@aula/api-client';
import { api } from '@/shared/api/client';
import type {
  AdminCreateOrderInput,
  AdminOrderDetails,
  AdminOrderListItem,
  CancelOrderInput,
  OrderQueue,
  OrderQuote,
  OrderSlots,
  OrdersListQuery,
  OrderType,
  PublicDeliveryZone,
  PublicDishDetail,
  PublicMenu,
  QuoteOrderInput,
  RefundOrderInput,
  StaffTransitionTarget,
} from './types';

type Locale = 'kk' | 'ru' | 'en';

export const ordersKeys = {
  all: ['orders'] as const,
  queue: (branchId: string | null) => ['orders', 'queue', branchId ?? 'all'] as const,
  list: (params: OrdersListQuery) => ['orders', 'list', params] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
};

/** Ключи справочников телефонного заказа: не под 'orders', чтобы лента их не перезапрашивала. */
export const phoneOrderKeys = {
  quote: (input: QuoteOrderInput | null) => ['phone-order', 'quote', input] as const,
  menu: (branchSlug: string, locale: Locale) => ['phone-order', 'menu', branchSlug, locale] as const,
  dish: (branchSlug: string, dishSlug: string, locale: Locale) => ['phone-order', 'dish', branchSlug, dishSlug, locale] as const,
  slots: (branchId: string, type: OrderType, date: string | null) => ['phone-order', 'slots', branchId, type, date] as const,
  zones: (branchId: string, locale: Locale) => ['phone-order', 'zones', branchId, locale] as const,
};

export const ordersApi = {
  list: async (params: OrdersListQuery) =>
    (await call(
      api.GET('/api/v1/admin/orders', {
        params: {
          query: {
            branchId: params.branchId,
            status: params.status && params.status.length > 0 ? params.status : undefined,
            type: params.type,
            dateFrom: params.dateFrom,
            dateTo: params.dateTo,
            q: params.q?.trim() || undefined,
            page: params.page,
            perPage: params.perPage,
          },
        },
      }),
    )) as unknown as Page<AdminOrderListItem>,
  queue: async (branchId: string | null) =>
    (await call(api.GET('/api/v1/admin/orders/queue', { params: { query: { branchId: branchId ?? undefined } } }))) as unknown as OrderQueue,
  get: async (id: string) => (await call(api.GET('/api/v1/admin/orders/{id}', { params: { path: { id } } }))) as unknown as AdminOrderDetails,
  transition: async (id: string, to: StaffTransitionTarget) =>
    (await call(api.POST('/api/v1/admin/orders/{id}/transition', { params: { path: { id } }, body: { to } }))) as unknown as AdminOrderDetails,
  /** Отказ от оплаченного заказа: paid → accepted → cancelled и возврат. */
  reject: async (id: string, input: CancelOrderInput) =>
    (await call(
      api.POST('/api/v1/admin/orders/{id}/reject', { params: { path: { id } }, body: input }),
    )) as unknown as AdminOrderDetails,
  cancel: async (id: string, input: CancelOrderInput) =>
    (await call(
      api.POST('/api/v1/admin/orders/{id}/cancel', { params: { path: { id } }, body: input }),
    )) as unknown as AdminOrderDetails,
  refund: async (id: string, input: RefundOrderInput) =>
    (await call(
      api.POST('/api/v1/admin/orders/{id}/refund', { params: { path: { id } }, body: input }),
    )) as unknown as AdminOrderDetails,
  courierRetry: async (id: string) =>
    (await call(api.POST('/api/v1/admin/orders/{id}/courier/retry', { params: { path: { id } } }))) as unknown as AdminOrderDetails,
  courierCancel: async (id: string) =>
    (await call(api.POST('/api/v1/admin/orders/{id}/courier/cancel', { params: { path: { id } } }))) as unknown as AdminOrderDetails,
  /** Расчёт телефонного заказа: все суммы считает сервер. */
  quote: async (input: QuoteOrderInput) =>
    (await call(api.POST('/api/v1/admin/orders/quote', { body: input }))) as unknown as OrderQuote,
  /** Телефонный заказ (канал admin). Онлайн-оплата: ссылку гостю отправляет сервер. */
  create: async (input: AdminCreateOrderInput) =>
    (await call(api.POST('/api/v1/admin/orders', { body: input }))) as unknown as AdminOrderDetails,
};

/** Публичные справочники витрины (меню филиала с ценами, карточка блюда с модификаторами, слоты, зоны). */
export const storefrontApi = {
  menu: async (branchSlug: string, locale: Locale) =>
    (await call(
      api.GET('/api/v1/public/catalog/branches/{branchSlug}/menu', { params: { path: { branchSlug }, query: { locale } } }),
    )) as unknown as PublicMenu,
  dish: async (branchSlug: string, dishSlug: string, locale: Locale) =>
    (await call(
      api.GET('/api/v1/public/catalog/branches/{branchSlug}/dishes/{dishSlug}', {
        params: { path: { branchSlug, dishSlug }, query: { locale } },
      }),
    )) as unknown as PublicDishDetail,
  slots: async (branchId: string, type: OrderType, date: string | null, locale: Locale) =>
    (await call(
      api.GET('/api/v1/public/branches/{branchId}/order-slots', {
        params: { path: { branchId }, query: { type, date: date ?? undefined, locale } },
      }),
    )) as unknown as OrderSlots,
  zones: async (branchId: string, locale: Locale) =>
    (await call(
      api.GET('/api/v1/public/branches/{branchId}/delivery-zones', { params: { path: { branchId }, query: { locale } } }),
    )) as unknown as PublicDeliveryZone[],
};
