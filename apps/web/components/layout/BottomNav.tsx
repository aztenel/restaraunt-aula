'use client';

import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import type { ComponentType } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { CalendarIcon, CartIcon, CelebrationIcon, UtensilsIcon } from '@/components/ui/icons';
import { useCart } from '@/lib/cart';
import { routes, RESERVED_FIRST_SEGMENTS } from '@/lib/routes';
import { CartBadge } from './CartButton';

type NavKey = 'menu' | 'booking' | 'banquets' | 'cart';

const ITEMS: Array<{ key: NavKey; href: string; icon: ComponentType<{ size?: number }> }> = [
  { key: 'menu', href: routes.menu(), icon: UtensilsIcon },
  { key: 'booking', href: routes.booking(), icon: CalendarIcon },
  { key: 'banquets', href: routes.banquets(), icon: CelebrationIcon },
  { key: 'cart', href: routes.cart(), icon: CartIcon },
];

function isActive(key: NavKey, pathname: string): boolean {
  const [first, second] = pathname.split('/').filter(Boolean);
  if (key === 'menu') return first === 'menu' || (first !== undefined && !RESERVED_FIRST_SEGMENTS.has(first) && second === 'menu');
  if (key === 'cart') return first === 'cart' || first === 'checkout';
  return first === key;
}

/** Нижняя навигация на телефоне (>80% трафика): Меню, Бронь, Банкеты, Корзина. */
export function BottomNav() {
  const t = useTranslations('Nav');
  const pathname = usePathname();
  const { count } = useCart();
  return (
    <nav
      aria-label={t('mobileNavigation')}
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-earth-100 bg-cream-50/95 backdrop-blur md:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {ITEMS.map(({ key, href, icon: Icon }) => {
          const active = isActive(key, pathname);
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'relative flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold',
                  active ? 'text-earth-900' : 'text-earth-500 hover:text-earth-800',
                )}
              >
                <span className="relative">
                  <Icon size={24} />
                  {key === 'cart' ? <CartBadge count={count} /> : null}
                </span>
                {t(key)}
                {active ? <span className="absolute top-0 h-0.5 w-8 rounded-full bg-gold-500" aria-hidden="true" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
