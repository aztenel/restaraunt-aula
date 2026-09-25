import { Alert, Col, DatePicker, Form, Modal, Row, Select, Space, Tag, TimePicker, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { translate, toApiError } from '@aula/api-client';
import { errorMessage } from '@/shared/api/errors';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { dayjs, toDisplay } from '@/shared/lib/dates';
import { banquetsApi, banquetsKeys } from '../api';
import { addDays, cellKey, occupancyByVenueDay, overlaps, splitOccupancy } from '../calendar-layout';
import type { BanquetRequestDetail } from '../types';
import { useRequestMutation } from './useRequestMutation';

interface Values {
  date: Dayjs | null;
  start: Dayjs | null;
  end: Dayjs | null;
  venueId: string | null;
}

const CONFLICT_CODES = ['reservation.venue_occupied', 'reservation.concurrent_change'];

/**
 * Зал и время банкета в филиале. Занятость ставится сразу в модуле бронирования (вид брони banquet):
 * занятый зал — 409, текст показывается прямо в окне. Список залов и их занятость — из календаря филиала.
 */
export function VenueHoldModal({ open, request, onClose }: { open: boolean; request: BanquetRequestDetail; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const notifyError = useNotifyError();
  const [form] = Form.useForm<Values>();
  const [conflict, setConflict] = useState<string | null>(null);
  const date = Form.useWatch('date', form);
  const start = Form.useWatch('start', form);
  const end = Form.useWatch('end', form);
  const venueId = Form.useWatch('venueId', form);
  const branchId = request.branchId ?? '';
  const day = date ? date.format('YYYY-MM-DD') : request.eventDate;
  const params = { branchId, from: day, to: addDays(day, 1) };
  const calendar = useApiQuery(banquetsKeys.calendar(params), () => banquetsApi.calendar(params), { enabled: open && Boolean(branchId), keepPrevious: true });

  const setVenue = useRequestMutation(
    (values: { venueId: string; date: string; startTime: string; endTime: string }) => banquetsApi.setVenue(request.id, values),
    { errorTitle: false, successMessage: t('banquets.venue.saved') },
  );

  useEffect(() => {
    if (!open) return;
    setConflict(null);
    const holdStart = request.venue ? toDisplay(request.venue.start) : null;
    const holdEnd = request.venue ? toDisplay(request.venue.end) : null;
    const startTime = holdStart?.format('HH:mm') ?? request.eventTime ?? '18:00';
    form.setFieldsValue({
      date: dayjs(holdStart?.format('YYYY-MM-DD') ?? request.eventDate),
      start: dayjs(`2000-01-01T${startTime}`),
      end: holdEnd ? dayjs(`2000-01-01T${holdEnd.format('HH:mm')}`) : dayjs(`2000-01-01T${startTime}`).add(5, 'hour'),
      venueId: request.venue?.venueId ?? null,
    });
  }, [open, request, form]);

  // Занятость по залам на выбранный и следующий день (без собственной занятости этой заявки).
  const cells = useMemo(() => {
    const own = request.venue?.reservationId;
    const items = (calendar.data?.occupancy ?? []).filter((o) => o.reservationId !== own);
    return occupancyByVenueDay(splitOccupancy(items));
  }, [calendar.data, request.venue]);

  const startMin = start ? start.hour() * 60 + start.minute() : null;
  const endMin = end ? end.hour() * 60 + end.minute() : null;
  const busyAt = (id: string): boolean => {
    if (startMin === null || endMin === null) return false;
    const today = cells.get(cellKey(id, day)) ?? [];
    if (endMin > startMin) return overlaps(today, startMin, endMin);
    const next = cells.get(cellKey(id, addDays(day, 1))) ?? [];
    return overlaps(today, startMin, 1440) || overlaps(next, 0, endMin);
  };

  const options = (calendar.data?.venues ?? []).map((v) => {
    const segments = cells.get(cellKey(v.id, day)) ?? [];
    const tooSmall = v.capacityMax < request.guests;
    return {
      value: v.id,
      disabled: !v.isActive,
      label: `${translate(v.hallName, i18n.language)} · ${translate(v.name, i18n.language)}`,
      venue: v,
      segments,
      tooSmall,
    };
  });

  const submit = async () => {
    const values = await form.validateFields();
    if (!values.venueId || !values.date || !values.start || !values.end) return;
    setConflict(null);
    try {
      await setVenue.mutateAsync({
        venueId: values.venueId,
        date: values.date.format('YYYY-MM-DD'),
        startTime: values.start.format('HH:mm'),
        endTime: values.end.format('HH:mm'),
      });
      onClose();
    } catch (error) {
      const apiError = toApiError(error);
      if (CONFLICT_CODES.includes(apiError.code) || apiError.status === 409) setConflict(errorMessage(apiError, i18n.language));
      else notifyError(error);
    }
  };

  const selected = options.find((o) => o.value === venueId);
  const overlapHint = venueId ? busyAt(venueId) : false;
  const req = { required: true, message: t('common.required') };

  return (
    <Modal
      open={open}
      title={t('banquets.venue.modalTitle')}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      onOk={() => void submit()}
      onCancel={onClose}
      confirmLoading={setVenue.isPending}
      width={680}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">{t('banquets.venue.syncHint')}</Typography.Paragraph>
      {conflict ? <Alert type="error" showIcon message={t('banquets.venue.conflict')} description={conflict} style={{ marginBottom: 12 }} /> : null}
      <Form<Values> form={form} layout="vertical" requiredMark="optional" onValuesChange={() => setConflict(null)}>
        <Row gutter={12}>
          <Col xs={24} sm={10}>
            <Form.Item name="date" label={t('banquets.venue.date')} rules={[req]}>
              <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} allowClear={false} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={7}>
            <Form.Item name="start" label={t('banquets.venue.start')} rules={[req]}>
              <TimePicker format="HH:mm" minuteStep={15} style={{ width: '100%' }} needConfirm={false} allowClear={false} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={7}>
            <Form.Item
              name="end"
              label={t('banquets.venue.end')}
              rules={[req]}
              extra={startMin !== null && endMin !== null && endMin <= startMin ? t('banquets.venue.endHint') : undefined}
            >
              <TimePicker format="HH:mm" minuteStep={15} style={{ width: '100%' }} needConfirm={false} allowClear={false} />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="venueId" label={t('banquets.venue.venue')} rules={[{ required: true, message: t('banquets.venue.required') }]}>
              <Select
                loading={calendar.isFetching}
                showSearch
                optionFilterProp="label"
                options={options}
                optionRender={(option) => {
                  const data = option.data as (typeof options)[number];
                  const busy = data.segments.map((s) => s.label);
                  return (
                    <Space direction="vertical" size={0} style={{ width: '100%' }}>
                      <Space wrap size={4}>
                        <span>{data.label}</span>
                        <Tag style={{ marginInlineEnd: 0 }}>{t('banquets.venue.capacity', { min: data.venue.capacityMin, max: data.venue.capacityMax })}</Tag>
                        {!data.venue.isActive ? <Tag>{t('banquets.venue.inactive')}</Tag> : null}
                        {data.tooSmall ? <Tag color="orange">{t('banquets.venue.tooSmall', { guests: request.guests })}</Tag> : null}
                        {busyAt(data.value) ? <Tag color="red">{t('banquets.venue.overlapHint')}</Tag> : null}
                      </Space>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {busy.length > 0 ? t('banquets.venue.busy', { intervals: busy.join(', ') }) : t('banquets.venue.free')}
                      </Typography.Text>
                    </Space>
                  );
                }}
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>
      {selected?.tooSmall ? <Alert type="warning" showIcon message={t('banquets.venue.tooSmall', { guests: request.guests })} style={{ marginBottom: 8 }} /> : null}
      {overlapHint ? <Alert type="warning" showIcon message={t('banquets.venue.overlapHint')} /> : null}
    </Modal>
  );
}
