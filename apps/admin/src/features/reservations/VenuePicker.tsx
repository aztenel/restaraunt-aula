/**
 * Выбор места для брони оператором и переноса: свободные на выбранное время места от сервера
 * (GET /admin/reservations/availability — включая места «только по телефону», без ограничений витрины).
 * Мест нет — причина и ближайшее свободное время (кнопкой подставляется в форму).
 */
import { Alert, Button, Empty, Flex, Radio, Space, Spin, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { formatMoney, translate } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { reservationKeys, reservationsApi } from './api';
import { alternativeOptions, availabilityQuery, slotsByHall, type SlotParams } from './availability';
import { formatInTz, venueTitle } from './format';
import type { AdminAvailability } from './types';

export type { SlotParams };

/** Свободные места филиала на выбранное время (сервер). */
export function useSlotAvailability(branchId: string, params: SlotParams) {
  const query = availabilityQuery(branchId, params);
  const availability = useApiQuery(reservationKeys.availability(query ?? { branchId, date: '', time: '', guests: 0 }), () => reservationsApi.availability(query!), {
    enabled: query !== null,
    keepPrevious: true,
    staleTime: 15_000,
  });
  const data = query && availability.data ? availability.data : null;
  return {
    availability: data,
    /** Ответ ещё не для текущих параметров (идёт запрос). */
    loading: availability.isFetching,
    error: availability.error,
    ready: query !== null,
    refetch: () => void availability.refetch(),
  };
}

export function VenuePicker({
  availability,
  loading,
  error,
  value,
  onChange,
  tz,
  currentVenueId,
  onPickTime,
  onRetry,
}: {
  availability: AdminAvailability | null;
  loading?: boolean;
  error?: unknown;
  value?: string | null;
  onChange?: (venueId: string) => void;
  tz: string;
  /** Текущее место брони (перенос). */
  currentVenueId?: string;
  /** Подставить ближайшее свободное время. */
  onPickTime?: (time: string) => void;
  onRetry?: () => void;
}) {
  const { t, i18n } = useTranslation();
  if (error) return <ErrorAlert error={error} onRetry={onRetry} />;
  if (!availability) return loading ? <Spin /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('reservations.booking.fillWhen')} />;
  const halls = slotsByHall(availability.venues);
  const alternatives = alternativeOptions(availability, currentVenueId);

  return (
    <Spin spinning={Boolean(loading)} delay={200}>
      {!availability.available ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          message={t(`reservations.booking.noFree.${availability.reason ?? 'occupied'}`)}
          description={
            alternatives.length > 0 ? (
              <Space direction="vertical" size={6}>
                <Typography.Text>{t('reservations.booking.alternatives')}</Typography.Text>
                <Flex gap={6} wrap>
                  {alternatives.map((a) => (
                    <Button key={`${a.date}-${a.time}`} size="small" onClick={() => onPickTime?.(a.time)} disabled={!onPickTime}>
                      {a.time} · {t('reservations.booking.alternativeVenues', { count: a.venues })}
                      {a.includesCurrent ? ` · ${t('reservations.reschedule.keepVenue')}` : ''}
                    </Button>
                  ))}
                </Flex>
              </Space>
            ) : undefined
          }
        />
      ) : (
        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
          {t('reservations.booking.serverChecked')}
        </Typography.Text>
      )}
      <Radio.Group value={value ?? null} onChange={(e) => onChange?.(e.target.value as string)} style={{ width: '100%' }}>
        <Flex vertical gap={12}>
          {halls.map((hall) => (
            <div key={hall.hallId}>
              <Typography.Text strong style={{ fontSize: 13 }}>
                {translate(hall.hallName, i18n.language)}
              </Typography.Text>
              <Flex vertical gap={6} style={{ marginTop: 6 }}>
                {hall.slots.map((slot) => (
                  <Radio
                    key={slot.venueId}
                    value={slot.venueId}
                    style={{ alignItems: 'flex-start', padding: '6px 8px', border: '1px solid #f0e6da', borderRadius: 8, marginInlineEnd: 0 }}
                  >
                    <Space direction="vertical" size={2}>
                      <Space size={6} wrap>
                        <Typography.Text strong>{venueTitle(slot, i18n.language)}</Typography.Text>
                        {slot.venueId === currentVenueId ? <Tag color="blue">{t('reservations.reschedule.keepVenue')}</Tag> : null}
                        {!slot.bookableOnline ? <Tag>{t('reservations.phoneOnly')}</Tag> : null}
                        {slot.rules.requiresManualConfirmation ? <Tag color="gold">{t('reservations.booking.manualConfirmation')}</Tag> : null}
                      </Space>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {translate(slot.typeName, i18n.language)} · {t('reservations.capacityRange', { min: slot.capacityMin, max: slot.capacityMax })}
                        {slot.deposit ? ` · ${t('reservations.fields.deposit')} ${formatMoney(slot.deposit, i18n.language)}` : ''}
                        {` · ${t('reservations.booking.until', { time: formatInTz(slot.end, tz, 'HH:mm') })}`}
                        {slot.blockedUntil !== slot.end ? ` · ${t('reservations.booking.cleanupUntil', { time: formatInTz(slot.blockedUntil, tz, 'HH:mm') })}` : ''}
                      </Typography.Text>
                      {slot.belowMinimum ? (
                        <Typography.Text type="warning" style={{ fontSize: 12 }}>
                          {t('reservations.booking.belowMinimum', { min: slot.capacityMin })}
                        </Typography.Text>
                      ) : null}
                    </Space>
                  </Radio>
                ))}
              </Flex>
            </div>
          ))}
        </Flex>
      </Radio.Group>
    </Spin>
  );
}
