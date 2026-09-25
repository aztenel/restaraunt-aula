'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { call, toApiError } from '@aula/api-client';
import { Link } from '@/i18n/navigation';
import { buttonClasses } from '@/components/ui/button';
import { CheckIcon, GiftIcon, InfoIcon } from '@/components/ui/icons';
import { getBrowserApi } from '@/lib/api';
import type { CertificateOrderStatus as OrderStatus } from '@/lib/api-types';
import { certificateOrderPhase, isPendingPhase, isSafePaymentUrl, type CertificateOrderPhase } from '@/lib/certificates';
import { formatDate, formatDateTime, formatPrice } from '@/lib/format';
import { analyticsValue, Goals, reachGoal } from '@/lib/goals';
import { routes } from '@/lib/routes';

/** Интервалы опроса: пока готовится ссылка — часто, после возврата с оплаты — реже. */
const POLL_PREPARING_MS = 1500;
const POLL_AWAITING_MS = 3000;
const POLL_SLOW_MS = 10_000;
const POLL_RATE_LIMITED_MS = 20_000;
/** Через сколько показать «подтверждение задерживается» и когда прекратить опрос. */
const SLOW_AFTER_MS = 3 * 60_000;
const STOP_AFTER_MS = 15 * 60_000;

function storageFlag(storage: 'local' | 'session', key: string, set = false): boolean {
  try {
    const target = storage === 'local' ? window.localStorage : window.sessionStorage;
    if (set) target.setItem(key, '1');
    return target.getItem(key) === '1';
  } catch {
    return false;
  }
}

/**
 * Статус покупки сертификата: опрос GET /public/certificates/orders/{token}, переход на оплату,
 * когда ссылка готова (только сразу после оформления — ?pay=1, и один раз), затем ожидание
 * подтверждения (оплату подтверждает сервер по вебхуку), выпуск или отказ с подсказкой.
 */
export function CertificateOrderStatus({ token, initial, autoPay }: { token: string; initial: OrderStatus; autoPay: boolean }) {
  const t = useTranslations('CertificateOrder');
  const locale = useLocale();
  const [order, setOrder] = useState<OrderStatus>(initial);
  const [pollError, setPollError] = useState(false);
  const [slow, setSlow] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const startedAt = useRef(Date.now());
  const phase: CertificateOrderPhase = certificateOrderPhase(order);
  const paymentUrl = order.payment?.paymentUrl ?? null;

  const poll = useCallback(async (): Promise<number> => {
    try {
      const data = (await call(
        getBrowserApi(locale).GET('/api/v1/public/certificates/orders/{token}', {
          params: { path: { token }, query: { locale } },
        }),
      )) as unknown as OrderStatus;
      setOrder(data);
      setPollError(false);
      return certificateOrderPhase(data) === 'preparing' ? POLL_PREPARING_MS : POLL_AWAITING_MS;
    } catch (error) {
      setPollError(true);
      return toApiError(error).isRateLimited ? POLL_RATE_LIMITED_MS : POLL_AWAITING_MS * 2;
    }
  }, [locale, token]);

  // Опрос, пока заказ ждёт оплату. Во фоновой вкладке — пауза.
  useEffect(() => {
    if (!isPendingPhase(phase) || stopped) return;
    let cancelled = false;
    let timer: number | undefined;
    const schedule = (delay: number) => {
      timer = window.setTimeout(async () => {
        if (cancelled) return;
        const elapsed = Date.now() - startedAt.current;
        if (elapsed > STOP_AFTER_MS) {
          setStopped(true);
          return;
        }
        if (elapsed > SLOW_AFTER_MS) setSlow(true);
        if (document.hidden) return schedule(POLL_AWAITING_MS);
        const next = await poll();
        if (!cancelled) schedule(elapsed > SLOW_AFTER_MS ? Math.max(next, POLL_SLOW_MS) : next);
      }, delay);
    };
    schedule(phase === 'preparing' ? POLL_PREPARING_MS : POLL_AWAITING_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [phase, poll, stopped]);

  // Сразу после оформления — один автоматический переход на страницу оплаты.
  useEffect(() => {
    if (!autoPay || phase !== 'awaiting' || !isSafePaymentUrl(paymentUrl)) return;
    const key = `aula_cert_pay:${token}`;
    if (storageFlag('session', key)) return;
    storageFlag('session', key, true);
    setRedirecting(true);
    window.location.assign(paymentUrl);
  }, [autoPay, phase, paymentUrl, token]);

  // Цель «покупка сертификата» — один раз на заказ (после выпуска).
  useEffect(() => {
    if (phase !== 'issued') return;
    const key = `aula_goal_cert:${token}`;
    if (storageFlag('local', key)) return;
    storageFlag('local', key, true);
    reachGoal(Goals.CertificatePurchase, { ...analyticsValue(order.total), quantity: order.quantity });
  }, [phase, token, order.total, order.quantity]);

  const refresh = () => {
    startedAt.current = Date.now();
    setSlow(false);
    setStopped(false);
    void poll();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <section aria-live="polite" className="rounded-card border border-earth-100 bg-cream-50 p-6 shadow-card">
        {phase === 'issued' ? (
          <div>
            <span className="grid h-14 w-14 place-items-center rounded-full bg-steppe-100 text-steppe-700">
              <CheckIcon size={28} />
            </span>
            <h2 className="mt-4 text-2xl font-semibold text-earth-900">{t('issuedTitle')}</h2>
            <p className="mt-2 text-earth-800">
              {order.deliveryChannel === 'email' ? t('issuedEmail') : order.deliveryChannel === 'whatsapp' ? t('issuedWhatsapp') : t('issuedNone')}
            </p>
            {order.certificates.length > 0 ? (
              <div className="mt-5">
                <h3 className="text-lg font-semibold text-earth-900">{t('issued')}</h3>
                <ul className="mt-2 space-y-2">
                  {order.certificates.map((certificate) => (
                    <li key={certificate.maskedCode} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-cream-100 px-4 py-3">
                      <span className="font-mono font-semibold tracking-wider text-earth-900">{certificate.maskedCode}</span>
                      <span className="text-sm text-muted">{t('validUntil', { date: formatDate(certificate.expiresAt, locale) })}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 flex gap-2 text-sm text-muted">
                  <InfoIcon size={18} className="shrink-0" />
                  {t('codeNote')}
                </p>
              </div>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-2">
              <Link href={routes.menu()} className={buttonClasses('primary', 'sm')}>
                {t('toMenu')}
              </Link>
              <Link href={routes.certificates()} className={buttonClasses('outline', 'sm')}>
                {t('toCertificates')}
              </Link>
            </div>
          </div>
        ) : phase === 'failed' || phase === 'cancelled' ? (
          <div role="alert">
            <h2 className="text-2xl font-semibold text-earth-900">{phase === 'failed' ? t('failedTitle') : t('cancelledTitle')}</h2>
            <p className="mt-2 text-earth-800">{phase === 'failed' ? t('failedText') : t('cancelledText')}</p>
            <p className="mt-3 text-sm text-muted">{t('lateNote')}</p>
            <Link href={routes.certificates()} className={buttonClasses('primary', 'md', 'mt-5')}>
              {t('retry')}
            </Link>
          </div>
        ) : (
          <div aria-busy={!stopped}>
            <span className="grid h-14 w-14 place-items-center rounded-full bg-gold-200 text-earth-800">
              <GiftIcon size={28} className={clsx(!stopped && 'motion-safe:animate-pulse')} />
            </span>
            <h2 className="mt-4 text-2xl font-semibold text-earth-900">
              {redirecting ? t('redirecting') : phase === 'preparing' ? t('preparingTitle') : slow || stopped ? t('slowTitle') : t('awaitingTitle')}
            </h2>
            <p className="mt-2 text-earth-800">
              {phase === 'preparing' && !slow && !stopped ? t('preparingText') : slow || stopped ? t('slowText') : t('awaitingText')}
            </p>
            {order.payment?.expiresAt ? <p className="mt-2 text-sm text-muted">{t('payUntil', { time: formatDateTime(order.payment.expiresAt, locale) })}</p> : null}
            <div className="mt-5 flex flex-wrap gap-2">
              {phase === 'awaiting' && isSafePaymentUrl(paymentUrl) && !redirecting ? (
                <a href={paymentUrl} className={buttonClasses('primary', 'md')}>
                  {t('payNow')}
                </a>
              ) : null}
              {slow || stopped ? (
                <button type="button" onClick={refresh} className={buttonClasses('outline', 'md')}>
                  {t('refresh')}
                </button>
              ) : null}
            </div>
            {pollError ? <p className="mt-3 text-sm text-terracotta-600">{t('pollError')}</p> : null}
          </div>
        )}
      </section>

      <aside className="h-fit rounded-card border border-earth-100 bg-cream-50 p-5">
        <h2 className="text-lg font-semibold text-earth-900">{t('summary')}</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t('product')}</dt>
            <dd className="text-right font-semibold text-earth-900">{order.productName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t('quantity')}</dt>
            <dd className="font-semibold tabular-nums text-earth-900">{order.quantity}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t('recipient')}</dt>
            <dd className="text-right font-semibold text-earth-900">{order.recipientName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{t('delivery')}</dt>
            <dd className="text-right text-earth-900">
              {order.deliveryChannel === 'email' ? t('channelEmail') : order.deliveryChannel === 'whatsapp' ? t('channelWhatsapp') : t('channelNone')}
            </dd>
          </div>
          <div className="flex justify-between gap-3 border-t border-earth-100 pt-2 text-base">
            <dt className="font-semibold text-earth-900">{t('total')}</dt>
            <dd className="font-bold tabular-nums text-earth-900">{formatPrice(order.total, locale)}</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
