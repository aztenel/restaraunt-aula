import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import { buttonClasses } from '@/components/ui/button';
import type { DishPage } from '@/lib/api-types';
import type { MenuFilters } from '@/lib/menu-filters';
import { DishCard, DishGrid } from './DishCard';
import { Pagination } from './Pagination';

/** Результаты поиска/фильтров (с сервера): сетка блюд, постраничный вывод, пустой результат. */
export async function MenuSearchResults({
  result,
  filters,
  basePath,
  branchSlug,
  branchId,
  locale,
}: {
  result: DishPage;
  filters: MenuFilters;
  basePath: string;
  branchSlug: string;
  branchId: string;
  locale: AppLocale;
}) {
  const t = await getTranslations('Menu');
  const filtersT = await getTranslations('Filters');
  return (
    <section aria-labelledby="search-results" className="pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="search-results" className="text-2xl font-semibold text-earth-900">
          {t('searchResults')}
        </h2>
        <p className="text-sm text-muted" role="status">
          {t('searchFound', { count: result.total })}
        </p>
      </div>
      {result.items.length > 0 ? (
        <>
          <DishGrid className="mt-4">
            {result.items.map((dish, index) => (
              <li key={dish.id}>
                <DishCard dish={dish} branchSlug={branchSlug} branchId={branchId} locale={locale} priority={index < 2} />
              </li>
            ))}
          </DishGrid>
          <Pagination basePath={basePath} filters={filters} total={result.total} perPage={result.perPage} />
        </>
      ) : (
        <div className="mt-4 rounded-card border border-earth-100 bg-cream-50 p-6 text-center">
          <p className="text-lg font-semibold text-earth-900">{t('searchEmptyTitle')}</p>
          <p className="mt-1 text-muted">{t('searchEmptyText')}</p>
          <Link href={basePath} className={buttonClasses('outline', 'sm', 'mt-4')}>
            {filtersT('reset')}
          </Link>
        </div>
      )}
    </section>
  );
}
