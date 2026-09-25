/**
 * Каталог филиала для SSR (модуль Catalog): меню, категория, блюдо, поиск.
 * Ответы кэшируются кэшем данных Next.js на 60 с (как s-maxage API) с тегами для точечного
 * сброса (revalidateTag('menu:<branch>')), в рамках одного запроса — React cache
 * (layout с проверкой 404 и страница делят один запрос к API).
 *
 * null — «не найдено» (404 API → настоящий HTTP 404 витрины); прочие ошибки пробрасываются
 * (страница ошибки с повтором), кроме функций *OrNull.
 */
import { cache } from 'react';
import { ApiError, call } from '@aula/api-client';
import type { AppLocale } from '@/i18n/routing';
import { createServerApi } from './api';
import type { BranchMenu, CategoryPage, DishDetail, DishPage } from './api-types';
import { filtersToApiQuery, type MenuFilters } from './menu-filters';

function menuApi(locale: AppLocale, branchSlug: string) {
  return createServerApi({ locale, tags: ['menu', `menu:${branchSlug}`] });
}

async function notFoundAsNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) return null;
    throw error;
  }
}

/** Меню филиала: категории с блюдами, цены и доступность филиала. null — филиала нет. */
export const getBranchMenu = cache(async (locale: AppLocale, branchSlug: string): Promise<BranchMenu | null> => {
  const api = menuApi(locale, branchSlug);
  return notFoundAsNull(
    call(api.GET('/api/v1/public/catalog/branches/{branchSlug}/menu', { params: { path: { branchSlug }, query: { locale } } })),
  ) as Promise<BranchMenu | null>;
});

/** Меню для второстепенных блоков (главная): любая ошибка → null. */
export async function getBranchMenuOrNull(locale: AppLocale, branchSlug: string): Promise<BranchMenu | null> {
  try {
    return await getBranchMenu(locale, branchSlug);
  } catch (error) {
    console.warn('[catalog] menu unavailable:', error instanceof Error ? error.message : error);
    return null;
  }
}

/** Страница категории: категория, навигация по категориям, блюда. null — категории (или филиала) нет. */
export const getCategoryPage = cache(
  async (locale: AppLocale, branchSlug: string, categorySlug: string): Promise<CategoryPage | null> => {
    const api = menuApi(locale, branchSlug);
    return notFoundAsNull(
      call(
        api.GET('/api/v1/public/catalog/branches/{branchSlug}/categories/{categorySlug}', {
          params: { path: { branchSlug, categorySlug }, query: { locale } },
        }),
      ),
    ) as Promise<CategoryPage | null>;
  },
);

/** Карточка блюда с модификаторами. null — блюда нет в меню филиала (или оно скрыто стоп-листом). */
export const getDish = cache(async (locale: AppLocale, branchSlug: string, dishSlug: string): Promise<DishDetail | null> => {
  const api = menuApi(locale, branchSlug);
  return notFoundAsNull(
    call(
      api.GET('/api/v1/public/catalog/branches/{branchSlug}/dishes/{dishSlug}', {
        params: { path: { branchSlug, dishSlug }, query: { locale } },
      }),
    ),
  ) as Promise<DishDetail | null>;
});

const searchCached = cache(async (locale: AppLocale, branchSlug: string, queryJson: string): Promise<DishPage> => {
  const api = menuApi(locale, branchSlug);
  const query = JSON.parse(queryJson) as ReturnType<typeof filtersToApiQuery>;
  return (await call(
    api.GET('/api/v1/public/catalog/branches/{branchSlug}/search', {
      params: { path: { branchSlug }, query: { ...query, locale } },
    }),
  )) as unknown as DishPage;
});

/** Поиск и фильтры (фильтрует сервер). */
export function searchMenu(locale: AppLocale, branchSlug: string, filters: MenuFilters): Promise<DishPage> {
  return searchCached(locale, branchSlug, JSON.stringify(filtersToApiQuery(filters)));
}
