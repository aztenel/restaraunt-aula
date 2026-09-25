import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { buttonClasses } from '@/components/ui/button';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/icons';
import { filtersToQueryString, type MenuFilters } from '@/lib/menu-filters';

/** Постраничный вывод результатов поиска: обычные ссылки (работают без JS, индексируются). */
export async function Pagination({ basePath, filters, total, perPage }: { basePath: string; filters: MenuFilters; total: number; perPage: number }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return null;
  const t = await getTranslations('Menu');
  const page = Math.min(filters.page, pages);
  const href = (p: number) => `${basePath}${filtersToQueryString({ ...filters, page: p })}`;
  return (
    <nav aria-label={t('pagination')} className="mt-8 flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" className={buttonClasses('outline', 'sm')}>
          <ChevronLeftIcon size={18} />
          {t('pagePrev')}
        </Link>
      ) : (
        <span />
      )}
      <p className="text-sm text-muted">{t('pageOf', { page, pages })}</p>
      {page < pages ? (
        <Link href={href(page + 1)} rel="next" className={buttonClasses('outline', 'sm')}>
          {t('pageNext')}
          <ChevronRightIcon size={18} />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
