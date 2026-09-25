/** Мелкие элементы раздела броней: теги депозита и вида, отсчёт удержания, навигация по датам, легенда. */
import { CalendarOutlined, ClockCircleOutlined, CrownOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import { Button, DatePicker, Space, Tag, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { formatMoney, type Money } from '@aula/api-client';
import { tx } from '@/shared/i18n/tx';
import { dayjs } from '@/shared/lib/dates';
import { holdCountdown, type HoldUrgency } from './hold-countdown';
import { useNow } from './hooks';
import type { Swatch } from './palette';
import { shiftDate, todayIn } from './timeline-layout';
import type { DepositState, ReservationKind } from './types';

const DEPOSIT_COLORS: Record<DepositState, string> = {
  none: 'default',
  waived: 'purple',
  pending: 'gold',
  unpaid: 'default',
  paid: 'green',
  refund_pending: 'processing',
  refunded: 'cyan',
  refund_failed: 'error',
  retained: 'volcano',
  applied: 'success',
};

export function DepositTag({ state, amount }: { state: DepositState; amount?: Money | null }) {
  const { t, i18n } = useTranslation();
  if (state === 'none' && !amount) return <Typography.Text type="secondary">—</Typography.Text>;
  return (
    <Tag color={DEPOSIT_COLORS[state]} style={{ marginInlineEnd: 0 }}>
      {amount && state !== 'none' ? `${formatMoney(amount, i18n.language)} · ` : ''}
      {tx(t, `reservations.depositStates.${state}`, state)}
    </Tag>
  );
}

export function KindTag({ kind }: { kind: ReservationKind }) {
  const { t } = useTranslation();
  if (kind !== 'banquet') return null;
  return (
    <Tag color="purple" icon={<CrownOutlined />} style={{ marginInlineEnd: 0 }}>
      {t('reservations.kinds.banquet')}
    </Tag>
  );
}

const URGENCY_COLOR: Record<HoldUrgency, string> = { ok: 'default', warning: 'gold', critical: 'red', expired: 'default' };

/** Отсчёт до снятия брони (holdExpiresAt), обновляется каждую секунду. */
export function HoldCountdownTag({ holdExpiresAt }: { holdExpiresAt: string | null }) {
  const { t } = useTranslation();
  const now = useNow(1000);
  const countdown = holdCountdown(holdExpiresAt, now);
  if (!countdown) return null;
  return (
    <Tag color={URGENCY_COLOR[countdown.urgency]} icon={<ClockCircleOutlined />} style={{ marginInlineEnd: 0, fontVariantNumeric: 'tabular-nums' }}>
      {countdown.urgency === 'expired' ? t('reservations.queue.expired') : t('reservations.queue.expiresIn', { time: countdown.text })}
    </Tag>
  );
}

/** Предыдущий / следующий день, «сегодня» (по часовому поясу филиала) и выбор даты. */
export function DateNavigator({ date, tz, onChange }: { date: string; tz: string; onChange: (date: string) => void }) {
  const { t } = useTranslation();
  const today = todayIn(tz);
  return (
    <Space.Compact>
      <Tooltip title={t('reservations.day.prev')}>
        <Button icon={<LeftOutlined />} aria-label={t('reservations.day.prev')} onClick={() => onChange(shiftDate(date, -1))} />
      </Tooltip>
      <DatePicker
        value={dayjs(date)}
        allowClear={false}
        format="dd, DD.MM.YYYY"
        suffixIcon={<CalendarOutlined />}
        onChange={(value) => value && onChange(value.format('YYYY-MM-DD'))}
        style={{ width: 170 }}
      />
      <Tooltip title={t('reservations.day.next')}>
        <Button icon={<RightOutlined />} aria-label={t('reservations.day.next')} onClick={() => onChange(shiftDate(date, 1))} />
      </Tooltip>
      <Button type={date === today ? 'primary' : 'default'} onClick={() => onChange(today)}>
        {t('reservations.day.today')}
      </Button>
    </Space.Compact>
  );
}

export function LegendItem({ swatch, label, pattern }: { swatch: Swatch; label: string; pattern?: string }) {
  return (
    <span className="rsv-legend">
      <span
        className="rsv-legend-swatch"
        style={{
          background: pattern ?? swatch.fill,
          borderColor: swatch.stroke,
          borderStyle: swatch.dashed ? 'dashed' : 'solid',
        }}
      />
      {label}
    </span>
  );
}
