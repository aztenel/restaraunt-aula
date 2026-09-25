'use client';

import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition, type FormEvent } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { buttonClasses } from '@/components/ui/button';
import { FilterIcon, SearchIcon } from '@/components/ui/icons';
import {
  activeFilterCount,
  FILTER_PARAMS,
  filtersToSearchParams,
  MAX_QUERY_LENGTH,
  type MenuFilters as MenuFiltersState,
  type SpicyFilter,
} from '@/lib/menu-filters';

const SPICY_OPTIONS: Array<{ value: SpicyFilter; param: string; key: 'spicyAny' | 'spicyOnly' | 'spicyNone' }> = [
  { value: 'any', param: '', key: 'spicyAny' },
  { value: 'only', param: '1', key: 'spicyOnly' },
  { value: 'none', param: '0', key: 'spicyNone' },
];

/**
 * Поиск и фильтры меню. Обычная GET-форма: без JS отправляется браузером (сервер отрисует
 * результаты по параметрам адреса), с JS — переход без перезагрузки. Фильтрует сервер.
 * categories — выбор раздела (страница меню); на странице категории раздел задан адресом.
 */
export function MenuFilters({ initial, categories }: { initial: MenuFiltersState; categories?: Array<{ slug: string; name: string }> }) {
  const t = useTranslations('Filters');
  const router = useRouter();
  const pathname = usePathname();
  const [values, setValues] = useState<MenuFiltersState>(initial);
  const [pending, startTransition] = useTransition();
  const id = useId();
  const withCategory = Boolean(categories?.length);
  const count = activeFilterCount(values, { ignoreCategory: !withCategory });

  const set = <K extends keyof MenuFiltersState>(key: K, value: MenuFiltersState[K]) => setValues((v) => ({ ...v, [key]: value }));

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = filtersToSearchParams({ ...values, category: withCategory ? values.category : '', page: 1 });
    startTransition(() => {
      router.push({ pathname, query: Object.fromEntries(params) }, { scroll: false });
    });
  };

  return (
    <form role="search" method="get" onSubmit={onSubmit} aria-busy={pending} className="mt-4 space-y-3" aria-label={t('title')}>
      <div className="flex gap-2">
        <label htmlFor={`${id}-q`} className="sr-only">
          {t('searchLabel')}
        </label>
        <div className="relative min-w-0 flex-1">
          <SearchIcon size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-earth-400" />
          <input
            id={`${id}-q`}
            type="search"
            name={FILTER_PARAMS.q}
            value={values.q}
            onChange={(e) => set('q', e.target.value)}
            maxLength={MAX_QUERY_LENGTH}
            placeholder={t('searchPlaceholder')}
            enterKeyHint="search"
            autoComplete="off"
            className="h-12 w-full rounded-full border border-earth-200 bg-cream-50 pl-10 pr-4 text-base text-earth-900 placeholder:text-earth-400 focus:border-gold-500"
          />
        </div>
        <button type="submit" className={buttonClasses('primary', 'md', 'shrink-0')} disabled={pending}>
          <span className="max-[380px]:sr-only">{t('submit')}</span>
          <SearchIcon size={18} className="min-[381px]:hidden" />
        </button>
      </div>

      <details className="group rounded-2xl border border-earth-100 bg-cream-50" open={count > 0 ? true : undefined}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 font-semibold text-earth-800 [&::-webkit-details-marker]:hidden">
          <FilterIcon size={18} />
          {t('toggle')} {count > 0 ? <span className="text-gold-700">{t('activeCount', { count })}</span> : null}
        </summary>
        <div className="grid gap-4 border-t border-earth-100 px-4 pb-4 pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <fieldset className="space-y-1">
            <legend className="sr-only">{t('title')}</legend>
            {(['vegetarian', 'halal'] as const).map((key) => (
              <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 text-earth-800">
                <input
                  type="checkbox"
                  name={FILTER_PARAMS[key]}
                  value="1"
                  checked={values[key]}
                  onChange={(e) => set(key, e.target.checked)}
                  className="h-5 w-5 accent-earth-700"
                />
                {t(key)}
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-earth-800">{t('spicyLabel')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {SPICY_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={clsx(
                    'inline-flex min-h-10 cursor-pointer items-center rounded-full border px-3 text-sm font-semibold has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-gold-500',
                    values.spicy === option.value ? 'border-earth-700 bg-earth-700 text-cream-50' : 'border-earth-200 text-earth-800',
                  )}
                >
                  <input
                    type="radio"
                    name={FILTER_PARAMS.spicy}
                    value={option.param}
                    checked={values.spicy === option.value}
                    onChange={() => set('spicy', option.value)}
                    className="sr-only"
                  />
                  {t(option.key)}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor={`${id}-price`} className="mb-1 block text-sm font-semibold text-earth-800">
              {t('maxPriceLabel')}
            </label>
            <input
              id={`${id}-price`}
              name={FILTER_PARAMS.maxPrice}
              inputMode="decimal"
              autoComplete="off"
              value={values.maxPrice}
              onChange={(e) => set('maxPrice', e.target.value.slice(0, 12))}
              placeholder={t('maxPricePlaceholder')}
              className="h-11 w-full rounded-xl border border-earth-200 bg-cream-50 px-3 text-base tabular-nums"
            />
          </div>

          {withCategory ? (
            <div>
              <label htmlFor={`${id}-category`} className="mb-1 block text-sm font-semibold text-earth-800">
                {t('categoryLabel')}
              </label>
              <select
                id={`${id}-category`}
                name={FILTER_PARAMS.category}
                value={values.category}
                onChange={(e) => set('category', e.target.value)}
                className="h-11 w-full rounded-xl border border-earth-200 bg-cream-50 px-3 text-base"
              >
                <option value="">{t('categoryAll')}</option>
                {categories!.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit" className={buttonClasses('primary', 'sm')} disabled={pending}>
              {t('apply')}
            </button>
            <Link href={pathname} scroll={false} className={buttonClasses('ghost', 'sm')}>
              {t('reset')}
            </Link>
          </div>
        </div>
      </details>
    </form>
  );
}
