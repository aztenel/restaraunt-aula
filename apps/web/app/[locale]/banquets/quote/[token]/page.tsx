import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { QuoteAccept } from '@/components/banquets/QuoteAccept';
import { ClientMessages } from '@/components/i18n/ClientMessages';
import { buttonClasses } from '@/components/ui/button';
import { FileIcon, PhoneIcon } from '@/components/ui/icons';
import { Container } from '@/components/ui/Container';
import { PageHeading } from '@/components/ui/PageHeading';
import type { BanquetQuoteLine } from '@/lib/api-types';
import { formatBasisPoints } from '@/lib/banquets';
import { formatLocalDate, formatPhone, formatPrice, telHref } from '@/lib/format';
import { BANQUET_CLIENT_NAMESPACES } from '@/lib/messages';
import { resolveLocale } from '@/lib/page';
import { isSafePaymentUrl } from '@/lib/payment-flow';
import { isPublicToken } from '@/lib/payment-return';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';
import { getBanquetQuote } from '@/lib/transactions';

type Params = Promise<{ locale: string; token: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { token } = await params;
  const t = await getTranslations({ locale, namespace: 'BanquetQuote' });
  return buildMetadata({ locale, path: routes.banquetQuote(token), title: t('title'), description: t('metaDescription'), noindex: true });
}

/**
 * Смета банкета по ссылке менеджера (без кэша): позиции, скидки, обслуживание, НДС, итог и сумма
 * на гостя — всё посчитано сервером; PDF; согласование показанной версии.
 */
export default async function BanquetQuotePage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { token } = await params;
  if (!isPublicToken(token)) notFound();
  const [quote, t] = await Promise.all([getBanquetQuote(locale, token), getTranslations('BanquetQuote')]);
  if (!quote) notFound();

  const discountText = (line: BanquetQuoteLine) => {
    const d = line.discount;
    if (!d) return null;
    if (d.type === 'percent' && d.bp !== null && d.bp !== undefined) return t('linePercent', { value: formatBasisPoints(d.bp, locale) });
    if (d.amount) return t('lineAmount', { amount: formatPrice(d.amount, locale) });
    return null;
  };

  return (
    <Container>
      <PageHeading title={t('heading', { number: quote.requestNumber })} subtitle={`${quote.eventTypeLabel} · ${quote.statusLabel}`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <dl className="grid gap-3 rounded-card border border-earth-100 bg-cream-50 p-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">{t('date')}</dt>
              <dd className="font-semibold text-earth-900">
                {formatLocalDate(quote.eventDate, locale)}
                {quote.eventTime ? `, ${quote.eventTime}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-muted">{t('guests')}</dt>
              <dd className="font-semibold text-earth-900">{quote.guests}</dd>
            </div>
            <div>
              <dt className="text-muted">{t('place')}</dt>
              <dd className="font-semibold text-earth-900">{quote.place}</dd>
            </div>
            <div>
              <dt className="text-muted">{t('version')}</dt>
              <dd className="font-semibold text-earth-900">
                {t('versionValue', { version: quote.version })}
                {quote.validUntil ? <span className="block font-normal text-muted">{t('validUntil', { date: formatLocalDate(quote.validUntil, locale) })}</span> : null}
              </dd>
            </div>
          </dl>

          <section aria-labelledby="quote-lines" className="rounded-card border border-earth-100 bg-cream-50 p-5">
            <h2 id="quote-lines" className="text-lg font-semibold text-earth-900">
              {t('lines')}
            </h2>
            <ul className="mt-3 divide-y divide-earth-100">
              {quote.lines.map((line, index) => (
                <li key={`${line.title}-${index}`} className="flex justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-earth-900">{line.title}</p>
                    <p className="text-muted">
                      {line.quantity} {line.unit} × {formatPrice(line.unitPrice, locale)}
                      {discountText(line) ? <span className="ml-2 text-steppe-700">{discountText(line)}</span> : null}
                    </p>
                  </div>
                  <p className="shrink-0 font-semibold tabular-nums text-earth-900">{formatPrice(line.total, locale)}</p>
                </li>
              ))}
            </ul>
          </section>

          {quote.notes ? (
            <section aria-labelledby="quote-notes" className="rounded-card border border-earth-100 bg-cream-50 p-5">
              <h2 id="quote-notes" className="text-lg font-semibold text-earth-900">
                {t('notes')}
              </h2>
              <p className="mt-2 whitespace-pre-line text-earth-800">{quote.notes}</p>
            </section>
          ) : null}
        </div>

        <aside className="h-fit space-y-4 rounded-card border border-earth-100 bg-cream-50 p-5 shadow-card lg:sticky lg:top-24">
          <dl className="space-y-1.5 text-sm text-earth-800">
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
            {quote.serviceChargeBp > 0 ? (
              <div className="flex justify-between gap-3">
                <dt>{t('service', { percent: formatBasisPoints(quote.serviceChargeBp, locale) })}</dt>
                <dd className="tabular-nums">{formatPrice(quote.service, locale)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3 border-t border-earth-100 pt-2 text-base font-bold text-earth-900">
              <dt>{t('total')}</dt>
              <dd className="tabular-nums">{formatPrice(quote.total, locale)}</dd>
            </div>
            <div className="flex justify-between gap-3 text-muted">
              <dt>{t('perGuest')}</dt>
              <dd className="tabular-nums">{formatPrice(quote.perGuest, locale)}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted">
            {quote.vatPayer ? t('vatIncluded', { rate: formatBasisPoints(quote.vatRateBp, locale), amount: formatPrice(quote.vat, locale) }) : t('vatNone')}
          </p>
          <ClientMessages namespaces={BANQUET_CLIENT_NAMESPACES}>
            <QuoteAccept token={token} version={quote.version} canAccept={quote.canAccept} accepted={quote.accepted} />
          </ClientMessages>
          {isSafePaymentUrl(quote.pdfUrl) ? (
            <a href={quote.pdfUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses('outline', 'sm', 'w-full')}>
              <FileIcon size={18} />
              {t('pdf')}
            </a>
          ) : null}
          <div className="border-t border-earth-100 pt-3 text-sm">
            <p className="text-muted">{t('manager')}</p>
            <p className="font-semibold text-earth-900">{quote.manager.name}</p>
            {quote.manager.phone ? (
              <a href={telHref(quote.manager.phone)} className={buttonClasses('ghost', 'sm', 'mt-1 -ml-4')}>
                <PhoneIcon size={18} />
                {formatPhone(quote.manager.phone)}
              </a>
            ) : null}
          </div>
        </aside>
      </div>
    </Container>
  );
}
