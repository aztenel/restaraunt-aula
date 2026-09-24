import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CartView } from '@/components/cart/CartView';
import { Container } from '@/components/ui/Container';
import { PageHeading } from '@/components/ui/PageHeading';
import { resolveLocale, type LocaleParams } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'Cart' });
  return buildMetadata({ locale, path: routes.cart(), title: t('title'), description: t('metaDescription'), noindex: true });
}

export default async function CartPage({ params }: { params: LocaleParams }) {
  await resolveLocale(params);
  const t = await getTranslations('Cart');
  return (
    <Container>
      <PageHeading title={t('title')} />
      <CartView />
    </Container>
  );
}
