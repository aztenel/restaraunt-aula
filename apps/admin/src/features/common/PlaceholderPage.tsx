/**
 * Страница раздела, модуль которого ещё разрабатывается: заголовок, описание и список
 * ожидаемых эндпоинтов. Охрана прав — в роутере (src/app/router.tsx). При реализации раздела
 * файл src/features/<section>/<Section>Page.tsx заменяется полноценной страницей.
 */
import { useTranslation } from 'react-i18next';
import type { SectionKey } from '@/app/navigation';
import { PageHeader } from '@/shared/ui/PageHeader';
import { SectionPlaceholder, type ExpectedEndpoint } from '@/shared/ui/SectionPlaceholder';

export function PlaceholderPage({ section, endpoints }: { section: SectionKey; endpoints: ExpectedEndpoint[] }) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t(`nav.${section}`)} subtitle={t(`sections.${section}`)} />
      <SectionPlaceholder endpoints={endpoints} />
    </>
  );
}
