import type { Metadata } from 'next';
import type { ComponentType } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import { OrnamentDivider, OrnamentPattern } from '@/components/brand/Ornament';
import { BranchCard } from '@/components/branches/BranchCard';
import { BannerCards, HeroBanners } from '@/components/content/Banners';
import { HomeCategories } from '@/components/content/HomeCategories';
import { PromotionCard } from '@/components/content/PromotionCard';
import { JsonLd } from '@/components/seo/JsonLd';
import { buttonClasses } from '@/components/ui/button';
import { Container } from '@/components/ui/Container';
import {
  ArrowRightIcon,
  CalendarIcon,
  CelebrationIcon,
  GiftIcon,
  LeafIcon,
  TruckIcon,
  UtensilsIcon,
} from '@/components/ui/icons';
import { translate } from '@aula/api-client';
import { getBranchMenuOrNull } from '@/lib/catalog';
import { getSiteUrl } from '@/lib/config';
import { getBanners, getPromotions } from '@/lib/content';
import { getPublicBranches, getSelectedBranchSlug, resolveSelectedBranch } from '@/lib/data';
import { organizationJsonLd, restaurantJsonLd, websiteJsonLd } from '@/lib/jsonld';
import { resolveLocale, type LocaleParams } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata, localizedUrl } from '@/lib/seo';

/** Контент главной (баннеры, акции, меню) кэшируется на 60 с. */
export const revalidate = 60;

/** Сколько категорий меню и акций показывать на главной. */
const HOME_CATEGORIES = 6;
const HOME_PROMOTIONS = 3;

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'Metadata' });
  return buildMetadata({
    locale,
    path: '/',
    title: t('homeTitle'),
    description: t('homeDescription'),
    absoluteTitle: true,
  });
}

const QUICK_ACTIONS: Array<{
  key: 'Menu' | 'Booking' | 'Banquets' | 'Certificates';
  href: string;
  icon: ComponentType<{ size?: number }>;
}> = [
  { key: 'Menu', href: routes.menu(), icon: UtensilsIcon },
  { key: 'Booking', href: routes.booking(), icon: CalendarIcon },
  { key: 'Banquets', href: routes.banquets(), icon: CelebrationIcon },
  { key: 'Certificates', href: routes.certificates(), icon: GiftIcon },
];

const FEATURES: Array<{ key: 'Cuisine' | 'Halal' | 'Halls' | 'Delivery'; icon: ComponentType<{ size?: number }> }> = [
  { key: 'Cuisine', icon: UtensilsIcon },
  { key: 'Halal', icon: LeafIcon },
  { key: 'Halls', icon: CalendarIcon },
  { key: 'Delivery', icon: TruckIcon },
];

export default async function HomePage({ params }: { params: LocaleParams }) {
  const locale: AppLocale = await resolveLocale(params);
  const t = await getTranslations('Home');
  const common = await getTranslations('Common');
  const [branchesResult, selectedSlug] = await Promise.all([getPublicBranches(locale), getSelectedBranchSlug()]);
  const branches = branchesResult.ok ? branchesResult.branches : [];
  // Филиал для персональных блоков: выбранный гостем, иначе первый по порядку.
  const featured = resolveSelectedBranch(branches, selectedSlug) ?? branches[0] ?? null;
  const featuredSlug = featured?.slug ?? null;
  const [heroBanners, secondaryBanners, promotions, menu] = await Promise.all([
    getBanners(locale, 'home_hero', featuredSlug),
    getBanners(locale, 'home_secondary', featuredSlug),
    getPromotions(locale, featuredSlug),
    featuredSlug ? getBranchMenuOrNull(locale, featuredSlug) : Promise.resolve(null),
  ]);
  const branchNames = new Map(branches.map((b) => [b.id, translate(b.name, locale)]));
  const categories = (menu?.categories ?? []).filter((c) => c.dishes.length > 0).slice(0, HOME_CATEGORIES);
  const siteUrl = getSiteUrl();

  const jsonLd = [
    organizationJsonLd({ url: siteUrl, logo: `${siteUrl}/icon.svg` }),
    websiteJsonLd({ url: localizedUrl(locale, '/', siteUrl), locale }),
    ...branches.map((branch) =>
      restaurantJsonLd({
        branch,
        locale,
        url: localizedUrl(locale, routes.branch(branch.slug), siteUrl),
        menuUrl: localizedUrl(locale, routes.branchMenu(branch.slug), siteUrl),
      }),
    ),
  ];

  return (
    <>
      <JsonLd data={jsonLd} />

      <HeroBanners banners={heroBanners} />

      <section className="relative isolate overflow-hidden bg-earth-800 text-cream-50">
        <OrnamentPattern className="text-gold-400/10" />
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,rgba(217,174,79,0.28),transparent_60%)]" />
        <Container className="relative py-14 sm:py-24">
          <p className="text-sm font-semibold uppercase tracking-widest text-gold-300">{t('heroEyebrow')}</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl lg:text-6xl">{t('heroTitle')}</h1>
          <p className="mt-5 max-w-2xl text-lg text-cream-200 sm:text-xl">{t('heroSubtitle')}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href={routes.menu()} className={buttonClasses('secondary', 'lg')}>
              <UtensilsIcon />
              {t('ctaMenu')}
            </Link>
            <Link
              href={routes.booking()}
              className={buttonClasses('outlineLight', 'lg')}
            >
              <CalendarIcon />
              {t('ctaBooking')}
            </Link>
          </div>
        </Container>
      </section>

      <Container className="py-12">
        <h2 className="sr-only">{t('quickTitle')}</h2>
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {QUICK_ACTIONS.map(({ key, href, icon: Icon }) => (
            <li key={key}>
              <Link
                href={href}
                className="group flex h-full flex-col rounded-card border border-earth-100 bg-cream-50 p-4 shadow-card transition-colors hover:border-gold-400 sm:p-5"
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-gold-200 text-earth-800">
                  <Icon size={22} />
                </span>
                <span className="mt-3 font-display text-lg font-semibold text-earth-900">{t(`quick${key}Title`)}</span>
                <span className="mt-1 text-sm text-muted">{t(`quick${key}Text`)}</span>
                <ArrowRightIcon size={18} className="mt-auto self-end pt-2 text-earth-400 group-hover:text-earth-700" />
              </Link>
            </li>
          ))}
        </ul>
      </Container>

      {featured && categories.length > 0 ? (
        <Container>
          <HomeCategories categories={categories} branchSlug={featured.slug} branchName={translate(featured.name, locale)} />
        </Container>
      ) : null}

      {promotions && promotions.length > 0 ? (
        <section aria-labelledby="home-promotions" className="py-12">
          <Container>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 id="home-promotions" className="text-3xl font-semibold text-earth-900">
                {t('promotionsTitle')}
              </h2>
              <Link href={routes.promotions()} className="inline-flex min-h-11 items-center gap-1 font-semibold text-earth-700 underline-offset-4 hover:underline">
                {t('promotionsAll')}
                <ArrowRightIcon size={18} />
              </Link>
            </div>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {promotions.slice(0, HOME_PROMOTIONS).map((promotion) => (
                <li key={promotion.id}>
                  <PromotionCard promotion={promotion} locale={locale} branchNames={branchNames} />
                </li>
              ))}
            </ul>
          </Container>
        </section>
      ) : null}

      {secondaryBanners.length > 0 ? (
        <Container className="py-12">
          <h2 className="sr-only">{t('bannersLabel')}</h2>
          <BannerCards banners={secondaryBanners} />
        </Container>
      ) : null}

      <section aria-labelledby="home-branches" className="bg-cream-200/60 py-12">
        <Container>
          <h2 id="home-branches" className="text-3xl font-semibold text-earth-900">
            {t('branchesTitle')}
          </h2>
          <p className="mt-2 text-muted">{t('branchesSubtitle')}</p>
          <OrnamentDivider className="mt-5 max-w-xs" />
          {branchesResult.ok ? (
            branches.length > 0 ? (
              <ul className="mt-8 grid gap-4 md:grid-cols-2">
                {branches.map((branch) => (
                  <li key={branch.id}>
                    <BranchCard branch={branch} locale={locale} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-8 text-muted">{t('noBranches')}</p>
            )
          ) : (
            <p role="status" className="mt-8 rounded-2xl border border-earth-200 bg-cream-50 p-4 text-earth-700">
              {t('branchesUnavailable')}
            </p>
          )}
        </Container>
      </section>

      <Container className="py-14">
        <h2 className="text-3xl font-semibold text-earth-900">{t('featuresTitle')}</h2>
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ key, icon: Icon }) => (
            <li key={key}>
              <span className="grid h-12 w-12 place-items-center rounded-full border border-gold-400 text-gold-700">
                <Icon size={22} />
              </span>
              <h3 className="mt-3 text-lg font-semibold text-earth-900">{t(`feature${key}Title`)}</h3>
              <p className="mt-1 text-muted">{t(`feature${key}Text`)}</p>
            </li>
          ))}
        </ul>
      </Container>

      <Container>
        <section className="relative overflow-hidden rounded-card bg-earth-700 p-6 text-cream-50 sm:p-10">
          <OrnamentPattern className="text-gold-300/10" />
          <div className="relative max-w-2xl">
            <h2 className="text-2xl font-semibold sm:text-3xl">{t('banquetTitle')}</h2>
            <p className="mt-3 text-cream-200">{t('banquetText')}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={routes.banquets()} className={buttonClasses('secondary')}>
                {t('banquetCta')}
              </Link>
              <Link href={routes.certificates()} className={buttonClasses('ghostLight', 'md')}>
                <GiftIcon />
                {common('certificates')}
              </Link>
            </div>
          </div>
        </section>
      </Container>
    </>
  );
}
