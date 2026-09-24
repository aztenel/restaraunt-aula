import { getTranslations } from 'next-intl/server';
import { translate, type PublicBranch } from '@aula/api-client';
import type { AppLocale } from '@/i18n/routing';
import { BranchContactList } from '@/components/branches/BranchContactList';
import { RememberBranch } from '@/components/branches/RememberBranch';
import { Container } from '@/components/ui/Container';
import { PageHeading } from '@/components/ui/PageHeading';
import { FeaturePlaceholder } from './FeaturePlaceholder';

/** Меню филиала до подключения каталога: заголовок, филиал и контакты для заказа по телефону. */
export async function BranchMenuPlaceholder({
  branch,
  locale,
  title,
}: {
  branch: PublicBranch;
  locale: AppLocale;
  title: string;
}) {
  const t = await getTranslations('Menu');
  const common = await getTranslations('Common');
  const name = translate(branch.name, locale);
  return (
    <Container>
      <RememberBranch branchId={branch.id} slug={branch.slug} />
      <PageHeading title={title} subtitle={t('branchLabel', { branch: name })} />
      <FeaturePlaceholder badge={common('comingSoon')} title={t('placeholderTitle')} text={t('placeholderText')}>
        <BranchContactList branches={[branch]} locale={locale} whatsappText={t('whatsappText')} />
      </FeaturePlaceholder>
    </Container>
  );
}
