import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlaceholderPage } from '@/components/placeholders/PlaceholderPage';
import { getPublicBranches } from '@/lib/data';
import { resolveLocale, type LocaleParams } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

/*
 * TODO(payments): продажа подарочных сертификатов (эндпоинты реализованы в модуле Payments).
 *   Продукты: GET /api/v1/public/certificates/products?locale= (на сумму / на набор, номинал и цена — Money)
 *   Покупка: POST /api/v1/public/certificates/purchase (покупатель, получатель, пожелание, способ отправки,
 *     согласие на обработку ПД) → токен заказа и ссылка на оплату
 *   → оплата → /certificates/order/{publicToken}; reachGoal(Goals.CertificatePurchase, analyticsValue(price)).
 */
export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'Certificates' });
  return buildMetadata({ locale, path: routes.certificates(), title: t('metaTitle'), description: t('metaDescription') });
}

export default async function CertificatesPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const t = await getTranslations('Certificates');
  const result = await getPublicBranches(locale);
  return (
    <PlaceholderPage
      locale={locale}
      title={t('title')}
      subtitle={t('subtitle')}
      placeholderTitle={t('placeholderTitle')}
      placeholderText={t('placeholderText')}
      contacts={result.ok ? { branches: result.branches, whatsappText: t('whatsappText') } : undefined}
    />
  );
}
