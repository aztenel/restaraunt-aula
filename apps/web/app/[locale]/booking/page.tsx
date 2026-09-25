import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { translate } from '@aula/api-client';
import { BookingFlow } from '@/components/booking/BookingFlow';
import type { BookingBranch } from '@/components/booking/BookingSearchForm';
import { BranchContactList } from '@/components/branches/BranchContactList';
import { ClientMessages } from '@/components/i18n/ClientMessages';
import { Container } from '@/components/ui/Container';
import { Notice } from '@/components/ui/Notice';
import { PageHeading } from '@/components/ui/PageHeading';
import { getPublicBranches } from '@/lib/data';
import { BOOKING_CLIENT_NAMESPACES } from '@/lib/messages';
import { resolveLocale, type LocaleParams } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'Booking' });
  return buildMetadata({ locale, path: routes.booking(), title: t('metaTitle'), description: t('metaDescription') });
}

/**
 * Онлайн-бронь столов, VIP-залов и юрт (филиалы, принимающие брони). Поиск и выбор места —
 * клиентские запросы к API (свободность меняется каждую минуту); ?branch=slug — филиал по умолчанию.
 */
export default async function BookingPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const [t, common, result] = await Promise.all([getTranslations('Booking'), getTranslations('Common'), getPublicBranches(locale)]);
  const accepting = result.ok ? result.branches.filter((b) => b.acceptsReservations) : [];
  const branches: BookingBranch[] = accepting.map((b) => ({
    id: b.id,
    slug: b.slug,
    name: translate(b.name, locale),
    address: translate(b.address, locale),
    phone: b.phone,
  }));
  return (
    <Container>
      <PageHeading title={t('title')} subtitle={t('subtitle')} />
      {!result.ok ? (
        <Notice tone="warning">{common('apiUnavailable')}</Notice>
      ) : branches.length === 0 ? (
        <div className="space-y-4">
          <Notice tone="info" title={t('unavailableTitle')}>
            {t('unavailableText')}
          </Notice>
          <BranchContactList branches={result.branches} locale={locale} whatsappText={t('whatsappText')} />
        </div>
      ) : (
        <ClientMessages namespaces={BOOKING_CLIENT_NAMESPACES}>
          <BookingFlow branches={branches} />
        </ClientMessages>
      )}
    </Container>
  );
}
