import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { PlaceholderPage } from '@/components/placeholders/PlaceholderPage';
import { getPublicBranches } from '@/lib/data';
import { resolveLocale, type LocaleParams } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

/*
 * TODO(banquet): заявка на банкет/кейтеринг (главный источник окупаемости — форма максимально короткая).
 *   POST /api/v1/public/banquet-requests { branchId | null (выезд), isOffsite, address?, eventDate, eventType,
 *     guests, budget?: Money, name, phone, email?, wishes?, consent } → { number, managerName?, publicToken }
 *   Справочник типов мероприятий: GET /api/v1/public/banquet-event-types?locale= (или enum в OpenAPI).
 *   После успеха — reachGoal(Goals.BanquetRequest) и экран «менеджер свяжется в течение 30 минут».
 */
export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'Banquets' });
  return buildMetadata({ locale, path: routes.banquets(), title: t('metaTitle'), description: t('metaDescription') });
}

export default async function BanquetsPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const t = await getTranslations('Banquets');
  const result = await getPublicBranches(locale);
  return (
    <PlaceholderPage
      locale={locale}
      title={t('title')}
      subtitle={t('subtitle')}
      placeholderTitle={t('placeholderTitle')}
      placeholderText={t('placeholderText')}
      contacts={result.ok ? { branches: result.branches, whatsappText: t('whatsappText') } : undefined}
    />
  );
}
