import { DatePicker } from 'antd';
import type { Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import { dayjs, DISPLAY_TIMEZONE, endOfLocalDayExclusiveIso, startOfLocalDayIso } from '../lib/dates';

export type DateRangeValue = [Dayjs, Dayjs] | null;

/** Диапазон дат (включительно) → { from, to } в ISO UTC для API (to — начало следующего дня). */
export function dateRangeToQuery(range: DateRangeValue): { from?: string; to?: string } {
  if (!range) return {};
  return { from: startOfLocalDayIso(range[0]), to: endOfLocalDayExclusiveIso(range[1]) };
}

/** Фильтр по датам с быстрыми периодами (сегодня, 7 и 30 дней, текущий месяц). */
export function DateRangeFilter({
  value,
  onChange,
  allowClear = true,
}: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  allowClear?: boolean;
}) {
  const { t } = useTranslation();
  const today = dayjs().tz(DISPLAY_TIMEZONE);
  return (
    <DatePicker.RangePicker
      value={value}
      allowClear={allowClear}
      format="DD.MM.YYYY"
      placeholder={[t('dateRange.from'), t('dateRange.to')]}
      onChange={(dates) => onChange(dates && dates[0] && dates[1] ? [dates[0], dates[1]] : null)}
      presets={[
        { label: t('dateRange.today'), value: [today.startOf('day'), today.endOf('day')] },
        { label: t('dateRange.last7'), value: [today.subtract(6, 'day').startOf('day'), today.endOf('day')] },
        { label: t('dateRange.last30'), value: [today.subtract(29, 'day').startOf('day'), today.endOf('day')] },
        { label: t('dateRange.thisMonth'), value: [today.startOf('month'), today.endOf('day')] },
      ]}
    />
  );
}
