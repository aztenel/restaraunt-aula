import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { CategoryNav } from '@/components/menu/CategoryNav';
import { DishCard, DishGrid } from '@/components/menu/DishCard';
import { MenuFilters } from '@/components/menu/MenuFilters';
import { MenuSearchResults } from '@/components/menu/MenuSearchResults';
import { JsonLd } from '@/components/seo/JsonLd';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { Container } from '@/components/ui/Container';
import { Notice } from '@/components/ui/Notice';
import { PageHeading } from '@/components/ui/PageHeading';
import { getCategoryPage, searchMenu } from '@/lib/catalog';
import { getSiteUrl } from '@/lib/config';
import { openGraphImage } from '@/lib/images';
import { breadcrumbJsonLd, categoryMenuJsonLd } from '@/lib/jsonld';
import { filtersToQueryString, hasActiveFilters, parseMenuFilters } from '@/lib/menu-filters';
import { resolveLocale } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata, localizedUrl } from '@/lib/seo';

type Params = Promise<{ locale: string; branchSlug: string; categorySlug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const revalidate = 60;

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: SearchParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { branchSlug, categorySlug } = await params;
  const [page, filters] = await Promise.all([getCategoryPage(locale, branchSlug, categorySlug), searchParams.then(parseMenuFilters)]);
  if (!page) return {};
  const cover = page.category.image ?? page.dishes.find((d) => d.photo)?.photo;
  const image = openGraphImage(cover, page.category.name);
  return buildMetadata({
    locale,
    path: routes.category(page.branch.slug, page.category.slug),
    // Уникальные title/description категории филиала — из API (SEO-поля или «Категория — Филиал»).
    title: page.category.seo.title,
    description: page.category.seo.description,
    images: image ? [image] : undefined,
    noindex: hasActiveFilters(filters, { ignoreCategory: true }),
    follow: true,
  });
}

export default async function CategoryPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const locale = await resolveLocale(params);
  const { branchSlug, categorySlug } = await params;
  const [page, rawFilters] = await Promise.all([getCategoryPage(locale, branchSlug, categorySlug), searchParams.then(parseMenuFilters)]);
  if (!page) notFound();

  // Категория задана адресом; фильтры применяются внутри неё.
  const filters = { ...rawFilters, category: page.category.slug };
  const searching = hasActiveFilters(filters, { ignoreCategory: true });
  const [results, t, nav] = await Promise.all([
    searching ? searchMenu(locale, page.branch.slug, filters) : Promise.resolve(null),
    getTranslations('Menu'),
    getTranslations('Nav'),
  ]);

  const siteUrl = getSiteUrl();
  const { branch, category } = page;
  const menuPath = routes.branchMenu(branch.slug);
  const categoryPath = routes.category(branch.slug, category.slug);
  const menuLabel = t('heading', { branch: branch.name });
  const urls = { locale, branchSlug: branch.slug, siteUrl };

  return (
    <Container>
      <JsonLd
        data={[
          categoryMenuJsonLd(category, page.dishes, { ...urls, name: category.seo.title }),
          breadcrumbJsonLd([
            { name: nav('home'), url: localizedUrl(locale, routes.home(), siteUrl) },
            { name: menuLabel, url: localizedUrl(locale, menuPath, siteUrl) },
            { name: category.name, url: localizedUrl(locale, categoryPath, siteUrl) },
          ]),
        ]}
      />
      <Breadcrumbs items={[{ label: nav('home'), href: routes.home() }, { label: menuLabel, href: menuPath }, { label: category.name }]} />
      <PageHeading title={category.name} subtitle={category.description || undefined} compact className="pb-2">
        <p className="mt-2 text-sm text-muted">
          {t('branchLabel', { branch: branch.name })} · {t('dishCount', { count: page.dishes.length })}
        </p>
      </PageHeading>

      <MenuFilters key={filtersToQueryString({ ...filters, category: '' })} initial={filters} />

      <div className="mt-4">
        <CategoryNav
          label={t('categoriesNav')}
          items={[
            { key: 'all', label: t('allDishes'), href: menuPath },
            ...page.categories.map((c) => ({ key: c.id, label: c.name, href: routes.category(branch.slug, c.slug), active: c.slug === category.slug })),
          ]}
        />
      </div>

      {searching && results ? (
        <MenuSearchResults result={results} filters={{ ...filters, category: '' }} basePath={categoryPath} branchSlug={branch.slug} branchId={branch.id} locale={locale} />
      ) : page.dishes.length === 0 ? (
        <Notice className="mt-8">{t('emptyCategory')}</Notice>
      ) : (
        <DishGrid className="mt-6">
          {page.dishes.map((dish, index) => (
            <li key={dish.id}>
              <DishCard dish={dish} branchSlug={branch.slug} branchId={branch.id} locale={locale} priority={index < 2} />
            </li>
          ))}
        </DishGrid>
      )}
    </Container>
  );
}
