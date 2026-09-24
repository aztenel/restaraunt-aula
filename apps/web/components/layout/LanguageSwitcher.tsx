'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { Link, usePathname } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { GlobeIcon } from '@/components/ui/icons';

/**
 * Переключатель языка — обычные ссылки на ту же страницу на другом языке (индексируются,
 * работают без JS). Выпадающий список на <details>.
 */
export function LanguageSwitcher() {
  const t = useTranslations('Header');
  const tl = useTranslations('Languages');
  const locale = useLocale();
  const pathname = usePathname();
  const ref = useRef<HTMLDetailsElement>(null);

  // Закрыть список при переходе и по клику вне.
  useEffect(() => {
    ref.current?.removeAttribute('open');
  }, [pathname, locale]);
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) ref.current.removeAttribute('open');
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  return (
    <details ref={ref} className="group relative">
      <summary
        className="flex h-11 cursor-pointer list-none items-center gap-1.5 rounded-full px-2.5 text-sm font-semibold uppercase text-earth-800 hover:bg-earth-50 [&::-webkit-details-marker]:hidden"
        aria-label={t('language')}
      >
        <GlobeIcon size={18} />
        {locale}
      </summary>
      <ul className="absolute right-0 top-12 z-50 min-w-40 overflow-hidden rounded-2xl border border-earth-100 bg-cream-50 py-1 shadow-card">
        {routing.locales.map((l) => (
          <li key={l}>
            <Link
              href={pathname}
              locale={l}
              hrefLang={l}
              lang={l}
              aria-current={l === locale ? 'true' : undefined}
              className={clsx(
                'flex min-h-11 items-center px-4 text-base hover:bg-earth-50',
                l === locale ? 'font-bold text-earth-900' : 'text-earth-700',
              )}
            >
              {tl(l)}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
