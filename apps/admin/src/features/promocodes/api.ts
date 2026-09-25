/**
 * Промокоды (promocodes.manage): промокод филиала — право в этом филиале, на всю сеть — глобальное право.
 * Удаление логическое. Статистика использований (usage) приходит в списке.
 */
import { call, type Page, type Schemas } from '@aula/api-client';
import { api } from '@/shared/api/client';
import type { PromoCode, PromoCodeInput } from './promo-form';

function body<T>(value: unknown): T {
  return value as T;
}

export interface PromoListQuery {
  branchId?: string;
  q?: string;
  active?: boolean;
  page?: number;
  perPage?: number;
}

export const promoKeys = {
  all: ['promo-codes'] as const,
  list: (params: PromoListQuery) => ['promo-codes', 'list', params] as const,
};

export const promoApi = {
  list: async (params: PromoListQuery) =>
    (await call(
      api.GET('/api/v1/admin/promo-codes', {
        params: {
          query: {
            branchId: params.branchId,
            q: params.q?.trim() || undefined,
            active: params.active,
            page: params.page,
            perPage: params.perPage,
          },
        },
      }),
    )) as unknown as Page<PromoCode>,
  create: async (input: PromoCodeInput) =>
    (await call(api.POST('/api/v1/admin/promo-codes', { body: body<Schemas['PromoCodeInputDto']>(input) }))) as unknown as PromoCode,
  update: async (id: string, input: PromoCodeInput) =>
    (await call(
      api.PUT('/api/v1/admin/promo-codes/{id}', { params: { path: { id } }, body: body<Schemas['PromoCodeInputDto']>(input) }),
    )) as unknown as PromoCode,
  remove: (id: string) => call(api.DELETE('/api/v1/admin/promo-codes/{id}', { params: { path: { id } } })),
};
