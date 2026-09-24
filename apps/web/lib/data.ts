/**
 * Серверные запросы данных витрины. Дедупликация в рамках запроса (React cache)
 * + кэш данных Next.js (revalidate). Сбой API не роняет страницу там, где можно показать
 * запасной вариант: функции *OrNull возвращают null при недоступности API.
 */
import { cache } from 'react';
import { cookies } from 'next/headers';
import { ApiError, call, type PublicBranch } from '@aula/api-client';
import { createServerApi } from './api';
import { BRANCH_COOKIE } from './branch-cookie';

export type BranchesResult = { ok: true; branches: PublicBranch[] } | { ok: false; error: ApiError };

function normalizeBranches(branches: PublicBranch[]): PublicBranch[] {
  // Порядок задаёт сервер (sortOrder); копия — чтобы не мутировать кэшированный объект.
  return [...branches];
}

/** Активные филиалы: GET /api/v1/public/branches. Не бросает исключений. */
export const getPublicBranches = cache(async (locale: string): Promise<BranchesResult> => {
  try {
    const api = createServerApi({ locale, tags: ['branches'] });
    // Схема OpenAPI описывает часть полей неточно — используем уточнённый тип PublicBranch.
    const data = (await call(api.GET('/api/v1/public/branches'))) as unknown as PublicBranch[];
    return { ok: true, branches: normalizeBranches(data) };
  } catch (error) {
    return { ok: false, error: error instanceof ApiError ? error : ApiError.network(error) };
  }
});

/**
 * Филиал по slug: GET /api/v1/public/branches/{slug}.
 * null — филиала нет (404); при недоступности API бросает ApiError (страница ошибки).
 */
export const getPublicBranch = cache(async (locale: string, slug: string): Promise<PublicBranch | null> => {
  const api = createServerApi({ locale, tags: ['branches', `branch:${slug}`] });
  try {
    return (await call(api.GET('/api/v1/public/branches/{slug}', { params: { path: { slug } } }))) as unknown as PublicBranch;
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) return null;
    throw error;
  }
});

/** Slug филиала, выбранного гостем (cookie). */
export async function getSelectedBranchSlug(): Promise<string | null> {
  const store = await cookies();
  return store.get(BRANCH_COOKIE)?.value ?? null;
}

/**
 * Выбранный филиал: из cookie, если он активен, иначе первый по порядку.
 * Для отображения в шапке и редиректа /menu.
 */
export function resolveSelectedBranch(branches: PublicBranch[], slug: string | null): PublicBranch | null {
  if (branches.length === 0) return null;
  return branches.find((b) => b.slug === slug) ?? null;
}
