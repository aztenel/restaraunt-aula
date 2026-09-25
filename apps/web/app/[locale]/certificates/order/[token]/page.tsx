import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlaceholderPage } from '@/components/placeholders/PlaceholderPage';
import { resolveLocale } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

type Params = Promise<{ locale: string; token: string }>;

/*
 * TODO(payments): статус покупки сертификата.
 *   GET /api/v1/public/certificates/orders/{token}?locale= → статус оплаты/выпуска, продукт, цена (Money),
 *     ссылка на оплату при необходимости | 404
 *   Полный код сертификата витрина НЕ показывает: он приходит один раз в PDF/сообщении получателю.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { token } = await params;
  const t = await getTranslations({ locale, namespace: 'CertificateOrder' });
  return buildMetadata({ locale, path: routes.certificateOrder(token), title: t('title'), description: t('placeholderText'), noindex: true });
}

export default async function CertificateOrderPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const t = await getTranslations('CertificateOrder');
  return <PlaceholderPage locale={locale} title={t('title')} placeholderTitle={t('placeholderTitle')} placeholderText={t('placeholderText')} />;
}
