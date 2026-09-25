import { Flex, Progress, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { bpToPercentText, slaShareTone, type SlaTone } from '../sla';
import type { SlaStats } from '../types';

export const TONE_COLORS: Record<SlaTone, string> = { success: '#2f7d4f', warning: '#c8962e', danger: '#b5452c', none: '#a08b76' };

/** Доля ответов в срок (кольцо) и цель. */
export function SlaShare({ stats, size = 120 }: { stats: Pick<SlaStats, 'withinSlaShareBp' | 'targetShareBp'>; size?: number }) {
  const { t, i18n } = useTranslation();
  const tone = slaShareTone(stats.withinSlaShareBp, stats.targetShareBp);
  return (
    <Flex vertical align="center" gap={4}>
      <Progress
        type="circle"
        size={size}
        percent={stats.withinSlaShareBp === null ? 0 : stats.withinSlaShareBp / 100}
        strokeColor={TONE_COLORS[tone]}
        format={() => (stats.withinSlaShareBp === null ? '—' : `${bpToPercentText(stats.withinSlaShareBp, i18n.language)}%`)}
      />
      <Typography.Text type="secondary">{t('banquets.sla.target', { value: bpToPercentText(stats.targetShareBp, i18n.language) })}</Typography.Text>
    </Flex>
  );
}

