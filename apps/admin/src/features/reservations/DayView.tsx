/**
 * Главный экран оператора: день филиала по местам (GET /admin/reservations/timeline). Брони и банкеты,
 * буфер уборки, часы работы; навигация по датам; клик — карточка брони или новая бронь на свободное время.
 */
import { Alert, Card, Empty, Flex, Select, Space, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Permission, translate } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageLoader } from '@/shared/ui/PageLoader';
import { reservationKeys, reservationsApi } from './api';
import { useBranchTimezone, useNow, useReservationDate, useReservationsUi } from './hooks';
import { BANQUET_SWATCH, STATUS_SWATCH } from './palette';
import { DateNavigator, LegendItem } from './parts';
import { SingleBranchGate } from './SingleBranchGate';
import { localDateTime } from './timeline-layout';
import { TimelineGrid } from './TimelineGrid';
import type { ReservationStatus } from './types';

const LEGEND_STATUSES: ReservationStatus[] = ['pending', 'awaiting_deposit', 'confirmed', 'arrived', 'no_show'];

export function DayView() {
  const { t } = useTranslation();
  return (
    <SingleBranchGate
      permissions={[Permission.ReservationsView]}
      title={t('reservations.branchRequired.title')}
      text={t('reservations.branchRequired.text')}
      none={t('reservations.branchRequired.none')}
    >
      {(branchId) => <DayTimeline key={branchId} branchId={branchId} />}
    </SingleBranchGate>
  );
}

function DayTimeline({ branchId }: { branchId: string }) {
  const { t, i18n } = useTranslation();
  const tz = useBranchTimezone(branchId);
  const [date, setDate] = useReservationDate(tz);
  const [hallId, setHallId] = useState<string>('all');
  const now = useNow(30_000);
  const ui = useReservationsUi();
  const timeline = useApiQuery(reservationKeys.timeline(branchId, date), () => reservationsApi.timeline(branchId, date), {
    keepPrevious: true,
    refetchInterval: 60_000,
  });

  const data = timeline.data?.branchId === branchId ? timeline.data : undefined;
  const halls = useMemo(() => (data ? data.halls.filter((h) => hallId === 'all' || h.id === hallId) : []), [data, hallId]);
  const summary = useMemo(() => {
    const items = halls.flatMap((h) => h.venues.flatMap((v) => v.items)).filter((i) => i.blocking || i.status === 'no_show');
    return { count: items.length, guests: items.reduce((sum, i) => sum + i.guests, 0) };
  }, [halls]);
  const venueCount = data?.halls.reduce((sum, h) => sum + h.venues.length, 0) ?? 0;

  return (
    <Card styles={{ body: { padding: 16 } }}>
      <Flex gap={12} wrap align="center" justify="space-between" style={{ marginBottom: 12 }}>
        <Space wrap>
          <DateNavigator date={date} tz={tz} onChange={setDate} />
          {data && data.halls.length > 1 ? (
            <Select
              value={hallId}
              onChange={setHallId}
              style={{ minWidth: 180 }}
              options={[
                { value: 'all', label: t('reservations.day.allHalls') },
                ...data.halls.map((h) => ({ value: h.id, label: translate(h.name, i18n.language) || h.code })),
              ]}
            />
          ) : null}
        </Space>
        <Typography.Text type="secondary">{t('reservations.day.summary', { count: summary.count, guests: summary.guests })}</Typography.Text>
      </Flex>
      <Flex gap={12} wrap style={{ marginBottom: 12 }}>
        {LEGEND_STATUSES.map((status) => (
          <LegendItem key={status} swatch={STATUS_SWATCH[status]} label={t(`statuses.reservation.${status}`)} />
        ))}
        <LegendItem
          swatch={BANQUET_SWATCH}
          label={t('reservations.day.legend.banquet')}
          pattern={`repeating-linear-gradient(135deg, ${BANQUET_SWATCH.fill} 0 3px, #dcc3ea 3px 6px)`}
        />
        <LegendItem
          swatch={{ fill: '#f6f1eb', stroke: '#b9aa99', text: '#000', dashed: true }}
          label={t('reservations.day.legend.cleanup')}
          pattern="repeating-linear-gradient(135deg, rgba(90,70,50,0.18) 0 3px, transparent 3px 6px)"
        />
        <LegendItem
          swatch={{ fill: '#eee6db', stroke: '#e3d6c6', text: '#000' }}
          label={t('reservations.day.legend.closed')}
          pattern="repeating-linear-gradient(135deg, #f6f1eb 0 3px, #eee6db 3px 6px)"
        />
        <span className="rsv-legend">
          <span className="rsv-mark-dot" />
          {t('reservations.needsMark')}
        </span>
      </Flex>
      {timeline.error ? <ErrorAlert error={timeline.error} onRetry={() => void timeline.refetch()} /> : null}
      {!data && timeline.isLoading ? <PageLoader /> : null}
      {data && data.openingRanges.length === 0 ? <Alert type="info" showIcon message={t('reservations.day.closedDay')} style={{ marginBottom: 12 }} /> : null}
      {data && venueCount === 0 ? <Empty description={t('reservations.day.noVenues')} /> : null}
      {data && venueCount > 0 ? (
        <>
          <TimelineGrid
            timeline={data}
            halls={halls}
            now={now}
            highlightIds={ui.newIds}
            onItemClick={(item) => ui.openReservation(item.reservationId)}
            onSlotClick={
              ui.canCreate
                ? (venue, at) =>
                    ui.openBooking({ venueId: venue.id, ...localDateTime(at, tz), guests: Math.min(Math.max(2, venue.capacityMin), venue.capacityMax) })
                : null
            }
          />
          {ui.canCreate ? (
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              {t('reservations.day.clickHint')}
            </Typography.Text>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
