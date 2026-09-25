import { Fragment } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

export interface Crumb {
  label: string;
  /** Путь без языка; у последнего пункта (текущая страница) не указывается. */
  href?: string;
}

/** «Хлебные крошки» (разметка BreadcrumbList — отдельно, через JSON-LD). */
export async function Breadcrumbs({ items }: { items: Crumb[] }) {
  const t = await getTranslations('Common');
  return (
    <nav aria-label={t('breadcrumbs')} className="pt-5 text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {items.map((item, index) => (
          <Fragment key={`${item.label}-${index}`}>
            {index > 0 ? (
              <li aria-hidden="true" className="text-earth-300">
                /
              </li>
            ) : null}
            <li className="min-w-0">
              {item.href ? (
                <Link href={item.href} className="inline-flex min-h-8 items-center underline-offset-4 hover:text-earth-900 hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span aria-current="page" className="line-clamp-1 font-semibold text-earth-800">
                  {item.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
