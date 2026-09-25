import { Space, Tag, Typography } from 'antd';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { formatTiyn } from '@aula/api-client';
import { useBranch } from '@/shared/branch/BranchProvider';
import { tx } from '@/shared/i18n/tx';
import { formatLocalDate } from '@/shared/lib/local-date';
import type { CustomerFilterDto } from './types';

const AUTO_TAG_COLORS: Record<string, string> = { regular: 'green', banquet: 'gold', corporate: 'blue' };

/** Подпись тега: автотеги (regular, banquet, corporate) — переводом, остальные — как есть. */
export function tagLabel(t: TFunction, tag: string): string {
  return tx(t, `customers.autoTags.${tag}`, tag);
}

export function CustomerTags({ tags }: { tags: readonly string[] }) {
  const { t } = useTranslation();
  if (tags.length === 0) return <Typography.Text type="secondary">—</Typography.Text>;
  return (
    <Space size={[4, 4]} wrap>
      {tags.map((tag) => (
        <Tag key={tag} color={AUTO_TAG_COLORS[tag]} style={{ marginInlineEnd: 0 }}>
          {tagLabel(t, tag)}
        </Tag>
      ))}
    </Space>
  );
}

/** Условия фильтра гостей чипами (сегменты, выгрузка). */
export function FilterSummary({ filter, segmentName }: { filter: CustomerFilterDto; segmentName?: string | null }) {
  const { t, i18n } = useTranslation();
  const { branchName } = useBranch();
  const money = (value: number) => formatTiyn(value, i18n.language);
  const items: string[] = [];
  if (segmentName) items.push(t('customers.summary.segment', { value: segmentName }));
  if (filter.q) items.push(t('customers.summary.q', { value: filter.q }));
  if (filter.tags?.length) items.push(t('customers.summary.tags', { value: filter.tags.map((tag) => tagLabel(t, tag)).join(', ') }));
  if (filter.spentMin !== undefined) items.push(t('customers.summary.spentMin', { value: money(filter.spentMin) }));
  if (filter.spentMax !== undefined) items.push(t('customers.summary.spentMax', { value: money(filter.spentMax) }));
  if (filter.lastActivityFrom) items.push(t('customers.summary.lastActivityFrom', { value: formatLocalDate(filter.lastActivityFrom) }));
  if (filter.lastActivityTo) items.push(t('customers.summary.lastActivityTo', { value: formatLocalDate(filter.lastActivityTo) }));
  if (filter.branchId) items.push(t('customers.summary.branchId', { value: branchName(filter.branchId) }));
  if (filter.hasBanquet !== undefined) items.push(filter.hasBanquet ? t('customers.summary.hasBanquetYes') : t('customers.summary.hasBanquetNo'));
  if (filter.marketingConsent !== undefined) items.push(filter.marketingConsent ? t('customers.summary.marketingYes') : t('customers.summary.marketingNo'));
  if (items.length === 0) return <Typography.Text type="secondary">{t('customers.summary.empty')}</Typography.Text>;
  return (
    <Space size={[4, 4]} wrap>
      {items.map((item) => (
        <Tag key={item} style={{ marginInlineEnd: 0 }}>
          {item}
        </Tag>
      ))}
    </Space>
  );
}
