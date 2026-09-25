import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Flex, Segmented, Space, Tag, Tooltip, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { translate } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useBranch } from '@/shared/branch/BranchProvider';
import { tx } from '@/shared/i18n/tx';
import { dayjs } from '@/shared/lib/dates';
import { useStoredState } from '@/shared/lib/storage';
import { BranchSelect } from '@/shared/ui/BranchSelect';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageLoader } from '@/shared/ui/PageLoader';
import { statusColor } from '@/shared/ui/statuses';
import { banquetsApi, banquetsKeys } from '../api';
import {
  banquetsByDate,
  calendarRange,
  cellKey,
  isSameMonth,
  monthWeeks,
  occupancyByVenueDay,
  occupancySummaryByDate,
  segmentPosition,
  shiftAnchor,
  splitOccupancy,
  todayLocal,
  weekDays,
  type CalendarMode,
} from '../calendar-layout';
import type { BanquetRequestSummary } from '../types';

const STATUS_BORDER: Record<string, string> = {
  red: '#cf1322',
  blue: '#1677ff',
  geekblue: '#2f54eb',
  cyan: '#13c2c2',
  purple: '#722ed1',
  success: '#389e0d',
  default: '#8c8c8c',
};

function EventChip({ banquet }: { banquet: BanquetRequestSummary }) {
  const { t } = useTranslation();
  const border = STATUS_BORDER[statusColor('banquet', banquet.status)] ?? '#722ed1';
  return (
    <Tooltip
      title={
        <div>
          <div>
            {banquet.number} · {tx(t, `statuses.banquet.${banquet.status}`, banquet.status)}
          </div>
          <div>
            {tx(t, `banquets.eventTypes.${banquet.eventType}`, banquet.eventType)} · {t('banquets.common.guestsCount', { count: banquet.guests })}
          </div>
          <div>
            {banquet.contact.name} · {banquet.managerName}
          </div>
        </div>
      }
    >
      <Link
        to={`/banquets/${banquet.id}`}
        className={`aula-bq-event${banquet.status === 'cancelled' ? ' aula-bq-event--cancelled' : ''}`}
        style={{ borderLeftColor: border }}
      >
        {banquet.eventTime ? `${banquet.eventTime} ` : ''}
        {tx(t, `banquets.eventTypes.${banquet.eventType}`, banquet.eventType)} · {banquet.guests}
      </Link>
    </Tooltip>
  );
}

/**
 * Календарь мероприятий филиала (GET /admin/banquets/calendar): месяц — банкеты по датам и сводка
 * занятости залов; неделя — залы × дни с полосами занятости (брони и банкеты из модуля брони).
 */
export function CalendarPage() {
  const { t, i18n } = useTranslation();
  const { selectedBranchId, branches } = useBranch();
  const [mode, setMode] = useStoredState<CalendarMode>('aula_admin_banquets_calendar', 'month');
  const [anchor, setAnchor] = useState(() => todayLocal());
  const [branchId, setBranchId] = useState<string | null>(selectedBranchId);

  useEffect(() => {
    setBranchId(selectedBranchId ?? branches[0]?.id ?? null);
  }, [selectedBranchId, branches]);

  const range = calendarRange(mode, anchor);
  const params = { branchId: branchId ?? '', from: range.from, to: range.to };
  const calendar = useApiQuery(banquetsKeys.calendar(params), () => banquetsApi.calendar(params), { enabled: Boolean(branchId), keepPrevious: true });
  const today = todayLocal();

  const segments = useMemo(() => splitOccupancy(calendar.data?.occupancy ?? []), [calendar.data]);
  const byDate = useMemo(() => banquetsByDate(calendar.data?.banquets ?? []), [calendar.data]);
  const summary = useMemo(() => occupancySummaryByDate(segments), [segments]);
  const cells = useMemo(() => occupancyByVenueDay(segments), [segments]);
  const withVenue = useMemo(() => new Set(segments.filter((s) => s.banquetRequestId).map((s) => s.banquetRequestId!)), [segments]);
  const banquetById = useMemo(() => new Map((calendar.data?.banquets ?? []).map((b) => [b.id, b])), [calendar.data]);

  const title =
    mode === 'month'
      ? dayjs(anchor).format('MMMM YYYY')
      : `${dayjs(range.from).format('DD.MM')} — ${dayjs(range.to).format('DD.MM.YYYY')}`;

  const weekdayHeader = weekDays(range.from).map((d) => dayjs(d).format('dd'));

  return (
    <>
      <Flex justify="space-between" align="center" gap={12} wrap style={{ marginBottom: 12 }}>
        <Space wrap>
          <BranchSelect value={branchId} onChange={setBranchId} style={{ width: 220 }} />
          <Segmented<CalendarMode>
            value={mode}
            onChange={setMode}
            options={[
              { value: 'month', label: t('banquets.calendar.month') },
              { value: 'week', label: t('banquets.calendar.week') },
            ]}
          />
          <Space.Compact>
            <Button icon={<LeftOutlined />} onClick={() => setAnchor(shiftAnchor(mode, anchor, -1))} aria-label={t('banquets.calendar.prev')} />
            <Button onClick={() => setAnchor(today)}>{t('banquets.calendar.today')}</Button>
            <Button icon={<RightOutlined />} onClick={() => setAnchor(shiftAnchor(mode, anchor, 1))} aria-label={t('banquets.calendar.next')} />
          </Space.Compact>
          <Typography.Title level={5} style={{ margin: 0, textTransform: 'capitalize' }}>
            {title}
          </Typography.Title>
        </Space>
        <Space wrap size={4}>
          <Tag color="purple">{t('banquets.calendar.legend.banquet')}</Tag>
          <Tag color="blue">{t('banquets.calendar.legend.regular')}</Tag>
          <Tag color="geekblue">{t('banquets.calendar.legend.banquetHold')}</Tag>
        </Space>
      </Flex>
      <Typography.Paragraph type="secondary">{t('banquets.calendar.syncHint')}</Typography.Paragraph>
      {!branchId ? <Alert type="info" showIcon message={t('banquets.calendar.chooseBranch')} /> : null}
      {calendar.error ? <ErrorAlert error={calendar.error} onRetry={() => void calendar.refetch()} /> : null}
      {branchId && calendar.isLoading ? <PageLoader /> : null}
      {branchId && calendar.data && mode === 'month' ? (
        <div style={{ overflowX: 'auto' }}>
          <div className="aula-bq-month" style={{ minWidth: 840 }}>
            {weekdayHeader.map((d) => (
              <div key={d} className="aula-bq-month-head">
                {d}
              </div>
            ))}
            {monthWeeks(anchor)
              .flat()
              .map((day) => {
                const events = byDate.get(day) ?? [];
                const occ = summary.get(day);
                const classes = ['aula-bq-day', isSameMonth(day, anchor) ? '' : 'aula-bq-day--other', day === today ? 'aula-bq-day--today' : ''].filter(Boolean).join(' ');
                return (
                  <div key={day} className={classes}>
                    <span className="aula-bq-day-number" style={{ alignSelf: 'flex-start' }}>
                      {dayjs(day).date()}
                    </span>
                    {events.slice(0, 4).map((b) => (
                      <EventChip key={b.id} banquet={b} />
                    ))}
                    {events.length > 4 ? <Typography.Text type="secondary" style={{ fontSize: 11 }}>{t('banquets.calendar.more', { count: events.length - 4 })}</Typography.Text> : null}
                    {occ ? (
                      <Typography.Text type="secondary" style={{ fontSize: 11, marginTop: 'auto' }}>
                        {occ.regular > 0 ? t('banquets.calendar.reservations', { count: occ.regular }) : ''}
                        {occ.regular > 0 && occ.banquet > 0 ? ' · ' : ''}
                        {occ.banquet > 0 ? t('banquets.calendar.banquetHolds', { count: occ.banquet }) : ''}
                      </Typography.Text>
                    ) : null}
                  </div>
                );
              })}
          </div>
        </div>
      ) : null}
      {branchId && calendar.data && mode === 'week' ? (
        calendar.data.venues.length === 0 ? (
          <Empty description={t('banquets.calendar.noVenues')} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <div className="aula-bq-week" style={{ minWidth: 1020 }}>
              <div className="aula-bq-month-head">{t('banquets.calendar.venue')}</div>
              {range.days.map((day) => (
                <div key={day} className="aula-bq-month-head" style={day === today ? { color: '#8a5a36' } : undefined}>
                  {dayjs(day).format('dd, DD.MM')}
                </div>
              ))}
              <div className="aula-bq-week-venue">
                <Typography.Text type="secondary">{t('banquets.calendar.withoutVenue')}</Typography.Text>
              </div>
              {range.days.map((day) => (
                <div key={`nv-${day}`}>
                  {(byDate.get(day) ?? [])
                    .filter((b) => !withVenue.has(b.id))
                    .map((b) => (
                      <EventChip key={b.id} banquet={b} />
                    ))}
                </div>
              ))}
              {calendar.data.venues.map((venue) => (
                <VenueRow
                  key={venue.id}
                  label={`${translate(venue.hallName, i18n.language)} · ${translate(venue.name, i18n.language)}`}
                  capacity={`${venue.capacityMin}–${venue.capacityMax}`}
                  inactive={!venue.isActive}
                  days={range.days}
                  render={(day) =>
                    (cells.get(cellKey(venue.id, day)) ?? []).map((s) => {
                      const banquet = s.banquetRequestId ? banquetById.get(s.banquetRequestId) : undefined;
                      return { segment: s, banquet };
                    })
                  }
                />
              ))}
            </div>
          </div>
        )
      ) : null}
    </>
  );
}

function VenueRow({
  label,
  capacity,
  inactive,
  days,
  render,
}: {
  label: string;
  capacity: string;
  inactive: boolean;
  days: string[];
  render: (day: string) => Array<{ segment: ReturnType<typeof splitOccupancy>[number]; banquet: BanquetRequestSummary | undefined }>;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="aula-bq-week-venue">
        <div>{label}</div>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {capacity}
          {inactive ? ` · ${t('banquets.venue.inactive')}` : ''}
        </Typography.Text>
      </div>
      {days.map((day) => {
        const items = render(day);
        return (
          <div key={day}>
            {items.length > 0 ? (
              <div className="aula-bq-track">
                {items.map(({ segment }) => {
                  const pos = segmentPosition(segment);
                  return (
                    <span
                      key={`${segment.reservationId}-${segment.date}`}
                      className={`aula-bq-track-bar${segment.kind === 'banquet' ? ' aula-bq-track-bar--banquet' : ''}`}
                      style={{ left: `${pos.left}%`, width: `${pos.width}%` }}
                    />
                  );
                })}
              </div>
            ) : null}
            {items.map(({ segment, banquet }) =>
              banquet ? (
                <Link key={`${segment.reservationId}-${segment.date}-l`} to={`/banquets/${banquet.id}`} className="aula-bq-slot aula-bq-slot--banquet">
                  {segment.label} · {banquet.number}
                </Link>
              ) : (
                <span key={`${segment.reservationId}-${segment.date}-l`} className={`aula-bq-slot${segment.kind === 'banquet' ? ' aula-bq-slot--banquet' : ''}`}>
                  {segment.label} · {segment.guests}
                </span>
              ),
            )}
          </div>
        );
      })}
    </>
  );
}
