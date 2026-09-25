import { PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Form, Input, Modal, Radio, Row, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Permission } from '@aula/api-client';
import { useApiMutation, useApiQuery } from '@/shared/api/hooks';
import { useCan } from '@/shared/auth/useCan';
import { dayjs, DISPLAY_TIMEZONE, formatDateTime } from '@/shared/lib/dates';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { TranslatableInput } from '@/shared/ui/TranslatableInput';
import { customerKeys, customersApi } from './api';
import {
  currentText,
  suggestVersion,
  toPublishConsentBody,
  validatePublishConsent,
  versionsOf,
  type PublishConsentErrors,
  type PublishConsentValues,
} from './consent-form';
import { CONSENT_KINDS, type ConsentKind, type ConsentText } from './types';

function ConsentTextView({ text }: { text: ConsentText }) {
  const { t, i18n } = useTranslation();
  return (
    <Tabs
      size="small"
      defaultActiveKey={i18n.language === 'kk' ? 'kk' : 'ru'}
      items={(['kk', 'ru', 'en'] as const)
        .filter((locale) => text.text[locale])
        .map((locale) => ({
          key: locale,
          label: t(`translatable.${locale}`),
          children: (
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', marginBottom: 0 }}>{text.text[locale]}</Typography.Paragraph>
          ),
        }))}
    />
  );
}

/**
 * Тексты согласий (просмотр — customers.view, публикация — customers.manage): действующая версия
 * и история по каждому виду согласия. Опубликованная версия неизменна.
 */
export function ConsentTextsTab() {
  const { t } = useTranslation();
  const { canSomewhere } = useCan();
  const canManage = canSomewhere(Permission.CustomersManage);
  const texts = useApiQuery(customerKeys.consentTexts, () => customersApi.consentTexts());
  const [publishing, setPublishing] = useState<ConsentKind | null>(null);
  const all = texts.data ?? [];

  return (
    <>
      {texts.error ? <ErrorAlert error={texts.error} onRetry={() => void texts.refetch()} /> : null}
      <Row gutter={[16, 16]}>
        {CONSENT_KINDS.map((kind) => {
          const current = currentText(kind, all);
          const versions = versionsOf(kind, all);
          return (
            <Col key={kind} xs={24} xl={12}>
              <Card
                loading={texts.isLoading}
                title={t(`customers.consents.kind.${kind}`)}
                extra={
                  canManage ? (
                    <Button icon={<PlusOutlined />} onClick={() => setPublishing(kind)}>
                      {t('customers.consentTexts.publish')}
                    </Button>
                  ) : null
                }
              >
                {current ? (
                  <>
                    <Space wrap style={{ marginBottom: 8 }}>
                      <Tag color="success">{t('customers.consentTexts.current', { version: current.version })}</Tag>
                      <Typography.Text type="secondary">{t('customers.consentTexts.publishedAt', { date: formatDateTime(current.publishedAt) })}</Typography.Text>
                    </Space>
                    <ConsentTextView text={current} />
                  </>
                ) : (
                  <Alert type={kind === 'personal_data' ? 'error' : 'warning'} showIcon message={t('customers.consentTexts.none')} />
                )}
                {versions.length > 0 ? (
                  <>
                    <Typography.Title level={5} style={{ marginTop: 16 }}>
                      {t('customers.consentTexts.versions')}
                    </Typography.Title>
                    <Table<ConsentText>
                      rowKey="id"
                      size="small"
                      pagination={versions.length > 10 ? { pageSize: 10 } : false}
                      dataSource={versions}
                      expandable={{ expandedRowRender: (text) => <ConsentTextView text={text} /> }}
                      columns={[
                        {
                          title: t('customers.consentTexts.modal.version'),
                          key: 'version',
                          render: (_, text) => (
                            <Space size={4}>
                              <Typography.Text code>{text.version}</Typography.Text>
                              {text.isCurrent ? <Tag color="success">{t('customers.consentTexts.isCurrent')}</Tag> : null}
                            </Space>
                          ),
                        },
                        { title: t('customers.consents.columns.recordedAt'), key: 'publishedAt', render: (_, text) => formatDateTime(text.publishedAt) },
                      ]}
                    />
                  </>
                ) : null}
              </Card>
            </Col>
          );
        })}
      </Row>
      {publishing ? <PublishConsentModal kind={publishing} existing={all} onClose={() => setPublishing(null)} /> : null}
    </>
  );
}

function PublishConsentModal({ kind, existing, onClose }: { kind: ConsentKind; existing: ConsentText[]; onClose: () => void }) {
  const { t } = useTranslation();
  const [form] = Form.useForm<PublishConsentValues>();
  const [today] = useState(() => dayjs().tz(DISPLAY_TIMEZONE).format('YYYY-MM-DD'));
  const current = currentText(kind, existing);
  const publish = useApiMutation((values: PublishConsentValues) => customersApi.publishConsentText(toPublishConsentBody(values)), {
    invalidate: [customerKeys.consentTexts],
    successMessage: t('customers.consentTexts.modal.published'),
    onSuccess: () => onClose(),
  });

  const fieldRule = (field: keyof PublishConsentErrors) => ({
    validator: async () => {
      const issue = validatePublishConsent(form.getFieldsValue(true), existing)[field];
      if (issue) throw new Error(t(`customers.consentTexts.modal.issues.${issue}`));
    },
  });

  return (
    <Modal
      open
      width={760}
      title={t('customers.consentTexts.modal.title')}
      okText={t('customers.consentTexts.modal.submit')}
      okButtonProps={{ loading: publish.isPending }}
      cancelText={t('common.cancel')}
      onCancel={onClose}
      onOk={() =>
        void form
          .validateFields()
          .then(() => publish.mutateAsync(form.getFieldsValue(true)))
          .catch(() => undefined)
      }
      destroyOnHidden
    >
      <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={t('customers.consentTexts.modal.hint')} />
      <Form<PublishConsentValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ kind, version: suggestVersion(kind, today, existing), text: current ? { ...current.text } : {} }}
      >
        <Form.Item name="kind" label={t('customers.consentTexts.modal.kind')} rules={[fieldRule('kind')]}>
          <Radio.Group
            options={CONSENT_KINDS.map((value) => ({ value, label: t(`customers.consents.kind.${value}`) }))}
            onChange={(e) => {
              const next = e.target.value as ConsentKind;
              const nextCurrent = currentText(next, existing);
              form.setFieldsValue({ version: suggestVersion(next, today, existing), text: nextCurrent ? { ...nextCurrent.text } : {} });
            }}
          />
        </Form.Item>
        <Form.Item name="version" label={t('customers.consentTexts.modal.version')} extra={t('customers.consentTexts.modal.versionHint')} rules={[fieldRule('version')]}>
          <Input maxLength={32} style={{ maxWidth: 260 }} />
        </Form.Item>
        <Form.Item name="text" label={t('customers.consentTexts.modal.text')} rules={[fieldRule('text')]}>
          <TranslatableInput multiline rows={10} maxLength={20000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
