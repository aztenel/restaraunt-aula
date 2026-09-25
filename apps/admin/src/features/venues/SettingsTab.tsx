/**
 * Настройки бронирования филиала: напоминание гостю за N часов, упреждение и горизонт брони на сайте,
 * текст правил брони и отмены. Изменять — venues.manage в филиале.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Col, Form, InputNumber, Row, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Permission } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { useCan } from '@/shared/auth/useCan';
import { formatDateTime } from '@/shared/lib/dates';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageLoader } from '@/shared/ui/PageLoader';
import { TranslatableInput } from '@/shared/ui/TranslatableInput';
import { SingleBranchGate } from '../reservations/SingleBranchGate';
import { venueConfigApi, venueKeys } from './api';
import { formToSettings, SETTINGS_LIMITS, settingsToForm, type SettingsFormValues } from './venue-form';

export function SettingsTab() {
  const { t } = useTranslation();
  return (
    <SingleBranchGate
      permissions={[Permission.VenuesManage]}
      title={t('venues.branchRequired.title')}
      text={t('venues.branchRequired.text')}
      none={t('venues.branchRequired.none')}
    >
      {(branchId) => <SettingsForm key={branchId} branchId={branchId} />}
    </SingleBranchGate>
  );
}

function SettingsForm({ branchId }: { branchId: string }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const { can } = useCan();
  const canEdit = can(Permission.VenuesManage, branchId);
  const settings = useApiQuery(venueKeys.settings(branchId), () => venueConfigApi.settings(branchId));
  const [form] = Form.useForm<SettingsFormValues>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings.data) form.setFieldsValue(settingsToForm(settings.data));
  }, [settings.data, form]);

  const submit = async () => {
    let values: SettingsFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const saved = await venueConfigApi.saveSettings(branchId, formToSettings(values));
      queryClient.setQueryData(venueKeys.settings(branchId), saved);
      void message.success(t('common.saved'));
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  if (settings.error) return <ErrorAlert error={settings.error} onRetry={() => void settings.refetch()} />;
  if (!settings.data) return <PageLoader />;
  const [remMin, remMax] = SETTINGS_LIMITS.reminderHoursBefore;
  const [leadMin, leadMax] = SETTINGS_LIMITS.minLeadMinutes;
  const [daysMin, daysMax] = SETTINGS_LIMITS.maxDaysAhead;

  return (
    <Card
      title={t('venues.tabs.settings')}
      extra={
        canEdit ? (
          <Button type="primary" loading={saving} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        ) : null
      }
    >
      {!canEdit ? <Alert type="info" showIcon message={t('venues.readOnly')} style={{ marginBottom: 12 }} /> : null}
      <Form<SettingsFormValues> form={form} layout="vertical" disabled={!canEdit} style={{ maxWidth: 820 }}>
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item
              name="reminderHoursBefore"
              label={t('venues.settings.reminderHoursBefore')}
              extra={t('venues.settings.reminderHint')}
              rules={[{ required: true, type: 'integer', min: remMin, max: remMax }]}
            >
              <InputNumber min={remMin} max={remMax} precision={0} addonAfter={t('venues.settings.hoursUnit')} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item
              name="minLeadMinutes"
              label={t('venues.settings.minLeadMinutes')}
              rules={[{ required: true, type: 'integer', min: leadMin, max: leadMax }]}
            >
              <InputNumber min={leadMin} max={leadMax} precision={0} step={15} addonAfter={t('venues.settings.minutesUnit')} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="maxDaysAhead" label={t('venues.settings.maxDaysAhead')} rules={[{ required: true, type: 'integer', min: daysMin, max: daysMax }]}>
              <InputNumber min={daysMin} max={daysMax} precision={0} addonAfter={t('venues.settings.daysUnit')} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="policyText" label={t('venues.settings.policyText')} extra={t('venues.settings.policyHint')}>
          <TranslatableInput multiline rows={5} maxLength={4000} />
        </Form.Item>
      </Form>
      {settings.data.updatedAt ? (
        <Typography.Text type="secondary">{t('venues.settings.updatedAt', { date: formatDateTime(settings.data.updatedAt) })}</Typography.Text>
      ) : null}
    </Card>
  );
}
