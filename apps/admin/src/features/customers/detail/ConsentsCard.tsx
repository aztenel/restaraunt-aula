import { CheckCircleTwoTone, CloseCircleTwoTone, SafetyOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Empty, Form, Modal, Radio, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiMutation, useApiQuery } from '@/shared/api/hooks';
import { formatDateTime } from '@/shared/lib/dates';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { customerKeys, customersApi } from '../api';
import {
  consentState,
  currentText,
  toRecordConsentBody,
  validateStaffConsent,
  versionsOf,
  type StaffConsentErrors,
  type StaffConsentValues,
} from '../consent-form';
import { CONSENT_KINDS, STAFF_CONSENT_SOURCES, type ConsentRecord, type Customer } from '../types';

function ConsentStatus({ customer, kind }: { customer: Customer; kind: (typeof CONSENT_KINDS)[number] }) {
  const { t } = useTranslation();
  const state = consentState(customer, kind);
  return (
    <Space size={6} wrap>
      {state.granted ? <CheckCircleTwoTone twoToneColor="#52c41a" /> : <CloseCircleTwoTone twoToneColor="#bfbfbf" />}
      <Typography.Text strong>{state.granted ? t('customers.consents.granted') : t('customers.consents.notGranted')}</Typography.Text>
      {state.version ? <Typography.Text type="secondary">{t('customers.consents.version', { version: state.version })}</Typography.Text> : null}
      {state.at ? <Typography.Text type="secondary">{t('customers.consents.at', { date: formatDateTime(state.at) })}</Typography.Text> : null}
    </Space>
  );
}

/** Согласия гостя: текущее состояние, история (новые сверху), фиксация согласия сотрудником (customers.manage). */
export function ConsentsCard({ customer, consents, editable }: { customer: Customer; consents: ConsentRecord[]; editable: boolean }) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  return (
    <Card
      title={t('customers.consents.title')}
      extra={
        editable ? (
          <Button icon={<SafetyOutlined />} onClick={() => setRecording(true)}>
            {t('customers.consents.record')}
          </Button>
        ) : null
      }
    >
      <Descriptions
        size="small"
        column={1}
        items={CONSENT_KINDS.map((kind) => ({ key: kind, label: t(`customers.consents.kind.${kind}`), children: <ConsentStatus customer={customer} kind={kind} /> }))}
      />
      <Typography.Title level={5} style={{ marginTop: 16 }}>
        {t('customers.consents.history')}
      </Typography.Title>
      {consents.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('customers.consents.noHistory')} />
      ) : (
        <Table<ConsentRecord>
          rowKey="id"
          size="small"
          pagination={consents.length > 10 ? { pageSize: 10 } : false}
          scroll={{ x: 'max-content' }}
          dataSource={consents}
          columns={[
            { title: t('customers.consents.columns.recordedAt'), key: 'recordedAt', render: (_, r) => formatDateTime(r.recordedAt) },
            { title: t('customers.consents.columns.kind'), key: 'kind', render: (_, r) => t(`customers.consents.kind.${r.kind}`) },
            {
              title: t('customers.consents.columns.action'),
              key: 'action',
              render: (_, r) => (
                <Tag color={r.granted ? 'success' : 'default'}>{r.granted ? t('customers.consents.action.granted') : t('customers.consents.action.withdrawn')}</Tag>
              ),
            },
            { title: t('customers.consents.columns.version'), key: 'version', render: (_, r) => <Typography.Text code>{r.textVersion}</Typography.Text> },
            { title: t('customers.consents.columns.source'), key: 'source', render: (_, r) => t(`customers.consents.source.${r.source}`) },
            { title: t('customers.consents.columns.ip'), key: 'ip', render: (_, r) => r.ip ?? '—' },
          ]}
        />
      )}
      {recording ? <RecordConsentModal customer={customer} onClose={() => setRecording(false)} /> : null}
    </Card>
  );
}

function RecordConsentModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [form] = Form.useForm<StaffConsentValues>();
  const texts = useApiQuery(customerKeys.consentTexts, () => customersApi.consentTexts());
  const kind = Form.useWatch('kind', form);
  const version = Form.useWatch('textVersion', form);
  const all = texts.data ?? [];
  const versions = versionsOf(kind, all);
  const current = currentText(kind, all);
  const shown = versions.find((text) => text.version === version) ?? current;

  const record = useApiMutation((values: StaffConsentValues) => customersApi.recordConsent(customer.id, toRecordConsentBody(values)), {
    invalidate: [customerKeys.all],
    successMessage: t('customers.consents.modal.saved'),
    onSuccess: () => onClose(),
  });

  const fieldRule = (field: keyof StaffConsentErrors) => ({
    validator: async () => {
      const issue = validateStaffConsent(form.getFieldsValue(true), all)[field];
      if (issue) throw new Error(t(`customers.consents.modal.issues.${issue}`));
    },
  });

  return (
    <Modal
      open
      width={680}
      title={t('customers.consents.modal.title')}
      okText={t('customers.consents.modal.submit')}
      okButtonProps={{ loading: record.isPending, disabled: texts.isLoading }}
      cancelText={t('common.cancel')}
      onCancel={onClose}
      onOk={() =>
        void form
          .validateFields()
          .then(() => record.mutateAsync(form.getFieldsValue(true)))
          .catch(() => undefined)
      }
      destroyOnHidden
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('customers.consents.modal.hint')} />
      {texts.error ? <ErrorAlert error={texts.error} onRetry={() => void texts.refetch()} /> : null}
      <Form<StaffConsentValues> form={form} layout="vertical" requiredMark={false} initialValues={{ kind: 'personal_data', granted: true, source: 'admin' }}>
        <Form.Item name="kind" label={t('customers.consents.modal.kind')} rules={[fieldRule('kind')]}>
          <Radio.Group
            onChange={() => {
              form.setFieldValue('textVersion', undefined);
              void form.validateFields(['textVersion']).catch(() => undefined);
            }}
            options={CONSENT_KINDS.map((value) => ({ value, label: t(`customers.consents.kind.${value}`) }))}
          />
        </Form.Item>
        <Form.Item name="granted" label={t('customers.consents.modal.action')} rules={[fieldRule('granted')]}>
          <Radio.Group
            options={[
              { value: true, label: t('customers.consents.modal.grant') },
              { value: false, label: t('customers.consents.modal.withdraw') },
            ]}
          />
        </Form.Item>
        <Form.Item name="source" label={t('customers.consents.modal.source')} rules={[fieldRule('source')]}>
          <Radio.Group options={STAFF_CONSENT_SOURCES.map((value) => ({ value, label: t(`customers.consents.source.${value}`) }))} />
        </Form.Item>
        <Form.Item name="textVersion" label={t('customers.consents.modal.version')} rules={[fieldRule('textVersion')]}>
          <Select
            allowClear
            loading={texts.isLoading}
            placeholder={current ? t('customers.consents.modal.versionCurrent', { version: current.version }) : undefined}
            options={versions.map((text) => ({
              value: text.version,
              label: text.isCurrent ? t('customers.consents.modal.versionCurrent', { version: text.version }) : text.version,
            }))}
          />
        </Form.Item>
      </Form>
      <Typography.Text strong>{t('customers.consents.modal.textPreview')}</Typography.Text>
      {shown ? (
        <Tabs
          size="small"
          defaultActiveKey={i18n.language === 'kk' ? 'kk' : 'ru'}
          items={(['kk', 'ru', 'en'] as const)
            .filter((locale) => shown.text[locale])
            .map((locale) => ({
              key: locale,
              label: t(`translatable.${locale}`),
              children: (
                <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto', marginBottom: 0 }}>{shown.text[locale]}</Typography.Paragraph>
              ),
            }))}
        />
      ) : (
        <Typography.Paragraph type="secondary">{t('customers.consents.modal.noText')}</Typography.Paragraph>
      )}
    </Modal>
  );
}
