'use client';

import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Quote } from '@/lib/api-types';
import { formatPrice } from '@/lib/format';

/**
 * Сводка заказа на каждом шаге оформления — ТОЛЬКО из расчёта сервера (POST /public/orders/quote):
 * позиции, блюда, скидка, доставка, итог, списание сертификатом и сумма к оплате.
 */
export function QuoteSummary({ quote, pending, type, showLines = true }: { quote: Quote | null; pending: boolean; type: 'pickup' | 'delivery'; showLines?: boolean }) {
  const t = useTranslations('Checkout.summary');
  const locale = useLocale();
  if (!quote) {
    return pending ? (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-7 w-full" />
      </div>
    ) : (
      <p className="text-sm text-muted">{t('unavailable')}</p>
    );
  }
  const delivery = quote.delivery;
  const certificate = quote.certificate?.applied ? quote.certificate : null;
  return (
    <div aria-busy={pending} aria-live="polite" className={clsx('transition-opacity', pending && 'opacity-60')}>
      {showLines ? (
        <ul className="mb-3 space-y-1.5 border-b border-earth-100 pb-3 text-sm">
          {quote.lines.map((line) => (
            <li key={line.index} className="flex justify-between gap-3">
              <span className={clsx('min-w-0', !line.available && 'text-terracotta-600 line-through')}>
                {line.name ?? t('unknownDish')} × {line.quantity}
                {line.modifiers.length > 0 ? <span className="block text-xs text-muted">{line.modifiers.map((m) => m.name).join(', ')}</span> : null}
              </span>
              <span className="shrink-0 tabular-nums">{line.lineTotal ? formatPrice(line.lineTotal, locale) : '—'}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <dl className="space-y-1.5 text-earth-800">
        <div className="flex justify-between gap-3">
          <dt>{t('subtotal')}</dt>
          <dd className="tabular-nums">{formatPrice(quote.subtotal, locale)}</dd>
        </div>
        {quote.discount.amount > 0 ? (
          <div className="flex justify-between gap-3 text-steppe-700">
            <dt>{t('discount')}</dt>
            <dd className="tabular-nums">−{formatPrice(quote.discount, locale)}</dd>
          </div>
        ) : null}
        {type === 'delivery' ? (
          <div className="flex justify-between gap-3">
            <dt>{t('delivery')}</dt>
            <dd className="tabular-nums">
              {delivery && !delivery.pointProvided ? t('deliveryLater') : quote.deliveryFee.amount === 0 ? t('free') : formatPrice(quote.deliveryFee, locale)}
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3 border-t border-earth-100 pt-2 text-lg font-bold text-earth-900">
          <dt>{t('total')}</dt>
          <dd className="tabular-nums">{formatPrice(quote.total, locale)}</dd>
        </div>
        {certificate ? (
          <>
            <div className="flex justify-between gap-3 text-steppe-700">
              <dt>{t('certificate', { code: certificate.maskedCode ?? '' })}</dt>
              <dd className="tabular-nums">−{formatPrice(certificate.amount, locale)}</dd>
            </div>
            <div className="flex justify-between gap-3 font-bold text-earth-900">
              <dt>{t('amountDue')}</dt>
              <dd className="tabular-nums">{formatPrice(quote.amountDue, locale)}</dd>
            </div>
          </>
        ) : null}
      </dl>
      {type === 'delivery' && delivery?.pointProvided && delivery.deliverable ? (
        <ul className="mt-3 space-y-1 text-sm text-earth-700">
          {delivery.etaMinutes ? <li>{t('eta', { minutes: delivery.etaMinutes })}</li> : null}
          {delivery.minOrderAmount ? <li>{t('minOrder', { amount: formatPrice(delivery.minOrderAmount, locale) })}</li> : null}
          {!delivery.minOrderReached && delivery.minOrderShortfall.amount > 0 ? (
            <li className="font-semibold text-terracotta-600">{t('shortfall', { amount: formatPrice(delivery.minOrderShortfall, locale) })}</li>
          ) : null}
          {delivery.amountToFreeDelivery && delivery.amountToFreeDelivery.amount > 0 ? (
            <li>{t('toFreeDelivery', { amount: formatPrice(delivery.amountToFreeDelivery, locale) })}</li>
          ) : null}
        </ul>
      ) : null}
      {pending ? <p className="mt-1 text-xs text-muted">{t('calculating')}</p> : null}
    </div>
  );
}
