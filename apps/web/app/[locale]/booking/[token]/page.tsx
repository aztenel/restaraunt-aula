import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ReservationStatusView } from '@/components/booking/ReservationStatusView';
import { ClientMessages } from '@/components/i18n/ClientMessages';
import { Container } from '@/components/ui/Container';
import { PageHeading } from '@/components/ui/PageHeading';
import { BOOKING_CLIENT_NAMESPACES } from '@/lib/messages';
import { resolveLocale } from '@/lib/page';
import { isPublicToken } from '@/lib/payment-return';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';
import { getReservation } from '@/lib/transactions';

type Params = Promise<{ locale: string; token: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { token } = await params;
  const t = await getTranslations({ locale, namespace: 'BookingStatus' });
  return buildMetadata({ locale, path: routes.bookingStatus(token), title: t('title'), description: t('metaDescription'), noindex: true });
}

/**
 * Бронь гостя по публичному токену (ссылка из подтверждения и возврат с оплаты депозита) — без кэша.
 * ?pay=1 — сразу после оформления брони с депозитом: перейти на оплату, как только ссылка будет готова.
 */
export default async function BookingStatusPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const locale = await resolveLocale(params);
  const { token } = await params;
  if (!isPublicToken(token)) notFound();
  const [reservation, query, t] = await Promise.all([getReservation(locale, token), searchParams, getTranslations('BookingStatus')]);
  if (!reservation) notFound();
  return (
    <Container>
      <PageHeading title={t('title')} />
      <ClientMessages namespaces={BOOKING_CLIENT_NAMESPACES}>
        <ReservationStatusView token={token} initial={reservation} autoPay={query.pay === '1'} />
      </ClientMessages>
    </Container>
  );
}
