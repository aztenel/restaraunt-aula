import clsx from 'clsx';
import { Link } from '@/i18n/navigation';
import { ScrollActiveChip } from './ScrollActiveChip';

export interface CategoryNavItem {
  key: string;
  label: string;
  /** Путь без языка (страница категории) или '#якорь' раздела на странице меню. */
  href: string;
  active?: boolean;
}

const chip =
  'inline-flex min-h-10 snap-start items-center whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition-colors';

/**
 * Разделы меню: липкая горизонтальная лента под шапкой (телефон), крупные зоны нажатия.
 * На странице меню ведёт к разделам на странице (якоря), на странице категории — к другим категориям.
 */
export function CategoryNav({ label, items, id = 'menu-categories' }: { label: string; items: CategoryNavItem[]; id?: string }) {
  if (items.length === 0) return null;
  return (
    <nav
      aria-label={label}
      className="sticky top-16 z-30 -mx-4 border-b border-earth-100/80 bg-cream-100/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-cream-100/85 sm:-mx-6 sm:px-6"
    >
      <ul id={id} className="scrollbar-none -mx-1 flex snap-x gap-2 overflow-x-auto px-1 py-2.5">
        {items.map((item) => {
          const className = clsx(
            chip,
            item.active
              ? 'border-earth-700 bg-earth-700 text-cream-50'
              : 'border-earth-200 bg-cream-50 text-earth-800 hover:border-gold-400',
          );
          return (
            <li key={item.key} className="shrink-0">
              {item.href.startsWith('#') ? (
                <a href={item.href} className={className}>
                  {item.label}
                </a>
              ) : (
                <Link href={item.href} className={className} aria-current={item.active ? 'page' : undefined}>
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <ScrollActiveChip listId={id} />
    </nav>
  );
}
