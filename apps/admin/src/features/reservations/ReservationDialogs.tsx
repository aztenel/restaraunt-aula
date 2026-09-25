/**
 * Диалоги действий над бронью: отмена (причина + решение по депозиту с объяснением правила),
 * подтверждение без депозита (причина отказа), перенос / пересадка (место, дата, время, длительность, гости).
 * Ошибки сервера показываются в диалоге (текст по коду: занято, не вмещает, вне часов работы...).
 */
import { Alert, Button, Col, DatePicker, Flex, Form, Input, InputNumber, Modal, Radio, Row, Space, TimePicker, Typography } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney, toApiError, type ApiError } from '@aula/api-client';
import { errorFieldMessages, errorMessage } from '@/shared/api/errors';
import { tx } from '@/shared/i18n/tx';
import { dayjs } from '@/shared/lib/dates';
import { reservationKeys, reservationsApi } from './api';
import { toReschedulePayload, WAIVE_REASON_MAX, type RescheduleFormValues } from './booking-form';
import { formatInTz, formatLocalDate, venueTitle } from './format';
import {
  CANCEL_REASON_MAX,
  cancelDepositPolicy,
  expectedDepositOutcome,
  overridesPolicy,
  toCancelPayload,
  validateCancel,
  type CancelDepositChoice,
} from './reservation-actions';
import type { ReservationDetail } from './types';
import { useSlotAvailability, VenuePicker } from './VenuePicker';

/** Ошибка сервера внутри диалога: текст по коду, поля валидации, requestId. */
export function InlineApiError({ error }: { error: unknown }) {
  const { i18n } = useTranslation();
  if (!error) return null;
  const apiError = toApiError(error);
  const fields = errorFieldMessages(apiError);
  return (
    <Alert
      type="error"
      showIcon
      style={{ marginBottom: 12 }}
      message={errorMessage(apiError, i18n.language)}
      description={
        fields.length > 0 || apiError.requestId ? (
          <>
            {fields.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {fields.slice(0, 6).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : null}
            {apiError.requestId ? <div style={{ fontSize: 12, opacity: 0.7 }}>requestId: {apiError.requestId}</div> : null}
          </>
        ) : undefined
      }
    />
  );
}

/** После действия: карточка из ответа сервера, списки и календарь — заново. */
export function useApplyDetail() {
  const queryClient = useQueryClient();
  return (detail: ReservationDetail) => {
    queryClient.setQueryData(reservationKeys.detail(detail.id), detail);
    void queryClient.invalidateQueries({ queryKey: reservationKeys.all });
  };
}

const QUICK_REASONS = ['guest', 'duplicate', 'unreachable', 'venue'] as const;

export function CancelReservationModal({
  reservation,
  tz,
  open,
  onClose,
  onDone,
}: {
  reservation: ReservationDetail;
  tz: string;
  open: boolean;
  onClose: () => void;
  onDone: (detail: ReservationDetail) => void;
}) {
  const { t, i18n } = useTranslation();
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState<CancelDepositChoice>('policy');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const policy = cancelDepositPolicy(reservation);
  const issues = validateCancel({ reason });
  const deadline = formatInTz(policy.deadline, tz);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setDecision('policy');
    setTouched(false);
    setError(null);
  }, [open]);

  const submit = async () => {
    setTouched(true);
    if (issues.reason) return;
    setSaving(true);
    setError(null);
    try {
      onDone(await reservationsApi.cancel(reservation.id, toCancelPayload({ reason, decision }, policy)));
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const outcomeText = (outcome: string) => tx(t, `reservations.depositOutcomes.${outcome}`, outcome);

  return (
    <Modal
      open={open}
      title={t('reservations.cancel.title', { number: reservation.number })}
      onCancel={onClose}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>{t('common.close')}</Button>
          <Button danger type="primary" loading={saving} onClick={() => void submit()}>
            {t('reservations.cancel.submit')}
          </Button>
        </Space>
      }
    >
      <InlineApiError error={error} />
      <Form layout="vertical" requiredMark="optional">
        <Form.Item
          label={t('reservations.fields.reason')}
          required
          validateStatus={touched && issues.reason ? 'error' : undefined}
          help={touched && issues.reason ? t(`reservations.cancel.issues.${issues.reason}`) : undefined}
        >
          <Input.TextArea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={CANCEL_REASON_MAX}
            showCount
            placeholder={t('reservations.cancel.reasonPlaceholder')}
            autoFocus
          />
        </Form.Item>
        <Flex gap={6} wrap style={{ marginTop: -8, marginBottom: 16 }}>
          {QUICK_REASONS.map((key) => (
            <Button key={key} size="small" onClick={() => setReason(t(`reservations.cancel.quick.${key}`))}>
              {t(`reservations.cancel.quick.${key}`)}
            </Button>
          ))}
        </Flex>
        {policy.case === 'paid' && reservation.deposit ? (
          <>
            <Alert
              type={policy.beforeDeadline ? 'info' : 'warning'}
              showIcon
              message={t('reservations.cancel.depositTitle', { amount: formatMoney(reservation.deposit, i18n.language) })}
              description={
                policy.beforeDeadline
                  ? t('reservations.detail.policyBefore', { deadline, hours: policy.deadlineHours })
                  : t('reservations.detail.policyAfter', { deadline, hours: policy.deadlineHours })
              }
              style={{ marginBottom: 12 }}
            />
            <Form.Item label={t('reservations.cancel.decision')}>
              <Radio.Group value={decision} onChange={(e) => setDecision(e.target.value as CancelDepositChoice)}>
                <Space direction="vertical">
                  <Radio value="policy">{t('reservations.cancel.policy', { outcome: outcomeText(policy.policyOutcome) })}</Radio>
                  <Radio value="refund">{t('reservations.cancel.refund')}</Radio>
                  <Radio value="retain">{t('reservations.cancel.retain')}</Radio>
                </Space>
              </Radio.Group>
            </Form.Item>
            <Typography.Paragraph>
              {t('reservations.cancel.expected', { outcome: outcomeText(expectedDepositOutcome(policy, decision)) })}
            </Typography.Paragraph>
            {overridesPolicy(policy, decision) ? <Alert type="warning" showIcon message={t('reservations.cancel.override')} /> : null}
          </>
        ) : null}
        {policy.case === 'pending_payment' ? <Alert type="info" showIcon message={t('reservations.cancel.pendingPayment')} /> : null}
      </Form>
    </Modal>
  );
}

export function WaiveDepositModal({
  reservation,
  open,
  onClose,
  onDone,
}: {
  reservation: ReservationDetail;
  open: boolean;
  onClose: () => void;
  onDone: (detail: ReservationDetail) => void;
}) {
  const { t, i18n } = useTranslation();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setTouched(false);
    setError(null);
  }, [open]);

  const trimmed = reason.trim();
  const submit = async () => {
    setTouched(true);
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      onDone(await reservationsApi.confirm(reservation.id, { waiveDepositReason: trimmed }));
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('reservations.waive.title')}
      onCancel={onClose}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>{t('common.close')}</Button>
          <Button type="primary" loading={saving} onClick={() => void submit()}>
            {t('reservations.waive.submit')}
          </Button>
        </Space>
      }
    >
      <InlineApiError error={error} />
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message={t('reservations.waive.text', { amount: reservation.deposit ? formatMoney(reservation.deposit, i18n.language) : '—' })}
      />
      <Form layout="vertical">
        <Form.Item
          label={t('reservations.waive.reason')}
          required
          validateStatus={touched && !trimmed ? 'error' : undefined}
          help={touched && !trimmed ? t('reservations.booking.issues.waive_reason_required') : undefined}
        >
          <Input.TextArea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={WAIVE_REASON_MAX}
            showCount
            placeholder={t('reservations.waive.reasonPlaceholder')}
            autoFocus
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function RescheduleModal({
  reservation,
  tz,
  open,
  onClose,
  onDone,
}: {
  reservation: ReservationDetail;
  tz: string;
  open: boolean;
  onClose: () => void;
  onDone: (detail: ReservationDetail) => void;
}) {
  const { t, i18n } = useTranslation();
  const [form] = Form.useForm<RescheduleFormValues>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [nothing, setNothing] = useState(false);
  const values = Form.useWatch([], form) as RescheduleFormValues | undefined;
  const current = {
    venueId: reservation.venue.id,
    date: reservation.date,
    time: reservation.time,
    durationMinutes: reservation.durationMinutes,
    guests: reservation.guests,
  };
  const slot = useSlotAvailability(reservation.branchId, {
    date: values?.date ?? current.date,
    time: values?.time ?? current.time,
    guests: values?.guests ?? current.guests,
    durationMinutes: values?.durationMinutes ?? current.durationMinutes,
    excludeReservationId: reservation.id,
  });

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({ ...current, reason: '' });
    setError(null);
    setNothing(false);
  }, [open, reservation.id]);

  const submit = async () => {
    const payload = toReschedulePayload(form.getFieldsValue(), current);
    if (!payload) {
      setNothing(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onDone(await reservationsApi.reschedule(reservation.id, payload));
    } catch (e) {
      const apiError = toApiError(e);
      setError(apiError);
      if (apiError.code === 'reservation.venue_occupied') slot.refetch();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      width={720}
      title={t('reservations.reschedule.title', { number: reservation.number })}
      onCancel={onClose}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>{t('common.close')}</Button>
          <Button type="primary" loading={saving} onClick={() => void submit()}>
            {t('reservations.reschedule.submit')}
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">{t('reservations.reschedule.hint')}</Typography.Paragraph>
      <Typography.Paragraph>
        {t('reservations.reschedule.current', {
          when: `${formatLocalDate(reservation.date, 'DD.MM.YYYY')} ${reservation.time}–${formatInTz(reservation.end, tz, 'HH:mm')}`,
          venue: venueTitle(reservation.venue, i18n.language),
          guests: t('reservations.guestsCount', { count: reservation.guests }),
        })}
      </Typography.Paragraph>
      <InlineApiError error={error} />
      {nothing ? <Alert type="info" showIcon message={t('reservations.reschedule.nothing')} style={{ marginBottom: 12 }} /> : null}
      <Form<RescheduleFormValues> form={form} layout="vertical" onValuesChange={() => setNothing(false)}>
        <Row gutter={12}>
          <Col xs={12} sm={6}>
            <Form.Item
              name="date"
              label={t('reservations.fields.date')}
              getValueProps={(v: string | null) => ({ value: v ? dayjs(v) : null })}
              normalize={(d: Dayjs | null) => (d ? d.format('YYYY-MM-DD') : null)}
            >
              <DatePicker format="DD.MM.YYYY" allowClear={false} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={6}>
            <Form.Item
              name="time"
              label={t('reservations.fields.time')}
              getValueProps={(v: string | null) => ({ value: v ? dayjs(`2000-01-01T${v}`) : null })}
              normalize={(d: Dayjs | null) => (d ? d.format('HH:mm') : null)}
            >
              <TimePicker format="HH:mm" minuteStep={15} allowClear={false} needConfirm={false} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={6}>
            <Form.Item name="durationMinutes" label={t('reservations.fields.duration')}>
              <InputNumber min={15} max={1440} step={15} addonAfter={t('venues.rules.minutesUnit')} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={6}>
            <Form.Item name="guests" label={t('reservations.fields.guests')}>
              <InputNumber min={1} max={1000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="venueId" label={t('reservations.fields.venue')}>
          <VenuePicker
            availability={slot.availability}
            loading={slot.loading}
            error={slot.error}
            onRetry={slot.refetch}
            tz={tz}
            currentVenueId={reservation.venue.id}
            onPickTime={(time) => form.setFieldValue('time', time)}
          />
        </Form.Item>
        <Form.Item name="reason" label={t('reservations.reschedule.reason')}>
          <Input maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
