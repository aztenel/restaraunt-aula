'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { CartIcon } from '@/components/ui/icons';
import { useCart } from '@/lib/cart';
import { routes } from '@/lib/routes';

export function CartBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-0.5 -top-0.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-terracotta-500 px-1 text-xs font-bold leading-none text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function CartButton() {
  const t = useTranslations('Header');
  const { count } = useCart();
  return (
    <Link
      href={routes.cart()}
      aria-label={t('cartAria', { count })}
      className="relative grid h-11 w-11 place-items-center rounded-full text-earth-800 hover:bg-earth-50"
    >
      <CartIcon size={22} />
      <CartBadge count={count} />
    </Link>
  );
}
