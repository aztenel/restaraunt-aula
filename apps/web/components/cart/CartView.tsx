'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { buttonClasses } from '@/components/ui/button';
import { CartIcon, MinusIcon, PlusIcon, TrashIcon } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { useCart } from '@/lib/cart';
import { Goals, reachGoal } from '@/lib/goals';
import { routes } from '@/lib/routes';

/*
 * TODO(ordering): состав и суммы корзины — только с сервера.
 *   POST /api/v1/public/orders/quote { branchId, type: 'delivery' | 'pickup', items: toQuoteLines(cart.state),
 *     promoCode?, deliveryLocation? } → { lines: [{ key/dishId, name, photoUrl, unitPrice: Money, lineTotal: Money,
 *     modifiers, availability, error? }], subtotal, discount, deliveryFee, total: Money, warnings: [...] }
 *   Отображать названия/цены/итог из ответа (formatPrice), недоступные позиции — предупреждением.
 *   Клиент НЕ считает суммы и не проверяет минимальную сумму заказа.
 */
export function CartView() {
  const t = useTranslations('Cart');
  const cart = useCart();
  // До гидратации localStorage недоступен — показываем заглушку, а не «пустую корзину».
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <section className="rounded-card border border-earth-100 bg-cream-50 p-8 text-center shadow-card">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gold-200 text-earth-800">
          <CartIcon size={28} />
        </span>
        <h2 className="mt-4 text-2xl font-semibold text-earth-900">{t('emptyTitle')}</h2>
        <p className="mx-auto mt-2 max-w-md text-muted">{t('emptyText')}</p>
        <Link href={routes.menu()} className={buttonClasses('primary', 'md', 'mt-6')}>
          {t('toMenu')}
        </Link>
      </section>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <ul className="space-y-3">
        {cart.lines.map((line) => (
          <li key={line.key} className="flex items-center gap-3 rounded-2xl border border-earth-100 bg-cream-50 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-earth-900">{t('dishPending')}</p>
              <p className="truncate text-xs text-muted">{line.dishId}</p>
            </div>
            <div className="flex items-center gap-1" role="group" aria-label={t('quantity')}>
              <button
                type="button"
                onClick={() => cart.setQuantity(line.key, line.quantity - 1)}
                className={buttonClasses('outline', 'icon')}
                aria-label={t('decrease')}
              >
                <MinusIcon size={18} />
              </button>
              <span className="w-8 text-center font-semibold tabular-nums" aria-live="polite">
                {line.quantity}
              </span>
              <button
                type="button"
                onClick={() => cart.setQuantity(line.key, line.quantity + 1)}
                className={buttonClasses('outline', 'icon')}
                aria-label={t('increase')}
              >
                <PlusIcon size={18} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => cart.remove(line.key)}
              className={buttonClasses('ghostDanger', 'icon')}
              aria-label={t('remove')}
            >
              <TrashIcon size={18} />
            </button>
          </li>
        ))}
      </ul>
      <aside className="h-fit rounded-card border border-earth-100 bg-cream-50 p-5 shadow-card">
        <p className="text-lg font-semibold text-earth-900">{t('items', { count: cart.count })}</p>
        <p className="mt-2 text-sm text-muted">{t('totalsNote')}</p>
        <Link
          href={routes.checkout()}
          onClick={() => reachGoal(Goals.BeginCheckout, { items: cart.count })}
          className={buttonClasses('primary', 'md', 'mt-5 w-full')}
        >
          {t('checkout')}
        </Link>
        <button type="button" onClick={cart.clear} className={buttonClasses('ghost', 'sm', 'mt-2 w-full')}>
          {t('clear')}
        </button>
      </aside>
    </div>
  );
}
