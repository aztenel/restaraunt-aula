import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { translate } from '@aula/api-client';
import { BranchMenuPlaceholder } from '@/components/placeholders/BranchMenuPlaceholder';
import { getPublicBranch } from '@/lib/data';
import { resolveLocale } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

type Params = Promise<{ locale: string; branchSlug: string; categorySlug: string }>;

/*
 * TODO(catalog): категория меню филиала.
 *   Ожидаемый эндпоинт: GET /api/v1/public/branches/{branchSlug}/menu/categories/{categorySlug}?locale=
 *     → { category: { id, slug, name, description, seoTitle?, seoDescription? }, dishes: [...] } | 404
 *   Пока категория не проверяется API, страница закрыта от индексации (noindex) — без «мягких 404».
 *   SEO: title/description категории, menuJsonLd() с одной MenuSection, breadcrumbJsonLd().
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { branchSlug, categorySlug } = await params;
  const branch = await getPublicBranch(locale, branchSlug);
  if (!branch) return {};
  const t = await getTranslations({ locale, namespace: 'Menu' });
  const name = translate(branch.name, locale);
  return buildMetadata({
    locale,
    path: routes.category(branch.slug, categorySlug),
    title: t('metaTitle', { branch: name }),
    description: t('metaDescription', { branch: name }),
    noindex: true,
  });
}

export default async function MenuCategoryPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { branchSlug } = await params;
  const branch = await getPublicBranch(locale, branchSlug);
  if (!branch) notFound();
  const t = await getTranslations('Menu');
  return <BranchMenuPlaceholder branch={branch} locale={locale} title={t('title')} />;
}
