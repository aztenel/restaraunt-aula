import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import type { PublicBranch } from '@aula/api-client';
import type { AppLocale } from '@/i18n/routing';
import { BranchContactList } from '@/components/branches/BranchContactList';
import { Container } from '@/components/ui/Container';
import { PageHeading } from '@/components/ui/PageHeading';
import { FeaturePlaceholder } from './FeaturePlaceholder';

/**
 * Страница раздела, API которого подключается: заголовок, понятный гостю текст и (опционально)
 * контакты филиалов как запасной канал. Конкретный TODO с эндпоинтами — в файле страницы.
 */
export async function PlaceholderPage({
  locale,
  title,
  subtitle,
  placeholderTitle,
  placeholderText,
  contacts,
  children,
}: {
  locale: AppLocale;
  title: string;
  subtitle?: string;
  placeholderTitle: string;
  placeholderText: string;
  contacts?: { branches: PublicBranch[]; whatsappText?: string };
  children?: ReactNode;
}) {
  const common = await getTranslations('Common');
  return (
    <Container>
      <PageHeading title={title} subtitle={subtitle} />
      {children}
      <FeaturePlaceholder badge={common('comingSoon')} title={placeholderTitle} text={placeholderText}>
        {contacts && contacts.branches.length > 0 ? (
          <BranchContactList branches={contacts.branches} locale={locale} whatsappText={contacts.whatsappText} />
        ) : null}
      </FeaturePlaceholder>
    </Container>
  );
}
