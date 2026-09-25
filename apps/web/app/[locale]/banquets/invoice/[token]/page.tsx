import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { InvoiceView } from '@/components/banquets/InvoiceView';
import { ClientMessages } from '@/components/i18n/ClientMessages';
import { Container } from '@/components/ui/Container';
import { PageHeading } from '@/components/ui/PageHeading';
import { BANQUET_CLIENT_NAMESPACES } from '@/lib/messages';
import { resolveLocale } from '@/lib/page';
import { isPublicToken } from '@/lib/payment-return';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';
import { getBanquetInvoice } from '@/lib/transactions';

type Params = Promise<{ locale: string; token: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { token } = await params;
  const t = await getTranslations({ locale, namespace: 'BanquetInvoice' });
  return buildMetadata({ locale, path: routes.banquetInvoice(token), title: t('title'), description: t('metaDescription'), noindex: true });
}

/** Счёт на предоплату/оплату банкета по ссылке менеджера (без кэша) — также страница возврата с оплаты. */
export default async function BanquetInvoicePage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { token } = await params;
  if (!isPublicToken(token)) notFound();
  const [invoice, t] = await Promise.all([getBanquetInvoice(locale, token), getTranslations('BanquetInvoice')]);
  if (!invoice) notFound();
  return (
    <Container>
      <PageHeading title={t('title')} />
      <ClientMessages namespaces={BANQUET_CLIENT_NAMESPACES}>
        <InvoiceView token={token} initial={invoice} />
      </ClientMessages>
    </Container>
  );
}
