'use client';

import clsx from 'clsx';
import { useId, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { call, toApiError, type ApiError } from '@aula/api-client';
import { buttonClasses } from '@/components/ui/button';
import { getBrowserApi } from '@/lib/api';
import { apiErrorKey, retryAfterMinutes } from '@/lib/api-errors';
import type { CertificateBalance } from '@/lib/api-types';
import { formatCertificateCode, isCompleteCertificateCode } from '@/lib/certificates';
import { formatLocalDate, formatPrice } from '@/lib/format';

const STATUS_KEYS = {
  active: 'statusActive',
  redeemed: 'statusRedeemed',
  expired: 'statusExpired',
  blocked: 'statusBlocked',
} as const;

/**
 * Проверка баланса сертификата по коду (POST /public/certificates/check). Сервер ограничивает
 * частоту и блокирует подбор (429) — показываем вежливое сообщение со временем ожидания.
 * Полный код не хранится и не показывается: в ответе — маска и остаток.
 */
export function CertificateBalanceCheck() {
  const t = useTranslations('CertificateCheck');
  const apiErrors = useTranslations('ApiErrors');
  const locale = useLocale();
  const id = useId();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<CertificateBalance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const messageFor = (apiError: ApiError): string => {
    if (apiError.isRateLimited) {
      const minutes = retryAfterMinutes(apiError);
      return minutes ? t('rateLimited', { minutes }) : t('rateLimitedLater');
    }
    if (apiError.isNotFound) return t('notFound');
    if (apiError.status === 400) return t('invalidCode');
    return apiErrors(apiErrorKey(apiError, (k) => apiErrors.has(k)));
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (checking) return;
    setResult(null);
    if (!isCompleteCertificateCode(code)) {
      setError(t('invalidCode'));
      return;
    }
    setError(null);
    setChecking(true);
    try {
      const api = getBrowserApi(locale);
      const data = await call(api.POST('/api/v1/public/certificates/check', { body: { code } }));
      setResult(data as unknown as CertificateBalance);
    } catch (e) {
      setError(messageFor(toApiError(e)));
    } finally {
      setChecking(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-card border border-earth-100 bg-cream-50 p-5 shadow-card">
      <h2 id={`${id}-title`} className="text-xl font-semibold text-earth-900">
        {t('title')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('text')}</p>
      <form onSubmit={onSubmit} noValidate className="mt-4">
        <label htmlFor={`${id}-code`} className="block text-sm font-semibold text-earth-800">
          {t('code')}
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id={`${id}-code`}
            value={code}
            onChange={(e) => {
              setCode(formatCertificateCode(e.target.value));
              setError(null);
            }}
            placeholder={t('placeholder')}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            maxLength={14}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            className="h-12 min-w-0 flex-1 rounded-xl border border-earth-200 bg-cream-50 px-3 font-mono text-base uppercase tracking-wider aria-[invalid=true]:border-terracotta-500"
          />
          <button type="submit" disabled={checking} className={buttonClasses('primary', 'md', 'shrink-0')}>
            {checking ? t('checking') : t('submit')}
          </button>
        </div>
        <div aria-live="polite">
          {error ? (
            <p id={`${id}-error`} className="mt-2 text-sm font-semibold text-terracotta-600">
              {error}
            </p>
          ) : null}
        </div>
      </form>

      <div aria-live="polite">
        {result ? (
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl bg-cream-100 p-4">
            <div className="col-span-2 flex items-center justify-between gap-2">
              <dt className="sr-only">{t('code')}</dt>
              <dd className="font-mono text-lg font-semibold tracking-wider text-earth-900">{result.maskedCode}</dd>
              <dd
                className={clsx(
                  'rounded-full px-2.5 py-1 text-xs font-bold',
                  result.status === 'active' ? 'bg-steppe-100 text-steppe-700' : 'bg-earth-100 text-earth-700',
                )}
              >
                <span className="sr-only">{t('status')}: </span>
                {t(STATUS_KEYS[result.status])}
              </dd>
            </div>
            {result.kind === 'amount' ? (
              <div>
                <dt className="text-xs text-muted">{t('balance')}</dt>
                <dd className="text-2xl font-bold tabular-nums text-earth-900">{formatPrice(result.balance, locale)}</dd>
              </div>
            ) : (
              <div>
                <dt className="text-xs text-muted">{t('kindSet')}</dt>
                <dd className="font-semibold text-earth-900">{formatPrice(result.nominal, locale)}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted">{t('validUntil')}</dt>
              <dd className="font-semibold text-earth-900">{formatLocalDate(result.validUntil, locale)}</dd>
            </div>
            {result.kind === 'amount' ? (
              <div>
                <dt className="text-xs text-muted">{t('nominal')}</dt>
                <dd className="text-earth-800">{formatPrice(result.nominal, locale)}</dd>
              </div>
            ) : null}
            {result.setDescription ? (
              <div className="col-span-2">
                <dt className="text-xs text-muted">{t('set')}</dt>
                <dd className="text-sm text-earth-800">{result.setDescription}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>
    </section>
  );
}
