import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { StepIndicator } from '@/components/checkout/StepIndicator';
import { ClientMessages } from '@/components/i18n/ClientMessages';
import { OrderStatusView } from '@/components/orders/OrderStatusView';
import { Container } from '@/components/ui/Container';
import { PageHeading } from '@/components/ui/PageHeading';
import { ORDER_CLIENT_NAMESPACES } from '@/lib/messages';
import { resolveLocale } from '@/lib/page';
import { isPublicToken } from '@/lib/payment-return';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';
import { getOrderTracking } from '@/lib/transactions';

type Params = Promise<{ locale: string; token: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { token } = await params;
  const t = await getTranslations({ locale, namespace: 'Order' });
  return buildMetadata({ locale, path: routes.order(token), title: t('title'), description: t('metaDescription'), noindex: true });
}

/**
 * Статус заказа по публичному токену (ссылка из WhatsApp/SMS и возврат с оплаты) — без кэша.
 * ?pay=1 — сразу после оформления с онлайн-оплатой: перейти на оплату, как только ссылка будет готова.
 */
export default async function OrderStatusPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const locale = await resolveLocale(params);
  const { token } = await params;
  if (!isPublicToken(token)) notFound();
  const [order, query, t] = await Promise.all([getOrderTracking(locale, token), searchParams, getTranslations('Order')]);
  if (!order) notFound();
  return (
    <Container>
      <PageHeading title={t('title')} />
      <ClientMessages namespaces={ORDER_CLIENT_NAMESPACES}>
        <StepIndicator current="status" />
        <OrderStatusView token={token} initial={order} autoPay={query.pay === '1'} />
      </ClientMessages>
    </Container>
  );
}
