import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { getSiteUrl } from '@/lib/config';
import { getPublicBranches } from '@/lib/data';
import { buildSitemapEntries, fetchSitemapData } from '@/lib/sitemap';

// Строится по запросу (адрес сайта и данные — из рантайма, сборка не зависит от API);
// ответы API кэшируются (revalidate).
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [branches, catalog] = await Promise.all([getPublicBranches(routing.defaultLocale), fetchSitemapData()]);
  return buildSitemapEntries({
    siteUrl: getSiteUrl(),
    branches: branches.ok ? branches.branches : [],
    catalog,
  });
}
