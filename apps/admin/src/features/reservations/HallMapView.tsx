/**
 * Карта зала: план с фоном и местами на своих позициях, цвет — занятость в выбранный момент
 * (по календарю дня). Клик по свободному месту — новая бронь на это время; по занятому — брони места за день.
 */
import { PlusOutlined } from '@ant-design/icons';
import { Button, Card, Col, Empty, Flex, List, Row, Segmented, Slider, Space, Tag, TimePicker, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { formatMoney, Permission, translate } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { StatusTag } from '@/shared/ui/StatusTag';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageLoader } from '@/shared/ui/PageLoader';
import { dayjs } from '@/shared/lib/dates';
import { backgroundUrl, HallPlan, type PlanShape } from '../venues/HallPlan';
import { reservationKeys, reservationsApi } from './api';
import { venueStateAt, type VenueMapState } from './availability';
import { formatInTz, formatLocalDate, formatTimeRange, venueTitle } from './format';
import { useBranchTimezone, useNow, useReservationDate, useReservationsUi } from './hooks';
import { MAP_STATE_SWATCH, MAP_STATES } from './palette';
import { DateNavigator, HoldCountdownTag, KindTag, LegendItem } from './parts';
import { SingleBranchGate } from './SingleBranchGate';
import { localDateTime, timelineWindow, todayIn, zonedToMs } from './timeline-layout';
import type { TimelineVenue } from './types';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const BOOKABLE_STATES: VenueMapState[] = ['free', 'soon'];

export function HallMapView() {
  const { t } = useTranslation();
  return (
    <SingleBranchGate
      permissions={[Permission.ReservationsView]}
      title={t('reservations.branchRequired.title')}
      text={t('reservations.branchRequired.text')}
      none={t('reservations.branchRequired.none')}
    >
      {(branchId) => <HallMap key={branchId} branchId={branchId} />}
    </SingleBranchGate>
  );
}

/** Время карты в адресе (?at=HH:mm): по умолчанию сейчас (сегодня) или 19:00 (другой день). */
function useMapTime(date: string, tz: string, now: number): [string, (time: string) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('at');
  const fallback = date === todayIn(tz, now) ? roundToQuarter(localDateTime(now, tz).time) : '19:00';
  const time = raw && TIME_RE.test(raw) ? raw : fallback;
  const setTime = (next: string) =>
    setParams(
      (prev) => {
        const copy = new URLSearchParams(prev);
        copy.set('at', next);
        return copy;
      },
      { replace: true },
    );
  return [time, setTime];
}

function roundToQuarter(time: string): string {
  const [h, m] = time.split(':').map(Number) as [number, number];
  const minutes = Math.floor(m / 15) * 15;
  return `${String(h).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function HallMap({ branchId }: { branchId: string }) {
  const { t, i18n } = useTranslation();
  const tz = useBranchTimezone(branchId);
  const now = useNow(60_000);
  const [date, setDate] = useReservationDate(tz);
  const [time, setTime] = useMapTime(date, tz, now);
  const ui = useReservationsUi();
  const timeline = useApiQuery(reservationKeys.timeline(branchId, date), () => reservationsApi.timeline(branchId, date), {
    keepPrevious: true,
    refetchInterval: 60_000,
  });
  const data = timeline.data?.branchId === branchId ? timeline.data : undefined;
  const mapHalls = useMemo(() => (data ? data.halls.filter((h) => h.isActive || h.venues.some((v) => v.items.length > 0)) : []), [data]);
  const [hallId, setHallId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const hall = mapHalls.find((h) => h.id === hallId) ?? mapHalls[0];

  useEffect(() => setSelectedId(null), [hall?.id]);

  const at = zonedToMs(date, time, tz);
  const window = useMemo(
    () =>
      data
        ? timelineWindow({
            from: data.from,
            to: data.to,
            openingRanges: data.openingRanges,
            items: data.halls.flatMap((h) => h.venues.flatMap((v) => v.items)),
            timezone: tz,
          })
        : null,
    [data, tz],
  );

  const shapes: PlanShape[] = useMemo(() => {
    if (!hall) return [];
    return hall.venues.map((venue) => {
      const state = venueStateAt(venue, at);
      const swatch = MAP_STATE_SWATCH[state.state];
      const stateLabel = t(`reservations.map.states.${state.state}`);
      const sublabel =
        state.state === 'soon' && state.item
          ? formatInTz(state.item.start, tz, 'HH:mm')
          : `${venue.capacityMin}–${venue.capacityMax}`;
      return {
        id: venue.id,
        position: venue.position,
        label: venue.code,
        sublabel,
        fill: swatch.fill,
        stroke: swatch.stroke,
        text: swatch.text,
        dashed: swatch.dashed,
        title: `${venueTitle(venue, i18n.language)} — ${stateLabel}`,
        highlight: venue.items.some((i) => ui.newIds.has(i.reservationId)),
      };
    });
  }, [hall, at, tz, t, i18n.language, ui.newIds]);

  const selected = hall?.venues.find((v) => v.id === selectedId) ?? null;

  const book = (venue: TimelineVenue) =>
    ui.openBooking({ venueId: venue.id, date, time, guests: Math.min(Math.max(2, venue.capacityMin), venue.capacityMax) });

  const onShapeClick = (id: string) => {
    setSelectedId(id);
    const venue = hall?.venues.find((v) => v.id === id);
    if (!venue || !ui.canCreate) return;
    if (BOOKABLE_STATES.includes(venueStateAt(venue, at).state)) book(venue);
  };

  const sliderMarks = useMemo(() => {
    if (!window) return undefined;
    const marks: Record<number, string> = {};
    for (let ms = window.start; ms <= window.end; ms += 3 * 3_600_000) marks[ms] = formatInTz(new Date(ms).toISOString(), tz, 'HH:mm');
    return marks;
  }, [window, tz]);

  return (
    <Card styles={{ body: { padding: 16 } }}>
      <Flex gap={12} wrap align="center" style={{ marginBottom: 12 }}>
        <DateNavigator date={date} tz={tz} onChange={setDate} />
        <Space>
          <Typography.Text type="secondary">{t('reservations.map.time')}</Typography.Text>
          <TimePicker
            value={dayjs(`2000-01-01T${time}`)}
            format="HH:mm"
            minuteStep={15}
            allowClear={false}
            needConfirm={false}
            onChange={(value) => value && setTime(value.format('HH:mm'))}
            style={{ width: 96 }}
          />
          {date === todayIn(tz, now) ? <Button onClick={() => setTime(roundToQuarter(localDateTime(Date.now(), tz).time))}>{t('reservations.map.now')}</Button> : null}
        </Space>
      </Flex>
      {window ? (
        <Slider
          min={window.start}
          max={window.end}
          step={15 * 60_000}
          value={Math.min(Math.max(at, window.start), window.end)}
          marks={sliderMarks}
          tooltip={{ formatter: (value) => (typeof value === 'number' ? formatInTz(new Date(value).toISOString(), tz, 'HH:mm') : '') }}
          onChange={(value) => setTime(localDateTime(value, tz).time)}
          style={{ margin: '0 12px 24px' }}
        />
      ) : null}
      {timeline.error ? <ErrorAlert error={timeline.error} onRetry={() => void timeline.refetch()} /> : null}
      {!data && timeline.isLoading ? <PageLoader /> : null}
      {data && mapHalls.length === 0 ? <Empty description={t('reservations.map.noHalls')} /> : null}
      {hall ? (
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={17}>
            {mapHalls.length > 1 ? (
              <Segmented
                value={hall.id}
                onChange={(value) => setHallId(String(value))}
                options={mapHalls.map((h) => ({ value: h.id, label: translate(h.name, i18n.language) || h.code }))}
                style={{ marginBottom: 12 }}
              />
            ) : null}
            {hall.venues.length === 0 ? (
              <Empty description={t('reservations.map.noVenuesInHall')} />
            ) : (
              <HallPlan
                width={hall.planWidth}
                height={hall.planHeight}
                background={backgroundUrl(hall.background)}
                shapes={shapes}
                selectedId={selectedId}
                onShapeClick={onShapeClick}
                ariaLabel={translate(hall.name, i18n.language)}
              />
            )}
            <Flex gap={12} wrap style={{ marginTop: 12 }}>
              {MAP_STATES.map((state) => (
                <LegendItem key={state} swatch={MAP_STATE_SWATCH[state]} label={t(`reservations.map.states.${state}`)} />
              ))}
            </Flex>
          </Col>
          <Col xs={24} xl={7}>
            <VenueDayPanel
              venue={selected}
              date={date}
              time={time}
              tz={tz}
              at={at}
              canCreate={ui.canCreate}
              onOpen={ui.openReservation}
              onBook={book}
            />
          </Col>
        </Row>
      ) : null}
    </Card>
  );
}

function VenueDayPanel({
  venue,
  date,
  time,
  tz,
  at,
  canCreate,
  onOpen,
  onBook,
}: {
  venue: TimelineVenue | null;
  date: string;
  time: string;
  tz: string;
  at: number;
  canCreate: boolean;
  onOpen: (id: string) => void;
  onBook: (venue: TimelineVenue) => void;
}) {
  const { t, i18n } = useTranslation();
  if (!venue) {
    return (
      <Card size="small">
        <Typography.Text type="secondary">{t('reservations.map.selectVenue')}</Typography.Text>
      </Card>
    );
  }
  const state = venueStateAt(venue, at);
  const items = [...venue.items].sort((a, b) => a.start.localeCompare(b.start));
  return (
    <Card
      size="small"
      title={venueTitle(venue, i18n.language)}
      extra={<Tag style={{ marginInlineEnd: 0 }}>{t(`reservations.map.states.${state.state}`)}</Tag>}
    >
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          {translate(venue.typeName, i18n.language)} · {t('reservations.capacityRange', { min: venue.capacityMin, max: venue.capacityMax })}
          {venue.deposit ? ` · ${t('reservations.fields.deposit')} ${formatMoney(venue.deposit, i18n.language)}` : ''}
        </Typography.Text>
        <Space size={4} wrap>
          {!venue.bookableOnline ? <Tag>{t('reservations.phoneOnly')}</Tag> : null}
          {venue.rules.requiresManualConfirmation ? <Tag color="gold">{t('reservations.booking.manualConfirmation')}</Tag> : null}
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('reservations.map.venueRules', {
            duration: t('reservations.minutes', { count: venue.rules.durationMinutes }),
            cleanup: t('reservations.minutes', { count: venue.rules.cleanupMinutes }),
            hold: t('reservations.minutes', { count: venue.rules.holdMinutes }),
          })}
        </Typography.Text>
        {canCreate && venue.isActive ? (
          <Button type="primary" icon={<PlusOutlined />} block onClick={() => onBook(venue)}>
            {t('reservations.map.bookAt', { time })}
          </Button>
        ) : null}
        <Typography.Text strong style={{ marginTop: 8 }}>
          {t('reservations.map.venueDay', { date: formatLocalDate(date, 'DD.MM.YYYY') })}
        </Typography.Text>
        {items.length === 0 ? (
          <Typography.Text type="secondary">{t('reservations.map.noBookings')}</Typography.Text>
        ) : (
          <List
            size="small"
            dataSource={items}
            renderItem={(item) => (
              <List.Item style={{ cursor: 'pointer', paddingInline: 0 }} onClick={() => onOpen(item.reservationId)}>
                <Space direction="vertical" size={0} style={{ width: '100%' }}>
                  <Space wrap size={4}>
                    <Typography.Text strong>{formatTimeRange(item.start, item.end, tz)}</Typography.Text>
                    {item.kind === 'banquet' ? <KindTag kind="banquet" /> : <StatusTag domain="reservation" status={item.status} />}
                    {item.status === 'pending' || item.status === 'awaiting_deposit' ? <HoldCountdownTag holdExpiresAt={item.holdExpiresAt} /> : null}
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {item.number} · {t('reservations.guestsCount', { count: item.guests })}
                    {item.customerName ? ` · ${item.customerName}` : ''}
                  </Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        )}
      </Space>
    </Card>
  );
}
