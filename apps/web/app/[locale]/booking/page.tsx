import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlaceholderPage } from '@/components/placeholders/PlaceholderPage';
import { getPublicBranches } from '@/lib/data';
import { resolveLocale, type LocaleParams } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

/*
 * TODO(reservation): онлайн-бронь столов, VIP-залов и юрт.
 *   Свободные места: GET /api/v1/public/branches/{branchSlug}/availability?date=YYYY-MM-DD&time=HH:mm&guests=N
 *     → { slots: [...], venues: [{ id, name, type, capacityMin, capacityMax, deposit: Money | null, photos }] }
 *     (показываем только то, что вернул сервер — занятость проверяется транзакционно на сервере).
 *   Создание: POST /api/v1/public/reservations { branchId, venueId, date, time, guests, name, phone, comment,
 *     consent, verificationToken? } → { publicToken, status: 'pending' | 'awaiting_deposit', paymentUrl? }
 *   → /booking/{publicToken}; reachGoal(Goals.ReservationCreated).
 */
export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'Booking' });
  return buildMetadata({ locale, path: routes.booking(), title: t('metaTitle'), description: t('metaDescription') });
}

export default async function BookingPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const t = await getTranslations('Booking');
  const result = await getPublicBranches(locale);
  const branches = result.ok ? result.branches.filter((b) => b.acceptsReservations) : [];
  return (
    <PlaceholderPage
      locale={locale}
      title={t('title')}
      subtitle={t('subtitle')}
      placeholderTitle={t('placeholderTitle')}
      placeholderText={t('placeholderText')}
      contacts={{ branches, whatsappText: t('whatsappText') }}
    />
  );
}
