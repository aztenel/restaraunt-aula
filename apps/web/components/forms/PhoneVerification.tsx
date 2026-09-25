'use client';

import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { call, toApiError, type ApiError } from '@aula/api-client';
import { buttonClasses } from '@/components/ui/button';
import { CheckIcon } from '@/components/ui/icons';
import { getBrowserApi } from '@/lib/api';
import type { PhoneVerificationToken } from '@/lib/checkout';
import { formatPhone } from '@/lib/format';
import { inputBase } from './FormField';

type Stage = 'idle' | 'sending' | 'code' | 'verifying';

/**
 * Подтверждение телефона SMS-кодом внутри формы (оплата при получении, бронь без депозита —
 * если этого требует филиал): POST /public/phone-verifications → код → POST …/{id}/verify → токен
 * (действует 30 минут), который форма передаёт при оформлении.
 */
export function PhoneVerification({
  phone,
  verified,
  onVerified,
  intro,
}: {
  phone: string;
  verified: PhoneVerificationToken | null;
  onVerified: (token: PhoneVerificationToken) => void;
  /** Почему нужно подтверждение (текст формы). */
  intro?: string;
}) {
  const t = useTranslations('PhoneVerification');
  const locale = useLocale();
  const id = useId();
  const [stage, setStage] = useState<Stage>('idle');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const messageFor = (apiError: ApiError): string => {
    const seconds = apiError.retryAfterSeconds;
    switch (apiError.code) {
      case 'phone.invalid':
        return t('errors.invalidPhone');
      case 'phone.code_invalid': {
        const left = apiError.details.attemptsLeft;
        return typeof left === 'number' ? t('errors.codeInvalidLeft', { count: left }) : t('errors.codeInvalid');
      }
      case 'phone.code_expired':
        return t('errors.codeExpired');
      case 'phone.too_many_attempts':
        return t('errors.tooManyAttempts');
      case 'phone.resend_too_soon':
      case 'phone.too_many_codes':
      case 'rate_limit.exceeded':
        return seconds ? t('errors.waitSeconds', { seconds }) : t('errors.tooManyCodes');
      case 'phone_verification.not_found':
        return t('errors.codeExpired');
      default:
        return apiError.isNetworkError ? t('errors.network') : t('errors.generic');
    }
  };

  const send = async () => {
    setError(null);
    setStage('sending');
    try {
      const started = await call(getBrowserApi(locale).POST('/api/v1/public/phone-verifications', { body: { phone, locale } }));
      setVerificationId(started.verificationId);
      setResendIn(started.resendAfterSeconds);
      setCode('');
      setStage('code');
    } catch (e) {
      const apiError = toApiError(e);
      if (apiError.retryAfterSeconds) setResendIn(apiError.retryAfterSeconds);
      setError(messageFor(apiError));
      setStage(verificationId ? 'code' : 'idle');
    }
  };

  const verify = async () => {
    if (!verificationId || !code.trim() || stage === 'verifying') return;
    setError(null);
    setStage('verifying');
    try {
      const result = await call(
        getBrowserApi(locale).POST('/api/v1/public/phone-verifications/{id}/verify', {
          params: { path: { id: verificationId } },
          body: { code: code.trim() },
        }),
      );
      onVerified({ token: result.token, phone: result.phone, expiresAt: result.expiresAt });
      setStage('idle');
    } catch (e) {
      const apiError = toApiError(e);
      setError(messageFor(apiError));
      // Код истёк или попытки кончились — нужен новый код.
      if (['phone.code_expired', 'phone.too_many_attempts', 'phone_verification.not_found'].includes(apiError.code)) setVerificationId(null);
      setStage(apiError.code === 'phone.code_invalid' ? 'code' : verificationId ? 'code' : 'idle');
    }
  };

  if (verified) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-2xl border border-steppe-700/30 bg-steppe-100 p-3 text-sm font-semibold text-steppe-700">
        <CheckIcon size={18} />
        {t('verified', { phone: formatPhone(verified.phone) })}
      </p>
    );
  }

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-card border border-gold-400 bg-gold-200/30 p-4">
      <h3 id={`${id}-title`} className="text-lg font-semibold text-earth-900">
        {t('title')}
      </h3>
      <p className="mt-1 text-sm text-earth-800">{intro ?? t('text', { phone: formatPhone(phone) })}</p>
      {stage === 'code' || stage === 'verifying' ? (
        // Не <form>: блок встроен в формы оформления и брони (вложенные формы недопустимы).
        <div className="mt-3">
          <label htmlFor={`${id}-code`} className="block text-sm font-semibold text-earth-800">
            {t('codeLabel', { phone: formatPhone(phone) })}
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id={`${id}-code`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                // Enter подтверждает код, а не отправляет внешнюю форму заказа/брони.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void verify();
                }
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${id}-error` : undefined}
              className={`${inputBase} max-w-40 text-center font-mono text-lg tracking-[0.4em]`}
            />
            <button type="button" onClick={() => void verify()} disabled={stage === 'verifying' || code.length < 4} className={buttonClasses('primary', 'md')}>
              {stage === 'verifying' ? t('verifying') : t('verify')}
            </button>
          </div>
        </div>
      ) : null}
      <div aria-live="polite">
        {error ? (
          <p id={`${id}-error`} className="mt-2 text-sm font-semibold text-terracotta-600">
            {error}
          </p>
        ) : null}
      </div>
      <div className="mt-3">
        {resendIn > 0 ? (
          <p className="text-sm text-muted">{t('resendIn', { seconds: resendIn })}</p>
        ) : (
          <button
            type="button"
            onClick={() => void send()}
            disabled={stage === 'sending' || !phone.trim()}
            className={buttonClasses(stage === 'idle' || stage === 'sending' ? 'primary' : 'outline', 'sm')}
          >
            {stage === 'sending' ? t('sending') : verificationId ? t('resend') : t('send')}
          </button>
        )}
      </div>
    </section>
  );
}
