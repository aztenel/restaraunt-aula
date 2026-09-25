'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { call, toApiError } from '@aula/api-client';
import { FormError, FormField, inputClass } from '@/components/forms/FormField';
import { buttonClasses } from '@/components/ui/button';
import { CalendarIcon, MapPinIcon, PhoneIcon, UsersIcon } from '@/components/ui/icons';
import { Link } from '@/i18n/navigation';
import { getBrowserApi } from '@/lib/api';
import { apiErrorKey } from '@/lib/api-errors';
import type { Reservation } from '@/lib/api-types';
import { reservationPaymentRedirect, reservationPhase, reservationPollDelay, type ReservationPhase } from '@/lib/booking';
import { formatDate, formatDateTime, formatLocalDate, formatPhone, formatPrice, telHref } from '@/lib/format';
import { goToPayment, isSafePaymentUrl, redirectFlagKey, storageFlag } from '@/lib/payment-flow';
import { routes } from '@/lib/routes';

const PHASE_TONE: Record<ReservationPhase, string> = {
  deposit_preparing: 'border-gold-400 bg-gold-200/40',
  deposit_awaiting: 'border-gold-400 bg-gold-200/40',
  deposit_failed: 'border-terracotta-500/50 bg-terracotta-500/5',
  pending: 'border-gold-400 bg-gold-200/40',
  confirmed: 'border-steppe-700/30 bg-steppe-100',
  arrived: 'border-steppe-700/30 bg-steppe-100',
  cancelled: 'border-earth-200 bg-cream-50',
  expired: 'border-earth-200 bg-cream-50',
  no_show: 'border-earth-200 bg-cream-50',
};

const CANCEL_REASON_MAX = 500;

/**
 * Страница брони по токену: статус (опрос, пока ждём оплату депозита или подтверждение),
 * однократный переход на оплату депозита, повтор оплаты, отмена с показом правил (депозит
 * вернётся или будет удержан — решает сервер, depositOutcomeIfCancelled).
 */
export function ReservationStatusView({ token, initial, autoPay }: { token: string; initial: Reservation; autoPay: boolean }) {
  const t = useTranslations('BookingStatus');
  const apiErrors = useTranslations('ApiErrors');
  const locale = useLocale();
  const [reservation, setReservation] = useState(initial);
  const [payNow, setPayNow] = useState(autoPay);
  const [busy, setBusy] = useState<'pay' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pollFailed, setPollFailed] = useState(false);
  const phase = reservationPhase(reservation);
  const api = getBrowserApi(locale);

  const refresh = useCallback(async () => {
    try {
      const data = await call(getBrowserApi(locale).GET('/api/v1/public/reservations/{token}', { params: { path: { token }, query: { locale } } }));
      setReservation(data);
      setPollFailed(false);
    } catch {
      setPollFailed(true);
    }
  }, [locale, token]);

  useEffect(() => {
    const delay = reservationPollDelay(reservation);
    if (delay === null) return;
    const timer = window.setTimeout(() => {
      if (document.hidden) {
        setReservation((r) => ({ ...r }));
        return;
      }
      void refresh();
    }, pollFailed ? Math.max(delay, 10_000) : delay);
    return () => window.clearTimeout(timer);
  }, [reservation, pollFailed, refresh]);

  // Переход на оплату депозита — один раз на каждую ссылку оплаты.
  useEffect(() => {
    const url = reservation.deposit?.paymentUrl ?? null;
    const flag = redirectFlagKey('booking', token, url);
    const target = reservationPaymentRedirect(reservation, { autoPay: payNow, alreadyRedirected: storageFlag('session', flag) });
    if (!target) return;
    storageFlag('session', flag, true);
    goToPayment(target);
  }, [reservation, payNow, token]);

  const errorText = (e: unknown) => {
    const apiError = toApiError(e);
    return apiErrors(apiErrorKey(apiError, (k) => apiErrors.has(k)));
  };

  const retryPayment = async () => {
    setBusy('pay');
    setError(null);
    try {
      const data = await call(api.POST('/api/v1/public/reservations/{token}/pay', { params: { path: { token }, query: { locale } } }));
      setReservation(data);
      setPayNow(true);
    } catch (e) {
      setError(errorText(e));
      void refresh();
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy('cancel');
    setError(null);
    try {
      const text = reason.trim();
      const data = await call(
        api.POST('/api/v1/public/reservations/{token}/cancel', { params: { path: { token }, query: { locale } }, body: text ? { reason: text } : {} }),
      );
      setReservation(data);
      setCancelOpen(false);
      setPayNow(false);
    } catch (e) {
      setError(errorText(e));
      void refresh();
    } finally {
      setBusy(null);
    }
  };

  const slot = (iso: string) => formatDate(iso, locale, { hour: '2-digit', minute: '2-digit' });
  const deposit = reservation.deposit;
  const payUrl = deposit?.paymentUrl;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <section aria-live="polite" className={`rounded-card border p-6 ${PHASE_TONE[phase]}`}>
          <p className="text-sm text-muted">{t('number', { number: reservation.number })}</p>
          <h2 className="mt-1 text-2xl font-semibold text-earth-900">{t(`phase.${phase}`)}</h2>
          <p className="mt-2 text-earth-800">{t(`phaseText.${phase}`)}</p>

          {(phase === 'deposit_awaiting' || phase === 'deposit_preparing') && reservation.holdExpiresAt ? (
            <p className="mt-2 text-sm text-earth-800">{t('holdUntil', { time: formatDateTime(reservation.holdExpiresAt, locale) })}</p>
          ) : null}

          {phase === 'deposit_awaiting' && deposit && isSafePaymentUrl(payUrl) ? (
            <a href={payUrl} className={buttonClasses('primary', 'md', 'mt-4')}>
              {t('payDeposit', { amount: formatPrice(deposit.amount, locale) })}
            </a>
          ) : null}

          {phase === 'deposit_failed' ? (
            reservation.canPay && deposit ? (
              <button type="button" onClick={() => void retryPayment()} disabled={busy !== null} className={buttonClasses('primary', 'md', 'mt-4')}>
                {busy === 'pay' ? t('paying') : t('retryPayment', { amount: formatPrice(deposit.amount, locale) })}
              </button>
            ) : (
              <p className="mt-2 text-sm text-muted">{t('retryUnavailable')}</p>
            )
          ) : null}

          {reservation.cancelReason && phase === 'cancelled' ? <p className="mt-2 text-sm text-earth-800">{t('cancelReason', { reason: reservation.cancelReason })}</p> : null}
          {pollFailed ? <p className="mt-3 text-sm text-muted">{t('pollError')}</p> : null}
        </section>

        {error ? <FormError>{error}</FormError> : null}

        {deposit && deposit.state !== 'none' ? (
          <section aria-labelledby="deposit-title" className="rounded-card border border-earth-100 bg-cream-50 p-6">
            <h2 id="deposit-title" className="text-lg font-semibold text-earth-900">
              {t('depositTitle')}
            </h2>
            <p className="mt-2 text-earth-900">
              <span className="text-xl font-bold tabular-nums">{formatPrice(deposit.amount, locale)}</span>
              <span className="ml-2 text-sm text-earth-700">{t(`depositState.${deposit.state}`)}</span>
            </p>
            <p className="mt-1 text-sm text-muted">{t('depositCounts')}</p>
          </section>
        ) : null}

        {reservation.canCancel ? (
          <section aria-labelledby="cancel-title" className="rounded-card border border-earth-100 bg-cream-50 p-6">
            <h2 id="cancel-title" className="text-lg font-semibold text-earth-900">
              {t('cancelTitle')}
            </h2>
            <p className="mt-2 text-sm text-earth-800">
              {deposit && deposit.state !== 'none' && deposit.state !== 'waived'
                ? t(`cancelOutcome.${reservation.depositOutcomeIfCancelled}`, { deadline: formatDateTime(reservation.cancellationDeadline, locale) })
                : t('cancelFree', { deadline: formatDateTime(reservation.cancellationDeadline, locale) })}
            </p>
            {reservation.policy.text ? <p className="mt-2 whitespace-pre-line text-sm text-muted">{reservation.policy.text}</p> : null}
            {cancelOpen ? (
              <div className="mt-4 space-y-3">
                <FormField id="cancel-reason" label={t('cancelReasonLabel')} optional>
                  <textarea
                    id="cancel-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value.slice(0, CANCEL_REASON_MAX))}
                    rows={2}
                    className={`${inputClass} py-2`}
                  />
                </FormField>
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={() => void cancel()} disabled={busy !== null} className={buttonClasses('ghostDanger', 'md')}>
                    {busy === 'cancel' ? t('cancelling') : t('cancelConfirm')}
                  </button>
                  <button type="button" onClick={() => setCancelOpen(false)} disabled={busy !== null} className={buttonClasses('ghost', 'md')}>
                    {t('cancelKeep')}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setCancelOpen(true)} className={buttonClasses('outline', 'sm', 'mt-4')}>
                {t('cancelOpen')}
              </button>
            )}
          </section>
        ) : null}
      </div>

      <aside className="h-fit space-y-4 rounded-card border border-earth-100 bg-cream-50 p-5 shadow-card" aria-labelledby="reservation-details">
        <h2 id="reservation-details" className="text-lg font-semibold text-earth-900">
          {t('details')}
        </h2>
        <ul className="space-y-3 text-sm text-earth-800">
          <li className="flex gap-2">
            <CalendarIcon size={18} className="mt-0.5 shrink-0 text-earth-400" />
            <span>
              {formatLocalDate(reservation.date, locale)}, {slot(reservation.start)}–{slot(reservation.end)}
            </span>
          </li>
          <li className="flex gap-2">
            <UsersIcon size={18} className="mt-0.5 shrink-0 text-earth-400" />
            <span>
              {t('guests', { count: reservation.guests })}
              <span className="block text-xs text-muted">
                {reservation.venue.name} · {reservation.venue.typeName} · {reservation.venue.hallName}
              </span>
            </span>
          </li>
          <li className="flex gap-2">
            <MapPinIcon size={18} className="mt-0.5 shrink-0 text-earth-400" />
            <span>
              {reservation.branch.name}
              <span className="block text-xs text-muted">{reservation.branch.address}</span>
            </span>
          </li>
          {reservation.occasion ? <li>{t('occasion', { value: reservation.occasion })}</li> : null}
          {reservation.comment ? <li className="text-muted">{reservation.comment}</li> : null}
        </ul>
        <a href={telHref(reservation.branch.phone)} className={buttonClasses('outline', 'sm', 'w-full')}>
          <PhoneIcon size={18} />
          {t('callBranch', { phone: formatPhone(reservation.branch.phone) })}
        </a>
        {phase === 'cancelled' || phase === 'expired' ? (
          <Link href={{ pathname: routes.booking(), query: { branch: reservation.branch.slug } }} className={buttonClasses('primary', 'sm', 'w-full')}>
            {t('bookAgain')}
          </Link>
        ) : null}
      </aside>
    </div>
  );
}
