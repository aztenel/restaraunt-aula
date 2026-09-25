/**
 * Бронь оператором по телефону: дата, время, гости, длительность; место — из свободных на это время
 * по серверу (GET /admin/reservations/availability, включая места «только по телефону»);
 * гость (телефон обязателен), пожелания, служебная заметка, язык уведомлений, согласия; депозит места —
 * ссылка на оплату гостю или отказ от депозита с причиной. Ошибки сервера — в форме.
 */
import { Alert, Button, Checkbox, Col, DatePicker, Divider, Drawer, Form, Input, InputNumber, Radio, Row, Select, Space, TimePicker, Typography } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney, Permission, toApiError, type ApiError } from '@aula/api-client';
import { useCan } from '@/shared/auth/useCan';
import { dayjs } from '@/shared/lib/dates';
import { reservationKeys, reservationsApi } from './api';
import {
  newIdempotencyKey,
  OCCASION_MAX,
  TEXT_MAX,
  toCreatePayload,
  validateBooking,
  WAIVE_REASON_MAX,
  type BookingErrors,
  type BookingFormValues,
} from './booking-form';
import type { BookingPrefill } from './hooks';
import { InlineApiError } from './ReservationDialogs';
import { todayIn } from './timeline-layout';
import type { ReservationDetail } from './types';
import { isVenueFree } from './availability';
import { useSlotAvailability, VenuePicker } from './VenuePicker';

export function BookingDrawer({
  open,
  branchId,
  tz,
  prefill,
  onClose,
  onCreated,
}: {
  open: boolean;
  branchId: string;
  tz: string;
  prefill: BookingPrefill;
  onClose: () => void;
  onCreated: (reservation: ReservationDetail) => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { can } = useCan();
  const [form] = Form.useForm<BookingFormValues>();
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [occupiedNotice, setOccupiedNotice] = useState(false);
  const values = (Form.useWatch([], form) ?? {}) as BookingFormValues;
  const canWaiveDeposit = can(Permission.ReservationsManage, branchId);

  const slot = useSlotAvailability(branchId, {
    date: values.date,
    time: values.time,
    guests: values.guests,
    durationMinutes: values.durationMinutes,
  });
  const selectedVenue = useMemo(() => slot.availability?.venues.find((v) => v.venueId === values.venueId) ?? null, [slot.availability, values.venueId]);
  const venueHasDeposit = Boolean(selectedVenue?.deposit);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({
      date: prefill.date ?? todayIn(tz),
      time: prefill.time ?? '19:00',
      guests: prefill.guests ?? 2,
      venueId: prefill.venueId ?? null,
      locale: i18n.language === 'kk' ? 'kk' : 'ru',
      depositMode: 'payment_link',
    });
    setIdempotencyKey(newIdempotencyKey());
    setError(null);
    setOccupiedNotice(false);
    // Заполнение формы — только при открытии (правки оператора не сбрасываются).
  }, [open, prefill, tz, form, i18n.language]);

  // Выбранное место перестало быть свободным после изменения времени или гостей — снять выбор.
  useEffect(() => {
    if (slot.loading || !slot.availability) return;
    if (values.venueId && !isVenueFree(slot.availability, values.venueId)) form.setFieldValue('venueId', null);
  }, [slot.availability, slot.loading, values.venueId, form]);

  const applyErrors = (errors: BookingErrors) => {
    form.setFields(
      (Object.keys(errors) as Array<keyof BookingFormValues>).map((name) => ({
        name,
        errors: [t(`reservations.booking.issues.${errors[name]!}`)],
      })),
    );
  };

  const submit = async () => {
    const current = form.getFieldsValue(true) as BookingFormValues;
    const errors = validateBooking(current, { venueHasDeposit, canWaiveDeposit });
    if (Object.keys(errors).length > 0) {
      applyErrors(errors);
      return;
    }
    setSaving(true);
    setError(null);
    setOccupiedNotice(false);
    try {
      const created = await reservationsApi.create(toCreatePayload(current, { branchId, venueHasDeposit, canWaiveDeposit, idempotencyKey }));
      queryClient.setQueryData(reservationKeys.detail(created.id), created);
      void queryClient.invalidateQueries({ queryKey: reservationKeys.all });
      onCreated(created);
    } catch (e) {
      const apiError = toApiError(e);
      setError(apiError);
      if (apiError.code === 'reservation.venue_occupied') {
        // Место заняли параллельно: обновить занятость, снять выбор, новая попытка — новый ключ.
        setOccupiedNotice(true);
        form.setFieldValue('venueId', null);
        setIdempotencyKey(newIdempotencyKey());
        slot.refetch();
        void queryClient.invalidateQueries({ queryKey: reservationKeys.timeline(branchId, current.date ?? '') });
      } else if (apiError.status >= 400 && apiError.status < 500 && apiError.code !== 'reservation.idempotency_conflict') {
        // Бронь не создана — следующая попытка с исправленными данными получает новый ключ.
        setIdempotencyKey(newIdempotencyKey());
      }
    } finally {
      setSaving(false);
    }
  };

  const holdMinutes = selectedVenue?.rules.holdMinutes ?? 0;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={880}
      destroyOnHidden
      title={t('reservations.booking.title')}
      extra={
        <Space>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="primary" loading={saving} onClick={() => void submit()}>
            {t('reservations.booking.submit')}
          </Button>
        </Space>
      }
    >
      <InlineApiError error={error} />
      {occupiedNotice ? <Alert type="warning" showIcon message={t('reservations.booking.occupiedRetry')} style={{ marginBottom: 12 }} /> : null}
      <Form<BookingFormValues> form={form} layout="vertical" requiredMark="optional" onValuesChange={() => setOccupiedNotice(false)}>
        <Row gutter={24}>
          <Col xs={24} lg={13}>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              {t('reservations.booking.when')}
            </Typography.Title>
            <Row gutter={12}>
              <Col xs={12} sm={7}>
                <Form.Item
                  name="date"
                  label={t('reservations.fields.date')}
                  required
                  getValueProps={(v: string | null) => ({ value: v ? dayjs(v) : null })}
                  normalize={(d: Dayjs | null) => (d ? d.format('YYYY-MM-DD') : null)}
                >
                  <DatePicker format="DD.MM.YYYY" allowClear={false} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={12} sm={5}>
                <Form.Item
                  name="time"
                  label={t('reservations.fields.time')}
                  required
                  getValueProps={(v: string | null) => ({ value: v ? dayjs(`2000-01-01T${v}`) : null })}
                  normalize={(d: Dayjs | null) => (d ? d.format('HH:mm') : null)}
                >
                  <TimePicker format="HH:mm" minuteStep={15} allowClear={false} needConfirm={false} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={12} sm={5}>
                <Form.Item name="guests" label={t('reservations.fields.guests')} required>
                  <InputNumber min={1} max={1000} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={12} sm={7}>
                <Form.Item name="durationMinutes" label={t('reservations.fields.duration')} tooltip={t('reservations.booking.durationHint')}>
                  <InputNumber
                    min={15}
                    max={1440}
                    step={15}
                    placeholder={selectedVenue ? String(selectedVenue.rules.durationMinutes) : t('reservations.booking.durationPlaceholder')}
                    addonAfter={t('venues.rules.minutesUnit')}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="venueId" label={t('reservations.booking.venue')} required>
              <VenuePicker
                availability={slot.availability}
                loading={slot.loading}
                error={slot.error}
                onRetry={slot.refetch}
                tz={tz}
                onPickTime={(time) => form.setFieldValue('time', time)}
              />
            </Form.Item>
          </Col>
          <Col xs={24} lg={11}>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              {t('reservations.booking.guest')}
            </Typography.Title>
            <Form.Item name="phone" label={t('reservations.fields.phone')} required>
              <Input inputMode="tel" autoComplete="off" placeholder={t('reservations.booking.phonePlaceholder')} maxLength={32} />
            </Form.Item>
            <Form.Item name="name" label={t('reservations.fields.name')}>
              <Input maxLength={100} autoComplete="off" />
            </Form.Item>
            <Form.Item name="email" label={t('reservations.fields.email')}>
              <Input type="email" maxLength={200} autoComplete="off" />
            </Form.Item>
            <Form.Item name="locale" label={t('reservations.fields.locale')}>
              <Select
                options={[
                  { value: 'ru', label: t('reservations.locales.ru') },
                  { value: 'kk', label: t('reservations.locales.kk') },
                ]}
              />
            </Form.Item>
            <Form.Item name="consentPersonalData" valuePropName="checked" style={{ marginBottom: 4 }}>
              <Checkbox>{t('reservations.booking.consentPersonalData')}</Checkbox>
            </Form.Item>
            <Form.Item name="consentMarketing" valuePropName="checked">
              <Checkbox>{t('reservations.booking.consentMarketing')}</Checkbox>
            </Form.Item>

            {venueHasDeposit && selectedVenue?.deposit ? (
              <>
                <Divider orientation="left" plain>
                  {t('reservations.booking.depositTitle', { amount: formatMoney(selectedVenue.deposit, i18n.language) })}
                </Divider>
                <Form.Item name="depositMode">
                  <Radio.Group>
                    <Space direction="vertical">
                      <Radio value="payment_link">
                        {t('reservations.booking.depositLink')}
                        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                          {t('reservations.booking.depositLinkHint', { minutes: holdMinutes })}
                        </Typography.Text>
                      </Radio>
                      <Radio value="waive" disabled={!canWaiveDeposit}>
                        {t('reservations.booking.depositWaive')}
                        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                          {canWaiveDeposit ? t('reservations.booking.waiveHint') : t('reservations.booking.issues.waive_not_allowed')}
                        </Typography.Text>
                      </Radio>
                    </Space>
                  </Radio.Group>
                </Form.Item>
                {values.depositMode === 'waive' ? (
                  <Form.Item name="waiveReason" label={t('reservations.booking.waiveReason')} required>
                    <Input.TextArea rows={2} maxLength={WAIVE_REASON_MAX} showCount />
                  </Form.Item>
                ) : null}
              </>
            ) : null}

            <Divider orientation="left" plain>
              {t('reservations.booking.extra')}
            </Divider>
            <Form.Item name="occasion" label={t('reservations.fields.occasion')}>
              <Input maxLength={OCCASION_MAX} />
            </Form.Item>
            <Form.Item name="comment" label={t('reservations.fields.comment')}>
              <Input.TextArea rows={2} maxLength={TEXT_MAX} />
            </Form.Item>
            <Form.Item name="note" label={t('reservations.fields.note')} extra={t('reservations.fields.noteHint')}>
              <Input.TextArea rows={2} maxLength={TEXT_MAX} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Drawer>
  );
}
