import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PlaceholderPage } from '@/components/placeholders/PlaceholderPage';
import { resolveLocale } from '@/lib/page';
import { LEGAL_PAGES, routes, type LegalPageSlug } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

type Params = Promise<{ locale: string; slug: string }>;

/*
 * TODO(catalog/content): текстовые страницы (оферта, политика конфиденциальности, согласие на обработку ПД,
 *   доставка и оплата, «О нас»…) редактируются контент-менеджером.
 *   GET /api/v1/public/pages/{slug}?locale= → { slug, title, body (санитизированный HTML или Markdown),
 *     seoTitle?, seoDescription?, updatedAt, version? } | 404
 *   После подключения: убрать ограничение LEGAL_PAGES, отдавать 404 по ответу API, снять noindex,
 *   добавить страницы в sitemap (GET /api/v1/public/sitemap-data → pages).
 */
function isKnownPage(slug: string): slug is LegalPageSlug {
  return (LEGAL_PAGES as readonly string[]).includes(slug);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  if (!isKnownPage(slug)) return {};
  const t = await getTranslations({ locale, namespace: 'InfoPage' });
  return buildMetadata({
    locale,
    path: routes.page(slug),
    title: t(`titles.${slug}`),
    description: t('placeholderText'),
    noindex: true,
  });
}

export default async function InfoPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  if (!isKnownPage(slug)) notFound();
  const t = await getTranslations('InfoPage');
  return (
    <PlaceholderPage
      locale={locale}
      title={t(`titles.${slug}`)}
      placeholderTitle={t('placeholderTitle')}
      placeholderText={t('placeholderText')}
    />
  );
}
