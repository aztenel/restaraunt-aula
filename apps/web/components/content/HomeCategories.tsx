import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ApiImage } from '@/components/ui/ApiImage';
import { ArrowRightIcon } from '@/components/ui/icons';
import { DishPhotoPlaceholder } from '@/components/menu/DishPhotoPlaceholder';
import type { MenuCategory } from '@/lib/api-types';
import { routes } from '@/lib/routes';

/**
 * Категории меню выбранного филиала на главной (порядок — как в меню, его задаёт контент-менеджер).
 * Фото категории, иначе фото первого блюда с фото.
 */
export async function HomeCategories({ categories, branchSlug, branchName }: { categories: MenuCategory[]; branchSlug: string; branchName: string }) {
  if (categories.length === 0) return null;
  const t = await getTranslations('Home');
  const menu = await getTranslations('Menu');
  return (
    <section aria-labelledby="home-categories" className="py-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="home-categories" className="text-3xl font-semibold text-earth-900">
            {t('categoriesTitle')}
          </h2>
          <p className="mt-1 text-muted">{t('categoriesSubtitle', { branch: branchName })}</p>
        </div>
        <Link href={routes.branchMenu(branchSlug)} className="inline-flex min-h-11 items-center gap-1 font-semibold text-earth-700 underline-offset-4 hover:underline">
          {t('categoriesAll')}
          <ArrowRightIcon size={18} />
        </Link>
      </div>
      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        {categories.map((category) => {
          const image = category.image ?? category.dishes.find((d) => d.photo)?.photo ?? null;
          return (
            <li key={category.id}>
              <Link
                href={routes.category(branchSlug, category.slug)}
                className="group relative block overflow-hidden rounded-card border border-earth-100 bg-cream-50 shadow-card hover:border-gold-400"
              >
                <div className="relative aspect-[4/3] bg-cream-200">
                  {image ? (
                    <ApiImage fill image={image} alt="" sizes="(min-width: 1024px) 22rem, (min-width: 640px) 33vw, 50vw" className="object-cover transition-transform duration-300 motion-safe:group-hover:scale-105" />
                  ) : (
                    <DishPhotoPlaceholder />
                  )}
                </div>
                <div className="p-3 sm:p-4">
                  <p className="font-display text-lg font-semibold leading-snug text-earth-900">{category.name}</p>
                  <p className="text-sm text-muted">{menu('dishCount', { count: category.dishCount })}</p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
