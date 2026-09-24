import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlaceholderPage } from '@/components/placeholders/PlaceholderPage';
import { resolveLocale } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

type Params = Promise<{ locale: string; token: string }>;

/*
 * TODO(banquet): смета по ссылке для клиента.
 *   GET /api/v1/public/banquet-quotes/{token}?locale= → { requestNumber, version, status, items: [{ name, quantity,
 *     unitPrice, discount, total: Money }], discount, serviceCharge, vat, total: Money, pdfUrl, canAgree } | 404
 *   Согласование: POST /api/v1/public/banquet-quotes/{token}/agree (→ заявка agreed). Все суммы — от сервера.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { token } = await params;
  const t = await getTranslations({ locale, namespace: 'BanquetQuote' });
  return buildMetadata({ locale, path: routes.banquetQuote(token), title: t('title'), description: t('placeholderText'), noindex: true });
}

export default async function BanquetQuotePage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const t = await getTranslations('BanquetQuote');
  return <PlaceholderPage locale={locale} title={t('title')} placeholderTitle={t('placeholderTitle')} placeholderText={t('placeholderText')} />;
}
