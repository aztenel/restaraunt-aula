import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { translate } from '@aula/api-client';
import { PromotionCard } from '@/components/content/PromotionCard';
import { JsonLd } from '@/components/seo/JsonLd';
import { Container } from '@/components/ui/Container';
import { Notice } from '@/components/ui/Notice';
import { PageHeading } from '@/components/ui/PageHeading';
import { getSiteUrl } from '@/lib/config';
import { getPromotions } from '@/lib/content';
import { getPublicBranches } from '@/lib/data';
import { breadcrumbJsonLd } from '@/lib/jsonld';
import { resolveLocale, type LocaleParams } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata, localizedUrl } from '@/lib/seo';

export const revalidate = 60;

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'Promotions' });
  return buildMetadata({ locale, path: routes.promotions(), title: t('metaTitle'), description: t('metaDescription') });
}

/** Действующие акции сети и филиалов (GET /api/v1/public/content/promotions). */
export default async function PromotionsPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const [promotions, branches, t, nav] = await Promise.all([
    getPromotions(locale, null),
    getPublicBranches(locale),
    getTranslations('Promotions'),
    getTranslations('Nav'),
  ]);
  const branchNames = new Map((branches.ok ? branches.branches : []).map((b) => [b.id, translate(b.name, locale)]));
  const siteUrl = getSiteUrl();
  return (
    <Container>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: nav('home'), url: localizedUrl(locale, routes.home(), siteUrl) },
          { name: t('title'), url: localizedUrl(locale, routes.promotions(), siteUrl) },
        ])}
      />
      <PageHeading title={t('title')} subtitle={t('subtitle')} />
      {promotions === null ? (
        <Notice tone="warning">{t('unavailable')}</Notice>
      ) : promotions.length === 0 ? (
        <Notice>{t('empty')}</Notice>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {promotions.map((promotion) => (
            <li key={promotion.id}>
              <PromotionCard promotion={promotion} locale={locale} branchNames={branchNames} headingLevel={2} />
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
