import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlaceholderPage } from '@/components/placeholders/PlaceholderPage';
import { resolveLocale } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

type Params = Promise<{ locale: string; token: string }>;

/*
 * TODO(banquet/payments): счёт на предоплату банкета по ссылке.
 *   GET /api/v1/public/banquet-invoices/{token}?locale= → { number, payerType, amount, paid, remaining: Money,
 *     dueDate, status, pdfUrl, paymentUrl? } | 404
 *   Оплата физлицом онлайн: POST /api/v1/public/banquet-invoices/{token}/pay → { paymentUrl } (редирект).
 *   Юрлицу — PDF счёта с реквизитами (оплата переводом, регистрирует финансист).
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { token } = await params;
  const t = await getTranslations({ locale, namespace: 'BanquetInvoice' });
  return buildMetadata({ locale, path: routes.banquetInvoice(token), title: t('title'), description: t('placeholderText'), noindex: true });
}

export default async function BanquetInvoicePage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const t = await getTranslations('BanquetInvoice');
  return <PlaceholderPage locale={locale} title={t('title')} placeholderTitle={t('placeholderTitle')} placeholderText={t('placeholderText')} />;
}
