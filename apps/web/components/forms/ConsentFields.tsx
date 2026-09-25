'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { routes } from '@/lib/routes';

/**
 * Согласия в формах витрины: на обработку ПД — обязательно (ссылка на действующий текст,
 * версию фиксирует сервер), на рассылки — по желанию.
 */
export function ConsentFields({
  idPrefix,
  personalData,
  marketing,
  onChange,
  error,
}: {
  idPrefix: string;
  personalData: boolean;
  marketing: boolean;
  onChange: (patch: { personalData?: boolean; marketing?: boolean }) => void;
  error?: string;
}) {
  const t = useTranslations('Forms');
  const id = `${idPrefix}-consentPersonalData`;
  return (
    <div className="space-y-3 rounded-card border border-earth-100 bg-cream-50 p-4">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={personalData}
          onChange={(e) => onChange({ personalData: e.target.checked })}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-0.5 h-5 w-5 shrink-0 accent-earth-700"
        />
        <label htmlFor={id} className="text-earth-900">
          {t('consentPersonalData')}{' '}
          <Link href={routes.consent('personal-data')} target="_blank" className="font-semibold text-earth-700 underline underline-offset-4">
            {t('consentLink')}
          </Link>
        </label>
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-sm font-semibold text-terracotta-600">
          {error}
        </p>
      ) : null}
      <div className="flex items-start gap-3">
        <input
          id={`${idPrefix}-consentMarketing`}
          type="checkbox"
          checked={marketing}
          onChange={(e) => onChange({ marketing: e.target.checked })}
          className="mt-0.5 h-5 w-5 shrink-0 accent-earth-700"
        />
        <label htmlFor={`${idPrefix}-consentMarketing`} className="text-sm text-earth-800">
          {t('consentMarketing')} <span className="text-muted">· {t('optional')}</span>
        </label>
      </div>
    </div>
  );
}
