import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { translate } from '@aula/api-client';
import { CheckoutFlow } from '@/components/checkout/CheckoutFlow';
import type { CheckoutBranch } from '@/components/checkout/CheckoutScreens';
import { ClientMessages } from '@/components/i18n/ClientMessages';
import { Container } from '@/components/ui/Container';
import { Notice } from '@/components/ui/Notice';
import { PageHeading } from '@/components/ui/PageHeading';
import type { PaymentMethod } from '@/lib/checkout';
import { getPublicBranches } from '@/lib/data';
import { CHECKOUT_CLIENT_NAMESPACES } from '@/lib/messages';
import { resolveLocale, type LocaleParams } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'Checkout' });
  return buildMetadata({ locale, path: routes.checkout(), title: t('title'), description: t('metaDescription'), noindex: true });
}

const PAYMENT_METHODS: readonly PaymentMethod[] = ['online', 'on_receipt'];

/**
 * Оформление заказа — экраны 2 и 3 из 4 (корзина → данные → оплата → статус). Филиалы (способы
 * получения и оплаты) — с сервера; всё остальное (адрес → филиал и зона, время, суммы) — клиентские
 * запросы к API на каждом шаге.
 */
export default async function CheckoutPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const [t, common, result] = await Promise.all([getTranslations('Checkout'), getTranslations('Common'), getPublicBranches(locale)]);
  const branches: CheckoutBranch[] = (result.ok ? result.branches : [])
    .filter((b) => b.acceptsDelivery || b.acceptsPickup)
    .map((b) => ({
      id: b.id,
      slug: b.slug,
      name: translate(b.name, locale),
      address: translate(b.address, locale),
      phone: b.phone,
      acceptsDelivery: b.acceptsDelivery,
      acceptsPickup: b.acceptsPickup,
      paymentMethods: PAYMENT_METHODS.filter((m) => (b.paymentMethods as readonly string[]).includes(m)),
    }));
  return (
    <Container>
      <PageHeading title={t('title')} />
      {result.ok ? (
        <ClientMessages namespaces={CHECKOUT_CLIENT_NAMESPACES}>
          <CheckoutFlow branches={branches} />
        </ClientMessages>
      ) : (
        <Notice tone="warning">{common('apiUnavailable')}</Notice>
      )}
    </Container>
  );
}
