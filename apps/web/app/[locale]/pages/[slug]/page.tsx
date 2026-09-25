import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { RichText } from '@/components/content/RichText';
import { JsonLd } from '@/components/seo/JsonLd';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { Container } from '@/components/ui/Container';
import { PageHeading } from '@/components/ui/PageHeading';
import { getSiteUrl } from '@/lib/config';
import { getContentPage } from '@/lib/content';
import { formatDate } from '@/lib/format';
import { breadcrumbJsonLd } from '@/lib/jsonld';
import { resolveLocale } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata, localizedUrl } from '@/lib/seo';

type Params = Promise<{ locale: string; slug: string }>;

export const revalidate = 60;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Текстовые страницы (о ресторане, доставка, оплата, оферта, политика, контакты) — редактирует
 * контент-менеджер: GET /api/v1/public/content/pages/{slug}. Неопубликованная/неизвестная — HTTP 404
 * (в сегменте нет loading.tsx — notFound() до отправки заголовков).
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) return {};
  const page = await getContentPage(locale, slug);
  if (!page) return {};
  return buildMetadata({ locale, path: routes.page(page.slug), title: page.seo.title || page.title, description: page.seo.description, type: 'article' });
}

export default async function InfoPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) notFound();
  const page = await getContentPage(locale, slug);
  if (!page) notFound();
  const [t, nav] = await Promise.all([getTranslations('InfoPage'), getTranslations('Nav')]);
  const siteUrl = getSiteUrl();
  return (
    <Container>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: nav('home'), url: localizedUrl(locale, routes.home(), siteUrl) },
          { name: page.title, url: localizedUrl(locale, routes.page(page.slug), siteUrl) },
        ])}
      />
      <Breadcrumbs items={[{ label: nav('home'), href: routes.home() }, { label: page.title }]} />
      <PageHeading title={page.title} compact>
        <p className="mt-2 text-sm text-muted">{t('updatedAt', { date: formatDate(page.updatedAt, locale) })}</p>
      </PageHeading>
      <article className="max-w-3xl">
        <RichText html={page.bodyHtml} />
      </article>
    </Container>
  );
}
