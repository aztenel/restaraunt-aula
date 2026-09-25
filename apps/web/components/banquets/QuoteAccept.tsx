'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { call, toApiError } from '@aula/api-client';
import { useRouter } from '@/i18n/navigation';
import { FormError } from '@/components/forms/FormField';
import { buttonClasses } from '@/components/ui/button';
import { CheckIcon } from '@/components/ui/icons';
import { getBrowserApi } from '@/lib/api';
import { apiErrorKey } from '@/lib/api-errors';
import type { BanquetAcceptResult } from '@/lib/api-types';
import { formatPrice } from '@/lib/format';

type AcceptError = 'outdated' | 'expired' | 'not_awaiting' | 'other';

function acceptErrorKind(code: string): AcceptError {
  switch (code) {
    case 'banquet_quote.outdated':
      return 'outdated';
    case 'banquet_quote.expired':
      return 'expired';
    case 'banquet_quote.not_awaiting_acceptance':
      return 'not_awaiting';
    default:
      return 'other';
  }
}

/**
 * Согласование сметы: POST /public/banquets/quotes/:token/accept { version } — согласуется ровно
 * показанная версия (если менеджер успел отправить новую — сервер ответит banquet_quote.outdated,
 * и гость увидит актуальную смету после обновления).
 */
export function QuoteAccept({ token, version, canAccept, accepted }: { token: string; version: number; canAccept: boolean; accepted: boolean }) {
  const t = useTranslations('BanquetQuote');
  const apiErrors = useTranslations('ApiErrors');
  const locale = useLocale();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BanquetAcceptResult | null>(null);
  const [error, setError] = useState<{ kind: AcceptError; text: string } | null>(null);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await call(getBrowserApi(locale).POST('/api/v1/public/banquets/quotes/{token}/accept', { params: { path: { token } }, body: { version } }));
      setResult(data);
      router.refresh();
    } catch (e) {
      const apiError = toApiError(e);
      const kind = acceptErrorKind(apiError.code);
      setError({ kind, text: kind === 'other' ? apiErrors(apiErrorKey(apiError, (k) => apiErrors.has(k))) : t(`acceptErrors.${kind}`) });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (result || accepted) {
    return (
      <div role="status" className="rounded-card border border-steppe-700/30 bg-steppe-100 p-5 text-steppe-700">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <CheckIcon size={22} />
          {t('acceptedTitle')}
        </p>
        <p className="mt-1 text-earth-900">
          {result?.prepayment ? t('acceptedPrepayment', { amount: formatPrice(result.prepayment, locale) }) : t('acceptedText')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <FormError>
          {error.text}{' '}
          {error.kind === 'outdated' || error.kind === 'not_awaiting' ? (
            <button type="button" onClick={() => router.refresh()} className="underline underline-offset-4">
              {t('reload')}
            </button>
          ) : null}
        </FormError>
      ) : null}
      {canAccept ? (
        confirming ? (
          <div className="space-y-3 rounded-card border border-gold-400 bg-gold-200/40 p-4">
            <p className="text-earth-900">{t('confirmText', { version })}</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => void accept()} disabled={busy} className={buttonClasses('primary', 'md')}>
                {busy ? t('accepting') : t('confirm')}
              </button>
              <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={buttonClasses('ghost', 'md')}>
                {t('cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className={buttonClasses('primary', 'lg', 'w-full sm:w-auto')}>
            {t('accept')}
          </button>
        )
      ) : !error ? (
        <p className="text-sm text-muted">{t('cannotAccept')}</p>
      ) : null}
    </div>
  );
}
