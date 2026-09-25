import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { translate } from '@aula/api-client';
import { CartView, type CartBranchOption } from '@/components/cart/CartView';
import { ClientMessages } from '@/components/i18n/ClientMessages';
import { Container } from '@/components/ui/Container';
import { PageHeading } from '@/components/ui/PageHeading';
import { getPublicBranches } from '@/lib/data';
import { CART_CLIENT_NAMESPACES } from '@/lib/messages';
import { resolveLocale, type LocaleParams } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'Cart' });
  return buildMetadata({ locale, path: routes.cart(), title: t('title'), description: t('metaDescription'), noindex: true });
}

/**
 * Корзина (экран 1 из 4 оформления). Состав — из localStorage, суммы — только из
 * POST /api/v1/public/orders/quote (components/cart/CartView.tsx → lib/ordering.ts).
 */
export default async function CartPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const [t, result] = await Promise.all([getTranslations('Cart'), getPublicBranches(locale)]);
  const branches: CartBranchOption[] = (result.ok ? result.branches : []).map((b) => ({
    id: b.id,
    slug: b.slug,
    name: translate(b.name, locale),
    acceptsDelivery: b.acceptsDelivery,
    acceptsPickup: b.acceptsPickup,
  }));
  return (
    <Container>
      <PageHeading title={t('title')} />
      <ClientMessages namespaces={CART_CLIENT_NAMESPACES}>
        <CartView branches={branches} />
      </ClientMessages>
    </Container>
  );
}
