import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CheckoutSteps } from '@/components/placeholders/CheckoutSteps';
import { PlaceholderPage } from '@/components/placeholders/PlaceholderPage';
import { resolveLocale } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

type Params = Promise<{ locale: string; token: string }>;

/*
 * TODO(ordering): статус заказа по публичному токену (ссылка из WhatsApp/SMS).
 *   GET /api/v1/public/orders/{token}?locale= → { number, status, type, branch, items, subtotal, discount,
 *     deliveryFee, total: Money, payment: { status, paymentUrl? }, eta?, timeline: [...] } | 404
 *   Данные без кэша: createServerApi({ locale, revalidate: false }); обновление статуса — опрос каждые
 *   10–15 с на клиенте (getBrowserApi) до конечного статуса. Статус «ожидает оплаты» — кнопка оплаты.
 *   После перехода в paid — reachGoal(Goals.Purchase, analyticsValue(total)) один раз (флаг в sessionStorage).
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { token } = await params;
  const t = await getTranslations({ locale, namespace: 'Order' });
  return buildMetadata({ locale, path: routes.order(token), title: t('title'), description: t('placeholderText'), noindex: true });
}

export default async function OrderStatusPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const t = await getTranslations('Order');
  return (
    <PlaceholderPage locale={locale} title={t('title')} placeholderTitle={t('placeholderTitle')} placeholderText={t('placeholderText')}>
      <CheckoutSteps current="status" />
    </PlaceholderPage>
  );
}
