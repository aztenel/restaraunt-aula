'use client';

import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { buttonClasses } from '@/components/ui/button';
import { CheckIcon, PlusIcon } from '@/components/ui/icons';
import { trackStorefrontEvent } from '@/lib/analytics-session';
import { useCart } from '@/lib/cart';
import { Goals, reachGoal } from '@/lib/goals';

/**
 * «В корзину» для блюда без добавок: в корзину кладётся только id блюда, филиал и количество —
 * цену и итог рассчитает сервер (корзина → POST /public/orders/quote).
 */
export function AddToCartButton({ dishId, branchId, name, className }: { dishId: string; branchId: string; name: string; className?: string }) {
  const t = useTranslations('Dish');
  const cart = useCart();
  const pathname = usePathname();
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!added) return;
    const timer = window.setTimeout(() => setAdded(false), 2200);
    return () => window.clearTimeout(timer);
  }, [added]);

  const onClick = () => {
    cart.add({ dishId, branchId, quantity: 1, modifierOptionIds: [] });
    reachGoal(Goals.AddToCart, { dish_id: dishId, branch_id: branchId, quantity: 1 });
    trackStorefrontEvent('add_to_cart', { path: pathname, branchId });
    setAdded(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        aria-label={t('addAria', { name })}
        className={buttonClasses(added ? 'secondary' : 'primary', 'sm', clsx('relative z-10 shrink-0', className))}
      >
        {added ? <CheckIcon size={18} /> : <PlusIcon size={18} />}
        {added ? t('added') : t('add')}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {added ? t('addedAnnounce', { name }) : ''}
      </span>
    </>
  );
}
