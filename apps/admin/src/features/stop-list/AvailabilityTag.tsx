import { Tag, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import type { BranchMenuItem } from '@aula/api-client';
import { describeUntil, type UntilDescription } from './stop-until';

/** Подпись срока стопа для текущего языка. */
export function useUntilLabel() {
  const { t } = useTranslation();
  return (until: string | null | undefined, timeZone?: string, now: Date = new Date()): string => {
    const d: UntilDescription = describeUntil(until, now, timeZone);
    switch (d.kind) {
      case 'manual':
        return t('stopList.untilManual');
      case 'expired':
        return t('stopList.untilExpired');
      case 'end_of_day':
        return t('stopList.untilEndOfDay');
      case 'today':
        return t('stopList.until', { time: d.time });
      case 'date':
        return t('stopList.until', { time: d.date });
    }
  };
}

/** Доступность позиции меню филиала: «В продаже» или «В стопе · до …», источник стопа, как видно на сайте. */
export function AvailabilityTag({ item, timeZone }: { item: Pick<BranchMenuItem, 'availability' | 'displayAvailability' | 'stoppedUntil' | 'stopSource' | 'stopReason'>; timeZone?: string }) {
  const { t } = useTranslation();
  const untilLabel = useUntilLabel();
  if (item.availability !== 'stopped') return <Tag color="success">{t('stopList.available')}</Tag>;
  return (
    <Tooltip
      title={
        <div>
          <div>{t(`stopList.display.${item.displayAvailability}`)}</div>
          {item.stopReason ? <div>{t('stopList.reasonValue', { reason: item.stopReason })}</div> : null}
        </div>
      }
    >
      <Tag color="error">
        {t('stopList.stopped')} · {untilLabel(item.stoppedUntil, timeZone)}
        {item.stopSource === 'pos' ? ` · ${t('stopList.source.pos')}` : ''}
      </Tag>
    </Tooltip>
  );
}
