'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { call, toApiError } from '@aula/api-client';
import { Link } from '@/i18n/navigation';
import { buttonClasses } from '@/components/ui/button';
import { CheckIcon, ClockIcon, MapPinIcon, PhoneIcon } from '@/components/ui/icons';
import { getBrowserApi } from '@/lib/api';
import { apiErrorKey } from '@/lib/api-errors';
import type { OrderStatus, OrderTracking } from '@/lib/api-types';
import { formatDateTime, formatPhone, formatPrice, telHref } from '@/lib/format';
import { analyticsValue, Goals, reachGoal } from '@/lib/goals';
import { isPurchaseComplete, orderPaymentRedirect, orderPhase, orderPollDelay, timelineSteps } from '@/lib/order-status';
import { goToPayment, isSafePaymentUrl, reachGoalOnce, redirectFlagKey, storageFlag } from '@/lib/payment-flow';
import { routes } from '@/lib/routes';

const STATUS_KEYS: Record<OrderStatus, `status.${OrderStatus}`> = {
  draft: 'status.draft',
  awaiting_payment: 'status.awaiting_payment',
  paid: 'status.paid',
  accepted: 'status.accepted',
  cooking: 'status.cooking',
  ready: 'status.ready',
  delivering: 'status.delivering',
  completed: 'status.completed',
  cancelled: 'status.cancelled',
  refunded: 'status.refunded',
};

/**
 * Статус заказа для гостя: опрос GET /public/orders/:token, однократный переход на оплату (сразу
 * после оформления или после «Оплатить снова»), лента статусов, обещанное время, состав и суммы
 * заказа (все — от сервера), контакты филиала, повтор оплаты POST /public/orders/:token/pay.
 */
export function OrderStatusView({ token, initial, autoPay }: { token: string; initial: OrderTracking; autoPay: boolean }) {
  const t = useTranslations('Order');
  const apiErrors = useTranslations('ApiErrors');
  const locale = useLocale();
  const [order, setOrder] = useState(initial);
  const [payNow, setPayNow] = useState(autoPay);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollFailed, setPollFailed] = useState(false);
  const startedAt = useRef(Date.now());
  const phase = orderPhase(order);
  const paymentId = order.payment.current?.id ?? null;

  const refresh = useCallback(async (): Promise<OrderTracking | null> => {
    try {
      const data = await call(
        getBrowserApi(locale).GET('/api/v1/public/orders/{publicToken}', { params: { path: { publicToken: token }, query: { locale } } }),
      );
      setOrder(data);
      setPollFailed(false);
      return data;
    } catch {
      setPollFailed(true);
      return null;
    }
  }, [locale, token]);

  // Опрос до итогового статуса; фоновая вкладка — пауза.
  useEffect(() => {
    const delay = orderPollDelay(order, Date.now() - startedAt.current);
    if (delay === null) return;
    const timer = window.setTimeout(() => {
      if (document.hidden) {
        setOrder((o) => ({ ...o }));
        return;
      }
      void refresh();
    }, pollFailed ? Math.max(delay, 10_000) : delay);
    return () => window.clearTimeout(timer);
  }, [order, pollFailed, refresh]);

  // Однократный переход на оплату (по каждой попытке платежа).
  useEffect(() => {
    const flag = redirectFlagKey('order', token, paymentId);
    const url = orderPaymentRedirect(order, { autoPay: payNow, alreadyRedirected: storageFlag('session', flag) });
    if (!url) return;
    storageFlag('session', flag, true);
    goToPayment(url);
  }, [order, payNow, paymentId, token]);

  // Цель «покупка» — один раз, когда заказ оплачен (или оплата при получении обеспечена).
  useEffect(() => {
    if (!isPurchaseComplete(order)) return;
    reachGoalOnce(`aula_goal_order:${token}`, () =>
      reachGoal(Goals.Purchase, { ...analyticsValue(order.total), transaction_id: order.number, order_type: order.type }),
    );
  }, [order, token]);

  const retryPayment = async () => {
    setRetrying(true);
    setError(null);
    try {
      const payment = await call(getBrowserApi(locale).POST('/api/v1/public/orders/{publicToken}/pay', { params: { path: { publicToken: token } } }));
      const flag = redirectFlagKey('order', token, payment.id);
      if (isSafePaymentUrl(payment.paymentUrl) && !storageFlag('session', flag)) {
        storageFlag('session', flag, true);
        goToPayment(payment.paymentUrl);
        return;
      }
      setPayNow(true);
      startedAt.current = Date.now();
      await refresh();
    } catch (e) {
      const apiError = toApiError(e);
      if (apiError.code === 'order.already_paid' || apiError.code === 'order.not_awaiting_payment') {
        await refresh();
      } else {
        setError(
          apiError.code === 'order.payment_retry_not_available' || apiError.code === 'order.payment_expired'
            ? t('retryUnavailable')
            : apiErrors(apiErrorKey(apiError, (k) => apiErrors.has(k))),
        );
      }
    } finally {
      setRetrying(false);
    }
  };

  const steps = timelineSteps(order);
  const statusLabel = order.status === 'ready' && order.type === 'pickup' ? t('statusReadyPickup') : t(STATUS_KEYS[order.status]);
  const currentUrl = order.payment.current?.paymentUrl;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <section aria-live="polite" className="rounded-card border border-earth-100 bg-cream-50 p-6 shadow-card">
          <p className="text-sm text-muted">{t('number', { number: order.number })}</p>
          <h2 className="mt-1 text-2xl font-semibold text-earth-900">{statusLabel}</h2>

          {phase === 'preparing_payment' ? <p className="mt-2 text-earth-800">{t('preparingPayment')}</p> : null}

          {phase === 'awaiting_payment' ? (
            <div className="mt-2 space-y-3">
              <p className="text-earth-800">{t('awaitingPayment')}</p>
              {order.payment.payUntil ? <p className="text-sm text-muted">{t('payUntil', { time: formatDateTime(order.payment.payUntil, locale) })}</p> : null}
              {isSafePaymentUrl(currentUrl) ? (
                <a href={currentUrl} className={buttonClasses('primary', 'md')}>
                  {t('pay', { amount: formatPrice(order.payment.amountDue, locale) })}
                </a>
              ) : null}
            </div>
          ) : null}

          {phase === 'payment_failed' ? (
            <div role="alert" className="mt-2 space-y-3">
              <p className="text-earth-800">{t('paymentFailed')}</p>
              {order.payment.canRetry ? (
                <button type="button" onClick={() => void retryPayment()} disabled={retrying} className={buttonClasses('primary', 'md')}>
                  {retrying ? t('retrying') : t('retryPayment', { amount: formatPrice(order.payment.amountDue, locale) })}
                </button>
              ) : (
                <p className="text-sm text-muted">{t('retryUnavailable')}</p>
              )}
            </div>
          ) : null}

          {phase === 'in_progress' ? (
            <p className="mt-2 flex items-center gap-2 text-earth-800">
              <ClockIcon size={18} className="shrink-0 text-earth-400" />
              {order.type === 'delivery'
                ? t('promisedDelivery', { time: formatDateTime(order.promisedAt, locale) })
                : t('promisedPickup', { time: formatDateTime(order.promisedAt, locale) })}
            </p>
          ) : null}

          {phase === 'completed' ? <p className="mt-2 text-earth-800">{t('completedText')}</p> : null}

          {phase === 'cancelled' ? (
            <div className="mt-2 space-y-1 text-earth-800">
              {order.cancellation ? (
                <p>
                  {t('cancelReason', {
                    reason: order.cancellation.reasonCode === 'other' ? order.cancellation.reason : t(`cancelReasons.${order.cancellation.reasonCode}`),
                  })}
                </p>
              ) : null}
              {order.payment.isPaid || order.status === 'refunded' ? <p className="text-sm text-muted">{t('refundNote')}</p> : null}
            </div>
          ) : null}

          {order.courier?.trackingUrl && isSafePaymentUrl(order.courier.trackingUrl) ? (
            <a href={order.courier.trackingUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses('outline', 'sm', 'mt-4')}>
              {t('trackCourier')}
            </a>
          ) : null}

          {error ? <p className="mt-3 text-sm font-semibold text-terracotta-600">{error}</p> : null}
          {pollFailed ? <p className="mt-3 text-sm text-muted">{t('pollError')}</p> : null}
        </section>

        <section aria-labelledby="order-timeline" className="rounded-card border border-earth-100 bg-cream-50 p-6">
          <h2 id="order-timeline" className="text-lg font-semibold text-earth-900">
            {t('timeline')}
          </h2>
          <ol className="mt-4 space-y-3">
            {steps.map((step) => (
              <li key={step.status} className="flex items-start gap-3" aria-current={step.state === 'current' ? 'step' : undefined}>
                <span
                  className={clsx(
                    'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full',
                    step.state === 'done' && 'bg-steppe-700 text-cream-50',
                    step.state === 'current' && 'bg-gold-400 text-earth-900',
                    step.state === 'upcoming' && 'border-2 border-earth-200',
                  )}
                  aria-hidden="true"
                >
                  {step.state === 'done' ? <CheckIcon size={14} /> : null}
                </span>
                <span className={clsx(step.state === 'upcoming' ? 'text-muted' : 'text-earth-900', step.state === 'current' && 'font-semibold')}>
                  {step.status === 'ready' && order.type === 'pickup' ? t('statusReadyPickup') : t(STATUS_KEYS[step.status])}
                  {step.at ? <span className="block text-xs text-muted">{formatDateTime(step.at, locale)}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="h-fit space-y-4 rounded-card border border-earth-100 bg-cream-50 p-5 shadow-card">
        <h2 className="text-lg font-semibold text-earth-900">{t('items')}</h2>
        <ul className="space-y-2 text-sm">
          {order.items.map((item, index) => (
            <li key={`${item.dishId}-${index}`} className="flex justify-between gap-3">
              <span className="min-w-0">
                {item.name} × {item.quantity}
                {item.modifiers.length > 0 ? <span className="block text-xs text-muted">{item.modifiers.map((m) => m.name).join(', ')}</span> : null}
              </span>
              <span className="shrink-0 tabular-nums">{formatPrice(item.lineTotal, locale)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1.5 border-t border-earth-100 pt-3 text-sm text-earth-800">
          <div className="flex justify-between gap-3">
            <dt>{t('subtotal')}</dt>
            <dd className="tabular-nums">{formatPrice(order.subtotal, locale)}</dd>
          </div>
          {order.discount.amount > 0 ? (
            <div className="flex justify-between gap-3 text-steppe-700">
              <dt>{order.promoCode ? t('discountPromo', { code: order.promoCode }) : t('discount')}</dt>
              <dd className="tabular-nums">−{formatPrice(order.discount, locale)}</dd>
            </div>
          ) : null}
          {order.type === 'delivery' ? (
            <div className="flex justify-between gap-3">
              <dt>{t('deliveryFee')}</dt>
              <dd className="tabular-nums">{order.deliveryFee.amount === 0 ? t('free') : formatPrice(order.deliveryFee, locale)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3 text-base font-bold text-earth-900">
            <dt>{t('total')}</dt>
            <dd className="tabular-nums">{formatPrice(order.total, locale)}</dd>
          </div>
          {order.payment.certificateAmount.amount > 0 ? (
            <div className="flex justify-between gap-3 text-steppe-700">
              <dt>{t('certificatePaid')}</dt>
              <dd className="tabular-nums">−{formatPrice(order.payment.certificateAmount, locale)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            <dt>{order.payment.method === 'online' ? t('paidOnline') : t('payOnReceipt')}</dt>
            <dd className="tabular-nums">{formatPrice(order.payment.amountDue, locale)}</dd>
          </div>
        </dl>

        <div className="space-y-2 border-t border-earth-100 pt-3 text-sm">
          {order.delivery ? (
            <p className="flex gap-2 text-earth-800">
              <MapPinIcon size={18} className="mt-0.5 shrink-0 text-earth-400" />
              <span>
                {order.delivery.addressText}
                {order.delivery.apartment ? `, ${t('apartment', { value: order.delivery.apartment })}` : ''}
                {order.delivery.contactless ? <span className="block text-xs text-muted">{t('contactless')}</span> : null}
              </span>
            </p>
          ) : (
            <p className="flex gap-2 text-earth-800">
              <MapPinIcon size={18} className="mt-0.5 shrink-0 text-earth-400" />
              <span>
                {t('pickupAt', { branch: order.branch.name })}
                <span className="block text-xs text-muted">{order.branch.address}</span>
              </span>
            </p>
          )}
          <a href={telHref(order.branch.phone)} className={buttonClasses('outline', 'sm', 'w-full')}>
            <PhoneIcon size={18} />
            {t('callBranch', { phone: formatPhone(order.branch.phone) })}
          </a>
          <Link href={routes.menu()} className={buttonClasses('ghost', 'sm', 'w-full')}>
            {t('toMenu')}
          </Link>
        </div>
      </aside>
    </div>
  );
}
