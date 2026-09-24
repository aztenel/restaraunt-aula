import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BranchCard } from '@/components/branches/BranchCard';
import { JsonLd } from '@/components/seo/JsonLd';
import { Container } from '@/components/ui/Container';
import { PageHeading } from '@/components/ui/PageHeading';
import { getSiteUrl } from '@/lib/config';
import { getPublicBranches } from '@/lib/data';
import { breadcrumbJsonLd } from '@/lib/jsonld';
import { resolveLocale, type LocaleParams } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata, localizedUrl } from '@/lib/seo';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'Branches' });
  return buildMetadata({ locale, path: routes.branches(), title: t('metaTitle'), description: t('metaDescription') });
}

export default async function BranchesPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const t = await getTranslations('Branches');
  const nav = await getTranslations('Nav');
  const common = await getTranslations('Common');
  const result = await getPublicBranches(locale);
  const siteUrl = getSiteUrl();

  return (
    <Container>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: nav('home'), url: localizedUrl(locale, routes.home(), siteUrl) },
          { name: t('title'), url: localizedUrl(locale, routes.branches(), siteUrl) },
        ])}
      />
      <PageHeading title={t('title')} subtitle={t('subtitle')} />
      {result.ok ? (
        <ul className="grid gap-4 md:grid-cols-2">
          {result.branches.map((branch) => (
            <li key={branch.id}>
              <BranchCard branch={branch} locale={locale} />
            </li>
          ))}
        </ul>
      ) : (
        <p role="status" className="rounded-2xl border border-earth-200 bg-cream-50 p-4 text-earth-700">
          {common('apiUnavailable')}
        </p>
      )}
    </Container>
  );
}
