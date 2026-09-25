import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { CertificateOrderStatus } from '@/components/certificates/CertificateOrderStatus';
import { ClientMessages } from '@/components/i18n/ClientMessages';
import { Container } from '@/components/ui/Container';
import { PageHeading } from '@/components/ui/PageHeading';
import { getCertificateOrder } from '@/lib/content';
import { CERTIFICATE_CLIENT_NAMESPACES } from '@/lib/messages';
import { resolveLocale } from '@/lib/page';
import { isPublicToken } from '@/lib/payment-return';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

type Params = Promise<{ locale: string; token: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { token } = await params;
  const t = await getTranslations({ locale, namespace: 'CertificateOrder' });
  return buildMetadata({ locale, path: routes.certificateOrder(token), title: t('title'), description: t('metaDescription'), noindex: true });
}

/**
 * Статус покупки сертификата по токену (без кэша). Полный код витрина не показывает —
 * он приходит получателю в PDF/сообщении. ?pay=1 — сразу после оформления: перейти на оплату,
 * как только ссылка будет готова.
 */
export default async function CertificateOrderPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const locale = await resolveLocale(params);
  const { token } = await params;
  if (!isPublicToken(token)) notFound();
  const [order, query, t] = await Promise.all([getCertificateOrder(locale, token), searchParams, getTranslations('CertificateOrder')]);
  if (!order) notFound();
  return (
    <Container>
      <PageHeading title={t('title')} />
      <ClientMessages namespaces={CERTIFICATE_CLIENT_NAMESPACES}>
        <CertificateOrderStatus token={token} initial={order} autoPay={query.pay === '1'} />
      </ClientMessages>
    </Container>
  );
}
