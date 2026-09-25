import clsx from 'clsx';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import { ApiImage } from '@/components/ui/ApiImage';
import { buttonClasses } from '@/components/ui/button';
import type { DishCard as DishCardData } from '@/lib/api-types';
import { formatPrice } from '@/lib/format';
import { routes } from '@/lib/routes';
import { AddToCartButton } from './AddToCartButton';
import { DishBadges } from './DishBadges';
import { DishPhotoPlaceholder } from './DishPhotoPlaceholder';

/** Ширины карточки: телефон — фото 7rem слева, планшет — 2 колонки, десктоп — 3 колонки. */
const CARD_IMAGE_SIZES = '(min-width: 1024px) 22rem, (min-width: 640px) 45vw, 7rem';

/**
 * Карточка блюда: фото (webp-варианты, лениво), название, вес, цена филиала, метки.
 * Стоп-лист при режиме филиала «помечать» — «Нет в наличии» без кнопки. Блюдо с добавками
 * добавляется со своей страницы (нужно выбрать варианты).
 */
export async function DishCard({
  dish,
  branchSlug,
  branchId,
  locale,
  priority = false,
}: {
  dish: DishCardData;
  branchSlug: string;
  branchId: string;
  locale: AppLocale;
  priority?: boolean;
}) {
  const t = await getTranslations('Dish');
  const href = routes.dish(branchSlug, dish.categorySlug, dish.slug);
  const unavailable = !dish.available;
  return (
    <article
      className={clsx(
        'relative flex h-full gap-3 rounded-card border border-earth-100 bg-cream-50 p-3 shadow-card transition-colors focus-within:border-gold-400 hover:border-gold-400 sm:flex-col sm:gap-0 sm:overflow-hidden sm:p-0',
      )}
    >
      <div className="relative aspect-square w-28 shrink-0 overflow-hidden rounded-xl bg-cream-200 sm:aspect-[4/3] sm:w-full sm:rounded-none">
        {dish.photo ? (
          <ApiImage
            fill
            image={dish.photo}
            alt={dish.name}
            sizes={CARD_IMAGE_SIZES}
            priority={priority}
            className={clsx('object-cover', unavailable && 'opacity-60 grayscale')}
          />
        ) : (
          <DishPhotoPlaceholder />
        )}
        {unavailable ? (
          <span className="absolute left-2 top-2 rounded-full bg-earth-900/85 px-2.5 py-1 text-xs font-bold text-cream-50">{t('unavailable')}</span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col sm:p-4">
        <h3 className="font-display text-lg font-semibold leading-snug text-earth-900">
          {/* Растянутая ссылка: вся карточка ведёт на страницу блюда, кнопка лежит поверх. */}
          <Link href={href} className="after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:outline-3 focus-visible:after:outline-offset-2 focus-visible:after:outline-gold-500">
            {dish.name}
          </Link>
        </h3>
        {dish.weightGrams ? <p className="mt-0.5 text-sm text-muted">{t('weight', { grams: dish.weightGrams })}</p> : null}
        {dish.description ? <p className="mt-1 line-clamp-2 text-sm text-earth-700">{dish.description}</p> : null}
        <DishBadges
          dish={dish}
          className="mt-2"
          labels={{
            vegetarian: t('vegetarian'),
            spicy: t('spicy'),
            spicyLevel: t('spicyLevel', { level: dish.spicyLevel }),
            halal: t('halal'),
          }}
        />
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
          <p className={clsx('text-lg font-bold tabular-nums', unavailable ? 'text-muted line-through decoration-1' : 'text-earth-900')}>
            {formatPrice(dish.price, locale)}
          </p>
          {unavailable ? null : dish.hasModifiers ? (
            <Link href={href} aria-label={t('chooseAria', { name: dish.name })} className={buttonClasses('outline', 'sm', 'relative z-10')}>
              {t('choose')}
            </Link>
          ) : (
            <AddToCartButton dishId={dish.id} branchId={branchId} name={dish.name} />
          )}
        </div>
      </div>
    </article>
  );
}

/** Сетка карточек: первые изображения — без lazy (первый экран). */
export function DishGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={clsx('grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3', className)}>{children}</ul>;
}
