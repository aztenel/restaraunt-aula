/**
 * Карта сайта: статические разделы × языки, страницы и меню филиалов, а также каталог:
 * категории, блюда и текстовые страницы из GET /api/v1/public/catalog/sitemap (модуль Catalog).
 */
import type { MetadataRoute } from 'next';
import { ApiError, type PublicBranch } from '@aula/api-client';
import { routing } from '@/i18n/routing';
import { createServerApi } from './api';
import { routes } from './routes';
import { languageAlternates, localizedUrl } from './seo';

type SitemapEntry = MetadataRoute.Sitemap[number];
type ChangeFrequency = NonNullable<SitemapEntry['changeFrequency']>;

/**
 * ТОЧКА РАСШИРЕНИЯ: ответ GET /api/v1/public/catalog/sitemap (SitemapDto модуля Catalog).
 * Все поля необязательны — витрина берёт то, что есть (эндпоинт может быть ещё не развёрнут).
 * updatedAt — ISO 8601. promotions пока не выводятся: на витрине нет страницы акции
 * (TODO(catalog): /[locale]/promotions/[slug] → GET /api/v1/public/content/promotions/{slug}).
 */
export interface SitemapData {
  branches?: Array<{ slug: string; updatedAt?: string | null }>;
  categories?: Array<{ branchSlug: string; slug: string; updatedAt?: string | null }>;
  dishes?: Array<{ branchSlug: string; categorySlug: string; slug: string; updatedAt?: string | null }>;
  pages?: Array<{ slug: string; updatedAt?: string | null }>;
  promotions?: Array<{ slug: string; updatedAt?: string | null }>;
}

export const SITEMAP_DATA_PATH = '/api/v1/public/catalog/sitemap';

const STATIC_PAGES: Array<{ path: string; changeFrequency: ChangeFrequency; priority: number }> = [
  { path: routes.home(), changeFrequency: 'daily', priority: 1 },
  { path: routes.branches(), changeFrequency: 'weekly', priority: 0.8 },
  { path: routes.booking(), changeFrequency: 'monthly', priority: 0.7 },
  { path: routes.banquets(), changeFrequency: 'monthly', priority: 0.8 },
  { path: routes.certificates(), changeFrequency: 'monthly', priority: 0.6 },
];

function toDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Одна страница → запись на каждом языке с hreflang-альтернативами. */
function entriesFor(
  siteUrl: string,
  path: string,
  options: { changeFrequency: ChangeFrequency; priority: number; lastModified?: Date },
): SitemapEntry[] {
  const languages = languageAlternates(path, siteUrl);
  return routing.locales.map((locale) => ({
    url: localizedUrl(locale, path, siteUrl),
    lastModified: options.lastModified,
    changeFrequency: options.changeFrequency,
    priority: options.priority,
    alternates: { languages },
  }));
}

export function buildSitemapEntries(input: {
  siteUrl: string;
  branches: PublicBranch[];
  catalog: SitemapData | null;
}): MetadataRoute.Sitemap {
  const { siteUrl, branches, catalog } = input;
  const entries: SitemapEntry[] = [];
  for (const page of STATIC_PAGES) {
    entries.push(...entriesFor(siteUrl, page.path, page));
  }
  const branchUpdatedAt = new Map((catalog?.branches ?? []).map((b) => [b.slug, toDate(b.updatedAt)]));
  for (const branch of branches) {
    const lastModified = branchUpdatedAt.get(branch.slug);
    entries.push(...entriesFor(siteUrl, routes.branch(branch.slug), { changeFrequency: 'weekly', priority: 0.8 }));
    entries.push(...entriesFor(siteUrl, routes.branchMenu(branch.slug), { changeFrequency: 'daily', priority: 0.9, lastModified }));
  }
  const activeSlugs = new Set(branches.map((b) => b.slug));
  for (const category of catalog?.categories ?? []) {
    if (!activeSlugs.has(category.branchSlug)) continue;
    entries.push(
      ...entriesFor(siteUrl, routes.category(category.branchSlug, category.slug), {
        changeFrequency: 'daily',
        priority: 0.7,
        lastModified: toDate(category.updatedAt),
      }),
    );
  }
  for (const dish of catalog?.dishes ?? []) {
    if (!activeSlugs.has(dish.branchSlug)) continue;
    entries.push(
      ...entriesFor(siteUrl, routes.dish(dish.branchSlug, dish.categorySlug, dish.slug), {
        changeFrequency: 'weekly',
        priority: 0.6,
        lastModified: toDate(dish.updatedAt),
      }),
    );
  }
  for (const page of catalog?.pages ?? []) {
    entries.push(
      ...entriesFor(siteUrl, routes.page(page.slug), {
        changeFrequency: 'yearly',
        priority: 0.3,
        lastModified: toDate(page.updatedAt),
      }),
    );
  }
  return entries;
}

/**
 * Данные каталога для карты сайта. Если эндпоинт не развёрнут (404) или API недоступен —
 * null, и карта сайта строится без каталога (статические разделы + филиалы).
 * TODO(api-client): после попадания эндпоинта в docs/openapi.json — перейти на типизированный api.GET.
 */
export async function fetchSitemapData(): Promise<SitemapData | null> {
  try {
    const api = createServerApi({ revalidate: 3600, tags: ['sitemap'] });
    return await api.raw<SitemapData>('GET', SITEMAP_DATA_PATH);
  } catch (error) {
    if (!(error instanceof ApiError) || !error.isNotFound) {
      console.warn('[sitemap] sitemap-data unavailable:', error instanceof Error ? error.message : error);
    }
    return null;
  }
}
