import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlaceholderPage } from '@/components/placeholders/PlaceholderPage';
import { resolveLocale, type LocaleParams } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

/*
 * TODO(payments): возврат гостя со страницы платёжного провайдера (returnUrl платежа).
 *   Подтверждение оплаты — ТОЛЬКО по колбэку/опросу на сервере, не по параметрам URL.
 *   GET /api/v1/public/payments/{paymentId}/status (или по ?ref=) → { status, purpose: 'order' |
 *     'reservation_deposit' | 'banquet_invoice' | 'gift_certificate', publicToken }
 *   Опрашивать до конечного статуса и перенаправлять: order → /orders/{token}, reservation_deposit →
 *   /booking/{token}, banquet_invoice → /banquets/invoice/{token}, gift_certificate → /certificates/order/{token}.
 */
export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'Payment' });
  return buildMetadata({ locale, path: routes.paymentReturn(), title: t('title'), description: t('placeholderText'), noindex: true });
}

export default async function PaymentReturnPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const t = await getTranslations('Payment');
  return <PlaceholderPage locale={locale} title={t('title')} placeholderTitle={t('placeholderTitle')} placeholderText={t('placeholderText')} />;
}
