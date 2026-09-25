import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { translate } from '@aula/api-client';
import { Link } from '@/i18n/navigation';
import { BranchContactList } from '@/components/branches/BranchContactList';
import { MenuBanners } from '@/components/content/MenuBanners';
import { CategoryNav } from '@/components/menu/CategoryNav';
import { DishCard, DishGrid } from '@/components/menu/DishCard';
import { MenuFilters } from '@/components/menu/MenuFilters';
import { MenuSearchResults } from '@/components/menu/MenuSearchResults';
import { JsonLd } from '@/components/seo/JsonLd';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { Container } from '@/components/ui/Container';
import { ArrowRightIcon } from '@/components/ui/icons';
import { Notice } from '@/components/ui/Notice';
import { PageHeading } from '@/components/ui/PageHeading';
import { getBranchMenu, searchMenu } from '@/lib/catalog';
import { getSiteUrl } from '@/lib/config';
import { getBanners } from '@/lib/content';
import { getPublicBranch } from '@/lib/data';
import { openGraphImage } from '@/lib/images';
import { branchMenuJsonLd, breadcrumbJsonLd, restaurantJsonLd } from '@/lib/jsonld';
import { filtersToQueryString, hasActiveFilters, parseMenuFilters } from '@/lib/menu-filters';
import { resolveLocale } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata, localizedUrl } from '@/lib/seo';

type Params = Promise<{ locale: string; branchSlug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Данные меню кэшируются на 60 с (кэш данных Next.js + s-maxage API). */
export const revalidate = 60;

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: SearchParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { branchSlug } = await params;
  const [branch, menu, filters] = await Promise.all([
    getPublicBranch(locale, branchSlug),
    getBranchMenu(locale, branchSlug).catch(() => null),
    searchParams.then(parseMenuFilters),
  ]);
  if (!branch) return {};
  const t = await getTranslations({ locale, namespace: 'Menu' });
  const name = translate(branch.name, locale);
  const searching = hasActiveFilters(filters);
  const cover = menu?.categories.flatMap((c) => c.dishes).find((d) => d.photo)?.photo;
  const image = openGraphImage(cover, t('metaTitle', { branch: name }));
  return buildMetadata({
    locale,
    path: routes.branchMenu(branch.slug),
    title: searching ? t('searchMetaTitle', { branch: name }) : t('metaTitle', { branch: name }),
    description: menu?.seo.description || t('metaDescription', { branch: name }),
    images: image ? [image] : undefined,
    // Результаты поиска — не индексировать (дубли меню), но ссылки на блюда — обходить.
    noindex: searching,
    follow: true,
  });
}

export default async function BranchMenuPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const locale = await resolveLocale(params);
  const { branchSlug } = await params;
  const [branch, menu, filters] = await Promise.all([
    getPublicBranch(locale, branchSlug),
    getBranchMenu(locale, branchSlug),
    searchParams.then(parseMenuFilters),
  ]);
  if (!branch || !menu) notFound();

  const searching = hasActiveFilters(filters);
  const [results, banners, t, nav] = await Promise.all([
    searching ? searchMenu(locale, branch.slug, filters) : Promise.resolve(null),
    getBanners(locale, 'menu_top', branch.slug),
    getTranslations('Menu'),
    getTranslations('Nav'),
  ]);

  const siteUrl = getSiteUrl();
  const name = translate(branch.name, locale);
  const menuPath = routes.branchMenu(branch.slug);
  const menuUrl = localizedUrl(locale, menuPath, siteUrl);
  const categories = menu.categories.filter((c) => c.dishes.length > 0);

  return (
    <Container>
      <JsonLd
        data={[
          restaurantJsonLd({ branch, locale, url: localizedUrl(locale, routes.branch(branch.slug), siteUrl), menuUrl }),
          branchMenuJsonLd(menu, { locale, branchSlug: branch.slug, siteUrl, name: t('metaTitle', { branch: name }) }),
          breadcrumbJsonLd([
            { name: nav('home'), url: localizedUrl(locale, routes.home(), siteUrl) },
            { name: `${t('title')} — ${name}`, url: menuUrl },
          ]),
        ]}
      />
      <Breadcrumbs items={[{ label: nav('home'), href: routes.home() }, { label: `${t('title')} — ${name}` }]} />
      <PageHeading title={t('title')} compact className="pb-2">
        <p className="mt-2 text-lg text-muted">
          <Link href={routes.branch(branch.slug)} className="underline-offset-4 hover:underline">
            {t('branchLabel', { branch: name })}
          </Link>
        </p>
      </PageHeading>

      <MenuBanners banners={banners} />

      <MenuFilters key={filtersToQueryString(filters)} initial={filters} categories={categories.map((c) => ({ slug: c.slug, name: c.name }))} />

      {searching && results ? (
        <MenuSearchResults result={results} filters={filters} basePath={menuPath} branchSlug={branch.slug} branchId={branch.id} locale={locale} />
      ) : categories.length === 0 ? (
        <div className="mt-8 space-y-4">
          <Notice title={t('emptyMenuTitle')}>{t('emptyMenuText')}</Notice>
          <BranchContactList branches={[branch]} locale={locale} whatsappText={t('whatsappText')} />
        </div>
      ) : (
        <>
          <div className="mt-4">
            <CategoryNav
              label={t('categoriesNav')}
              items={categories.map((c) => ({ key: c.id, label: c.name, href: `#section-${c.slug}` }))}
            />
          </div>
          {categories.map((category, sectionIndex) => (
            <section key={category.id} id={`section-${category.slug}`} aria-labelledby={`heading-${category.slug}`} className="scroll-mt-32 pt-8">
              <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                <h2 id={`heading-${category.slug}`} className="text-2xl font-semibold text-earth-900 sm:text-3xl">
                  {category.name}
                </h2>
                <Link
                  href={routes.category(branch.slug, category.slug)}
                  aria-label={t('openCategoryAria', { name: category.name })}
                  className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-earth-700 underline-offset-4 hover:underline"
                >
                  {t('openCategory')} · {t('dishCount', { count: category.dishCount })}
                  <ArrowRightIcon size={16} />
                </Link>
              </div>
              {category.description ? <p className="mt-1 max-w-2xl text-muted">{category.description}</p> : null}
              <DishGrid className="mt-4">
                {category.dishes.map((dish, index) => (
                  <li key={dish.id}>
                    <DishCard dish={dish} branchSlug={branch.slug} branchId={branch.id} locale={locale} priority={sectionIndex === 0 && index < 2} />
                  </li>
                ))}
              </DishGrid>
            </section>
          ))}
        </>
      )}
    </Container>
  );
}
