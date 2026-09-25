/**
 * Выбор места для брони оператором и переноса: места филиала, свободные на выбранное время
 * (предварительно — по календарю дня и правилам мест; окончательно проверяет сервер).
 */
import { Alert, Empty, Flex, Radio, Space, Switch, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney, translate } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { venueKeys, venueConfigApi } from '../venues/api';
import type { Venue } from '../venues/types';
import { reservationKeys, reservationsApi } from './api';
import { noFreeReason, occupancyByVenue, venueChoices, type VenueChoice } from './availability';
import { formatInTz, venueTitle } from './format';
import { zonedToMs } from './timeline-layout';

export interface SlotParams {
  date?: string | null;
  time?: string | null;
  guests?: number | null;
  durationMinutes?: number | null;
  excludeReservationId?: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Места филиала с состоянием на выбранное время (календарь дня + правила мест). */
export function useSlotChoices(branchId: string, tz: string, params: SlotParams) {
  const date = params.date && DATE_RE.test(params.date) ? params.date : null;
  const timeline = useApiQuery(reservationKeys.timeline(branchId, date ?? ''), () => reservationsApi.timeline(branchId, date!), {
    enabled: Boolean(date),
    keepPrevious: true,
  });
  const venues = useApiQuery(venueKeys.venues(branchId), () => venueConfigApi.venues(branchId), { staleTime: 60_000 });
  const timelineData = timeline.data?.date === date ? timeline.data : undefined;
  const choices = useMemo<Array<VenueChoice<Venue>> | null>(() => {
    if (!timelineData || !venues.data || !date || !params.time || !TIME_RE.test(params.time) || !params.guests) return null;
    return venueChoices(venues.data, occupancyByVenue(timelineData.halls), {
      start: zonedToMs(date, params.time, tz),
      guests: params.guests,
      durationMinutes: params.durationMinutes || null,
      now: Date.now(),
      openingRanges: timelineData.openingRanges,
      excludeReservationId: params.excludeReservationId ?? null,
    });
  }, [timelineData, venues.data, date, params.time, params.guests, params.durationMinutes, params.excludeReservationId, tz]);
  return {
    choices,
    venues: venues.data,
    loading: timeline.isFetching || venues.isLoading,
    error: timeline.error ?? venues.error,
    refetch: () => {
      void timeline.refetch();
      void venues.refetch();
    },
  };
}

export function VenuePicker({
  choices,
  value,
  onChange,
  tz,
  currentVenueId,
}: {
  choices: Array<VenueChoice<Venue>> | null;
  value?: string | null;
  onChange?: (venueId: string) => void;
  tz: string;
  /** Текущее место брони (перенос). */
  currentVenueId?: string;
}) {
  const { t, i18n } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  if (!choices) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  const reason = noFreeReason(choices);
  const visible = choices.filter((c) => showAll || c.slot.status === 'free' || c.venue.id === value);
  const byHall = new Map<string, Array<VenueChoice<Venue>>>();
  for (const choice of visible) {
    const list = byHall.get(choice.venue.hallId) ?? [];
    list.push(choice);
    byHall.set(choice.venue.hallId, list);
  }
  return (
    <div>
      {reason ? <Alert type="warning" showIcon message={t(`reservations.booking.noFree.${reason}`)} style={{ marginBottom: 8 }} /> : null}
      <Flex justify="space-between" align="center" gap={8} wrap style={{ marginBottom: 8 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('reservations.booking.preliminary')}
        </Typography.Text>
        <Space size={6}>
          <Switch size="small" checked={showAll} onChange={setShowAll} />
          <Typography.Text style={{ fontSize: 12 }}>{t('reservations.booking.showUnavailable')}</Typography.Text>
        </Space>
      </Flex>
      <Radio.Group value={value ?? null} onChange={(e) => onChange?.(e.target.value as string)} style={{ width: '100%' }}>
        <Flex vertical gap={12}>
          {[...byHall.entries()].map(([hallId, list]) => (
            <div key={hallId}>
              <Typography.Text strong style={{ fontSize: 13 }}>
                {translate(list[0]!.venue.hallName, i18n.language)}
              </Typography.Text>
              <Flex vertical gap={6} style={{ marginTop: 6 }}>
                {list.map(({ venue, slot }) => {
                  const free = slot.status === 'free';
                  return (
                    <Radio
                      key={venue.id}
                      value={venue.id}
                      disabled={!free}
                      style={{ alignItems: 'flex-start', padding: '6px 8px', border: '1px solid #f0e6da', borderRadius: 8, marginInlineEnd: 0 }}
                    >
                      <Space direction="vertical" size={2}>
                        <Space size={6} wrap>
                          <Typography.Text strong>{venueTitle(venue, i18n.language)}</Typography.Text>
                          {venue.id === currentVenueId ? <Tag color="blue">{t('reservations.reschedule.keepVenue')}</Tag> : null}
                          {!free ? <Tag color="default">{t(`reservations.booking.slot.${slot.status}`)}</Tag> : null}
                          {!venue.rules.bookableOnline ? <Tag>{t('reservations.phoneOnly')}</Tag> : null}
                        </Space>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {translate(venue.typeName, i18n.language)} · {t('reservations.capacityRange', { min: venue.capacityMin, max: venue.capacityMax })}
                          {venue.deposit ? ` · ${t('reservations.fields.deposit')} ${formatMoney(venue.deposit, i18n.language)}` : ''}
                          {free ? ` · ${t('reservations.booking.until', { time: formatInTz(new Date(slot.end).toISOString(), tz, 'HH:mm') })}` : ''}
                        </Typography.Text>
                        {free && slot.belowMinimum ? (
                          <Typography.Text type="warning" style={{ fontSize: 12 }}>
                            {t('reservations.booking.belowMinimum', { min: venue.capacityMin })}
                          </Typography.Text>
                        ) : null}
                      </Space>
                    </Radio>
                  );
                })}
              </Flex>
            </div>
          ))}
        </Flex>
      </Radio.Group>
    </div>
  );
}
