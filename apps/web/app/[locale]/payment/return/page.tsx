import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { BranchContactList } from '@/components/branches/BranchContactList';
import { Container } from '@/components/ui/Container';
import { Notice } from '@/components/ui/Notice';
import { PageHeading } from '@/components/ui/PageHeading';
import { getPublicBranches } from '@/lib/data';
import { resolveLocale, type LocaleParams } from '@/lib/page';
import { paymentReturnPath } from '@/lib/payment-return';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'Payment' });
  return buildMetadata({ locale, path: routes.paymentReturn(), title: t('title'), description: t('metaDescription'), noindex: true });
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Общая страница возврата с оплаты: /[locale]/payment/return?type=order|certificate|booking|banquet_invoice&token=…
 * Параметры ничего не подтверждают — только выбирают страницу статуса (заказ, сертификат, бронь,
 * счёт банкета), которая сама спросит сервер о платеже. Нераспознанные параметры — подсказка и контакты.
 */
export default async function PaymentReturnPage({ params, searchParams }: { params: LocaleParams; searchParams: SearchParams }) {
  const locale = await resolveLocale(params);
  const query = await searchParams;
  const target = paymentReturnPath(first(query.type) ?? first(query.purpose), first(query.token));
  if (target) redirect({ href: target, locale });

  const [t, branches] = await Promise.all([getTranslations('Payment'), getPublicBranches(locale)]);
  return (
    <Container>
      <PageHeading title={t('title')} />
      <Notice tone="warning" title={t('unknownTitle')}>
        {t('unknownText')}
      </Notice>
      {branches.ok ? (
        <div className="mt-6">
          <BranchContactList branches={branches.branches} locale={locale} />
        </div>
      ) : null}
    </Container>
  );
}
