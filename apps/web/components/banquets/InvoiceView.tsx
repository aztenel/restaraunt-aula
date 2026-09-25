'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { call, toApiError } from '@aula/api-client';
import { FormError } from '@/components/forms/FormField';
import { buttonClasses } from '@/components/ui/button';
import { CheckIcon, FileIcon } from '@/components/ui/icons';
import { getBrowserApi } from '@/lib/api';
import { apiErrorKey } from '@/lib/api-errors';
import type { BanquetInvoice } from '@/lib/api-types';
import { formatBasisPoints, invoicePaymentRedirect, invoicePhase, invoicePollDelay } from '@/lib/banquets';
import { formatLocalDate, formatPrice } from '@/lib/format';
import { isSafePaymentUrl, redirectFlagKey, storageFlag } from '@/lib/payment-flow';

/**
 * Счёт по банкету по ссылке: физлицо — «Оплатить» (POST /pay обновляет ссылку на оплату, затем
 * переход на неё, как только она готова); юрлицо — PDF счёта и реквизиты для банковского перевода.
 * Оплату подтверждает сервер (опрос после возврата с оплаты).
 */
export function InvoiceView({ token, initial }: { token: string; initial: BanquetInvoice }) {
  const t = useTranslations('BanquetInvoice');
  const apiErrors = useTranslations('ApiErrors');
  const locale = useLocale();
  const [invoice, setInvoice] = useState(initial);
  const [payNow, setPayNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phase = invoicePhase(invoice);

  const refresh = useCallback(async () => {
    try {
      setInvoice(await call(getBrowserApi(locale).GET('/api/v1/public/banquets/invoices/{token}', { params: { path: { token } } })));
    } catch {
      // Повторим при следующем опросе.
    }
  }, [locale, token]);

  useEffect(() => {
    const delay = invoicePollDelay(invoice, { awaitingLink: payNow });
    if (delay === null) return;
    const timer = window.setTimeout(() => {
      if (!document.hidden) void refresh();
      else setInvoice((i) => ({ ...i }));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [invoice, payNow, refresh]);

  useEffect(() => {
    const flag = redirectFlagKey('banquet_invoice', token, invoice.paymentUrl);
    const url = invoicePaymentRedirect(invoice, { payNow, alreadyRedirected: storageFlag('session', flag) });
    if (!url) return;
    storageFlag('session', flag, true);
    window.location.assign(url);
  }, [invoice, payNow, token]);

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await call(getBrowserApi(locale).POST('/api/v1/public/banquets/invoices/{token}/pay', { params: { path: { token } } }));
      setInvoice(data);
      setPayNow(true);
    } catch (e) {
      const apiError = toApiError(e);
      setError(apiError.code === 'banquet_invoice.not_payable' ? t('notPayable') : apiErrors(apiErrorKey(apiError, (k) => apiErrors.has(k))));
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const waitingForLink = payNow && !isSafePaymentUrl(invoice.paymentUrl);
  const processing = invoice.paymentStatus === 'succeeded' && phase !== 'paid';

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <section aria-live="polite" className="rounded-card border border-earth-100 bg-cream-50 p-6 shadow-card">
          <p className="text-sm text-muted">{t('number', { number: invoice.number, request: invoice.requestNumber })}</p>
          <h2 className="mt-1 text-2xl font-semibold text-earth-900">{t(`status.${invoice.status}`)}</h2>
          <p className="mt-2 text-earth-800">{invoice.description}</p>
          {phase !== 'paid' && phase !== 'cancelled' ? (
            <p className={invoice.overdue ? 'mt-2 font-semibold text-terracotta-600' : 'mt-2 text-sm text-earth-800'}>
              {invoice.overdue ? t('overdue', { date: formatLocalDate(invoice.dueDate, locale) }) : t('dueDate', { date: formatLocalDate(invoice.dueDate, locale) })}
            </p>
          ) : null}

          {phase === 'paid' ? (
            <p className="mt-3 flex items-center gap-2 font-semibold text-steppe-700">
              <CheckIcon size={20} />
              {t('paidText')}
            </p>
          ) : null}

          {phase === 'payment_ready' || phase === 'payment_needed' ? (
            <div className="mt-4 space-y-2">
              {processing ? <p className="text-earth-800">{t('processing')}</p> : null}
              {invoice.paymentStatus === 'failed' || invoice.paymentStatus === 'cancelled' ? <p className="text-earth-800">{t('paymentFailed')}</p> : null}
              <button type="button" onClick={() => void pay()} disabled={busy || waitingForLink || processing} className={buttonClasses('primary', 'lg', 'w-full sm:w-auto')}>
                {busy || waitingForLink ? t('preparing') : t('pay', { amount: formatPrice(invoice.remaining, locale) })}
              </button>
            </div>
          ) : null}

          {phase === 'company' ? <p className="mt-3 text-earth-800">{t('companyText')}</p> : null}
          {phase === 'cancelled' ? <p className="mt-3 text-earth-800">{t('cancelledText')}</p> : null}
        </section>

        {error ? <FormError>{error}</FormError> : null}

        {phase === 'company' && invoice.seller ? (
          <section aria-labelledby="invoice-seller" className="rounded-card border border-earth-100 bg-cream-50 p-6">
            <h2 id="invoice-seller" className="text-lg font-semibold text-earth-900">
              {t('seller')}
            </h2>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              {(
                [
                  ['sellerName', invoice.seller.name],
                  ['bin', invoice.seller.bin],
                  ['iban', invoice.seller.iban],
                  ['bik', invoice.seller.bik],
                  ['bank', invoice.seller.bankName],
                  ['kbe', invoice.seller.kbe],
                ] as const
              ).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-muted">{t(`requisites.${key}`)}</dt>
                  <dd className="break-all font-semibold text-earth-900">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
      </div>

      <aside className="h-fit space-y-4 rounded-card border border-earth-100 bg-cream-50 p-5 shadow-card">
        <dl className="space-y-1.5 text-sm text-earth-800">
          <div className="flex justify-between gap-3 text-base font-bold text-earth-900">
            <dt>{t('amount')}</dt>
            <dd className="tabular-nums">{formatPrice(invoice.amount, locale)}</dd>
          </div>
          {invoice.vatRateBp > 0 ? (
            <div className="flex justify-between gap-3 text-muted">
              <dt>{t('vat', { rate: formatBasisPoints(invoice.vatRateBp, locale) })}</dt>
              <dd className="tabular-nums">{formatPrice(invoice.vat, locale)}</dd>
            </div>
          ) : (
            <p className="text-xs text-muted">{t('vatNone')}</p>
          )}
          <div className="flex justify-between gap-3">
            <dt>{t('paid')}</dt>
            <dd className="tabular-nums">{formatPrice(invoice.paid, locale)}</dd>
          </div>
          <div className="flex justify-between gap-3 font-semibold text-earth-900">
            <dt>{t('remaining')}</dt>
            <dd className="tabular-nums">{formatPrice(invoice.remaining, locale)}</dd>
          </div>
        </dl>
        {isSafePaymentUrl(invoice.pdfUrl) ? (
          <a href={invoice.pdfUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses('outline', 'sm', 'w-full')}>
            <FileIcon size={18} />
            {t('pdf')}
          </a>
        ) : null}
      </aside>
    </div>
  );
}
