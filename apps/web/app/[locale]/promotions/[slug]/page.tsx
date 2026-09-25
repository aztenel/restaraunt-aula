import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { translate } from '@aula/api-client';
import { Link } from '@/i18n/navigation';
import { promotionBranches, promotionPeriod } from '@/components/content/PromotionCard';
import { JsonLd } from '@/components/seo/JsonLd';
import { ApiImage } from '@/components/ui/ApiImage';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { Container } from '@/components/ui/Container';
import { ChevronLeftIcon } from '@/components/ui/icons';
import { PageHeading } from '@/components/ui/PageHeading';
import { getSiteUrl } from '@/lib/config';
import { getPromotion } from '@/lib/content';
import { getPublicBranches } from '@/lib/data';
import { openGraphImage } from '@/lib/images';
import { breadcrumbJsonLd } from '@/lib/jsonld';
import { resolveLocale } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata, localizedUrl } from '@/lib/seo';

type Params = Promise<{ locale: string; slug: string }>;

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  const promotion = await getPromotion(locale, slug);
  if (!promotion) return {};
  const image = openGraphImage(promotion.image, promotion.title);
  return buildMetadata({
    locale,
    path: routes.promotion(promotion.slug),
    title: promotion.seo.title || promotion.title,
    description: promotion.seo.description || promotion.description,
    images: image ? [image] : undefined,
    type: 'article',
  });
}

/** Акция: описание, условия, срок и филиалы. Нет или закончилась — HTTP 404. */
export default async function PromotionPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  const promotion = await getPromotion(locale, slug);
  if (!promotion) notFound();
  const [branches, t, nav] = await Promise.all([getPublicBranches(locale), getTranslations('Promotions'), getTranslations('Nav')]);
  const branchNames = new Map((branches.ok ? branches.branches : []).map((b) => [b.id, translate(b.name, locale)]));
  const [period, branchText] = await Promise.all([promotionPeriod(promotion, locale), promotionBranches(promotion, branchNames)]);
  const siteUrl = getSiteUrl();
  return (
    <Container>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: nav('home'), url: localizedUrl(locale, routes.home(), siteUrl) },
          { name: t('title'), url: localizedUrl(locale, routes.promotions(), siteUrl) },
          { name: promotion.title, url: localizedUrl(locale, routes.promotion(promotion.slug), siteUrl) },
        ])}
      />
      <Breadcrumbs items={[{ label: nav('home'), href: routes.home() }, { label: t('title'), href: routes.promotions() }, { label: promotion.title }]} />
      <PageHeading title={promotion.title} eyebrow={period ?? undefined} compact>
        <p className="mt-2 text-muted">{branchText}</p>
      </PageHeading>
      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        {promotion.image ? (
          <div className="relative aspect-[16/9] overflow-hidden rounded-card shadow-card lg:col-start-2 lg:row-start-1">
            <ApiImage fill priority image={promotion.image} alt="" sizes="(min-width: 1024px) 40vw, 100vw" className="object-cover" />
          </div>
        ) : null}
        <div className="max-w-2xl lg:col-start-1 lg:row-start-1">
          <p className="whitespace-pre-line text-lg leading-relaxed text-earth-900">{promotion.description}</p>
          {promotion.terms ? (
            <section aria-labelledby="promotion-terms" className="mt-8 rounded-card border border-earth-100 bg-cream-50 p-5">
              <h2 id="promotion-terms" className="text-xl font-semibold text-earth-900">
                {t('terms')}
              </h2>
              <p className="mt-2 whitespace-pre-line text-earth-800">{promotion.terms}</p>
            </section>
          ) : null}
          <Link href={routes.promotions()} className="mt-8 inline-flex min-h-11 items-center gap-1 font-semibold text-earth-700 underline-offset-4 hover:underline">
            <ChevronLeftIcon size={18} />
            {t('back')}
          </Link>
        </div>
      </div>
    </Container>
  );
}
