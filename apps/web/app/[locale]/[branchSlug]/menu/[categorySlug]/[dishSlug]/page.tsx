import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { DishBadges } from '@/components/menu/DishBadges';
import { DishGallery } from '@/components/menu/DishGallery';
import { DishOrderPanel } from '@/components/menu/DishOrderPanel';
import { JsonLd } from '@/components/seo/JsonLd';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { Container } from '@/components/ui/Container';
import { ChevronLeftIcon } from '@/components/ui/icons';
import { getDish } from '@/lib/catalog';
import { getSiteUrl } from '@/lib/config';
import { formatPrice } from '@/lib/format';
import { openGraphImage } from '@/lib/images';
import { breadcrumbJsonLd, dishJsonLd } from '@/lib/jsonld';
import { resolveLocale } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata, localizedUrl } from '@/lib/seo';

type Params = Promise<{ locale: string; branchSlug: string; categorySlug: string; dishSlug: string }>;

export const revalidate = 60;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { branchSlug, dishSlug } = await params;
  const dish = await getDish(locale, branchSlug, dishSlug);
  if (!dish) return {};
  // OpenGraph — фото блюда (вариант ~1200 px).
  const image = openGraphImage(dish.photos[0] ?? dish.photo, dish.name);
  return buildMetadata({
    locale,
    path: routes.dish(dish.branch.slug, dish.categorySlug, dish.slug),
    title: dish.seo.title,
    description: dish.seo.description,
    images: image ? [image] : undefined,
  });
}

export default async function DishPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { branchSlug, dishSlug } = await params;
  const dish = await getDish(locale, branchSlug, dishSlug);
  if (!dish) notFound();

  const [t, menuT, nav] = await Promise.all([getTranslations('Dish'), getTranslations('Menu'), getTranslations('Nav')]);
  const siteUrl = getSiteUrl();
  const { branch, category } = dish;
  const menuPath = routes.branchMenu(branch.slug);
  const categoryPath = routes.category(branch.slug, dish.categorySlug);
  const dishPath = routes.dish(branch.slug, dish.categorySlug, dish.slug);
  const menuLabel = `${menuT('title')} — ${branch.name}`;
  const photos = dish.photos.length > 0 ? dish.photos : dish.photo ? [dish.photo] : [];
  const facts = [
    dish.weightGrams ? t('weight', { grams: dish.weightGrams }) : null,
    dish.calories ? t('calories', { kcal: dish.calories }) : null,
  ].filter(Boolean);

  return (
    <Container>
      <JsonLd
        data={[
          dishJsonLd(dish, { locale, branchSlug: branch.slug, siteUrl }),
          breadcrumbJsonLd([
            { name: nav('home'), url: localizedUrl(locale, routes.home(), siteUrl) },
            { name: menuLabel, url: localizedUrl(locale, menuPath, siteUrl) },
            { name: category.name, url: localizedUrl(locale, categoryPath, siteUrl) },
            { name: dish.name, url: localizedUrl(locale, dishPath, siteUrl) },
          ]),
        ]}
      />
      <Breadcrumbs
        items={[
          { label: nav('home'), href: routes.home() },
          { label: menuLabel, href: menuPath },
          { label: category.name, href: categoryPath },
          { label: dish.name },
        ]}
      />

      <div className="mt-4 grid gap-6 md:grid-cols-2 md:gap-10">
        <DishGallery photos={photos} name={dish.name} unavailable={!dish.available} />

        <div>
          <h1 className="font-display text-3xl font-semibold text-earth-900 sm:text-4xl">{dish.name}</h1>
          {facts.length > 0 ? <p className="mt-2 text-muted">{facts.join(' · ')}</p> : null}
          <DishBadges
            dish={dish}
            className="mt-3"
            labels={{ vegetarian: t('vegetarian'), spicy: t('spicy'), spicyLevel: t('spicyLevel', { level: dish.spicyLevel }), halal: t('halal') }}
          />
          <p className="mt-4 text-3xl font-bold tabular-nums text-earth-900">
            <span className="sr-only">{t('price')}: </span>
            {formatPrice(dish.price, locale)}
          </p>
          {dish.hasModifiers ? <p className="mt-1 text-sm text-muted">{t('priceNote')}</p> : null}
          {dish.description ? <p className="mt-4 text-lg leading-relaxed text-earth-800">{dish.description}</p> : null}

          <DishOrderPanel
            dishId={dish.id}
            name={dish.name}
            branchId={branch.id}
            available={dish.available}
            modifierGroups={dish.modifierGroups}
          />

          {dish.composition ? (
            <section aria-labelledby="dish-composition" className="mt-8">
              <h2 id="dish-composition" className="text-xl font-semibold text-earth-900">
                {t('composition')}
              </h2>
              <p className="mt-2 leading-relaxed text-earth-800">{dish.composition}</p>
            </section>
          ) : null}

          {dish.allergens.length > 0 ? (
            <section aria-labelledby="dish-allergens" className="mt-6">
              <h2 id="dish-allergens" className="text-xl font-semibold text-earth-900">
                {t('allergens')}
              </h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {dish.allergens.map((allergen) => (
                  <li key={allergen.code} className="rounded-full border border-earth-200 bg-cream-50 px-3 py-1 text-sm text-earth-800">
                    {allergen.name}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <Link href={categoryPath} className="mt-8 inline-flex min-h-11 items-center gap-1 font-semibold text-earth-700 underline-offset-4 hover:underline">
            <ChevronLeftIcon size={18} />
            {t('backToCategory', { category: category.name })}
          </Link>
        </div>
      </div>
    </Container>
  );
}
