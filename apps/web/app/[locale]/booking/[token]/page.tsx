import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlaceholderPage } from '@/components/placeholders/PlaceholderPage';
import { resolveLocale } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

type Params = Promise<{ locale: string; token: string }>;

/*
 * TODO(reservation): бронь гостя по публичному токену (ссылка из подтверждения).
 *   GET /api/v1/public/reservations/{token}?locale= → { number, status, branch, venue, start, end, guests,
 *     deposit: Money | null, depositStatus, paymentUrl?, holdUntil?, cancellation: { allowed, freeUntil,
 *     depositOutcome } } | 404
 *   Отмена: POST /api/v1/public/reservations/{token}/cancel — последствия для депозита показывает сервер.
 *   Без кэша (revalidate: false).
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { token } = await params;
  const t = await getTranslations({ locale, namespace: 'BookingStatus' });
  return buildMetadata({ locale, path: routes.bookingStatus(token), title: t('title'), description: t('placeholderText'), noindex: true });
}

export default async function BookingStatusPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const t = await getTranslations('BookingStatus');
  return <PlaceholderPage locale={locale} title={t('title')} placeholderTitle={t('placeholderTitle')} placeholderText={t('placeholderText')} />;
}
