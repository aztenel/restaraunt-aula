'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { OrnamentDivider } from '@/components/brand/Ornament';
import { buttonClasses } from '@/components/ui/button';
import { reportError } from '@/lib/report-error';
import { routes } from '@/lib/routes';

/** Ошибка страницы (например, API недоступен): понятный текст и повтор без перезагрузки. */
export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('Error');
  useEffect(() => {
    reportError(error);
  }, [error]);
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-24" role="alert">
      <OrnamentDivider className="mx-auto max-w-48" />
      <h1 className="mt-6 text-3xl font-semibold text-earth-900">{t('title')}</h1>
      <p className="mx-auto mt-3 max-w-md text-lg text-muted">{t('text')}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button type="button" onClick={reset} className={buttonClasses('primary')}>
          {t('retry')}
        </button>
        <Link href={routes.home()} className={buttonClasses('outline')}>
          {t('home')}
        </Link>
      </div>
      {error.digest ? <p className="mt-6 text-xs text-muted">ID: {error.digest}</p> : null}
    </div>
  );
}
