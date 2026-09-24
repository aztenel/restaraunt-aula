import { Button, Card, Checkbox, Form, Input, InputNumber, Select, Space, Switch, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IntegrationDescriptor, IntegrationField, IntegrationSetting } from '@aula/api-client';
import { systemApi } from '@/shared/api/endpoints';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { formatDateTime } from '@/shared/lib/dates';
import { initialFormValues, isValidJson, toSavePayload, type IntegrationFormValues } from './integration-form';

/** Поле настройки по типу; value/onChange/checked пробрасываются из Form.Item. */
function ConfigField({ field, ...control }: { field: IntegrationField } & Record<string, unknown>) {
  switch (field.type) {
    case 'number':
      return <InputNumber {...control} style={{ width: '100%' }} />;
    case 'boolean':
      return <Switch {...control} />;
    case 'select':
      return <Select {...control} allowClear options={(field.options ?? []).map((o) => ({ value: o, label: o }))} />;
    case 'json':
      return <Input.TextArea {...control} rows={4} style={{ fontFamily: 'monospace' }} />;
    case 'url':
      return <Input {...control} inputMode="url" placeholder="https://" />;
    default:
      return <Input {...control} />;
  }
}

/** Карточка интеграции: включение, настройки и секреты (маскированные) по описанию адаптера. */
export function IntegrationCard({
  descriptor,
  setting,
  onSaved,
}: {
  descriptor: IntegrationDescriptor;
  setting: IntegrationSetting | undefined;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm<IntegrationFormValues>();
  const notifyError = useNotifyError();
  const [saving, setSaving] = useState(false);
  const clearSecrets = Form.useWatch('clearSecrets', form);

  useEffect(() => {
    form.setFieldsValue(initialFormValues(descriptor, setting) as Parameters<typeof form.setFieldsValue>[0]);
  }, [descriptor, setting, form]);

  const submit = async (values: IntegrationFormValues) => {
    setSaving(true);
    try {
      await systemApi.saveIntegration(descriptor.key, toSavePayload(descriptor, values));
      form.setFieldsValue({ secrets: {}, clearSecrets: {} });
      onSaved();
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title={
        <Space wrap>
          <span>{descriptor.title}</span>
          <Tag>{t('integrations.stage', { stage: descriptor.stage })}</Tag>
          <Typography.Text type="secondary" code>
            {descriptor.key}
          </Typography.Text>
        </Space>
      }
      extra={setting?.enabled ? <Tag color="success">{t('integrations.enabled')}</Tag> : <Tag>{t('integrations.disabled')}</Tag>}
    >
      {descriptor.description ? <Typography.Paragraph type="secondary">{descriptor.description}</Typography.Paragraph> : null}
      <Form<IntegrationFormValues> form={form} layout="vertical" onFinish={(values) => void submit(values)}>
        <Form.Item name="enabled" label={t('integrations.enabledLabel')} valuePropName="checked">
          <Switch />
        </Form.Item>
        {descriptor.fields.length === 0 ? (
          <Form.Item
            name="rawConfig"
            label={t('integrations.rawConfig')}
            rules={[{ validator: async (_, v: string | undefined) => { if (!isValidJson(v)) throw new Error(t('integrations.invalidJson')); } }]}
          >
            <Input.TextArea rows={6} style={{ fontFamily: 'monospace' }} />
          </Form.Item>
        ) : null}
        {descriptor.fields.map((field) =>
          field.secret ? (
            <Form.Item key={field.name} label={field.label} extra={field.help} required={field.required && !setting?.secrets[field.name]}>
              <Space.Compact style={{ width: '100%' }}>
                <Form.Item
                  name={['secrets', field.name]}
                  noStyle
                  rules={field.required && !setting?.secrets[field.name] ? [{ required: true, message: t('common.required') }] : []}
                >
                  <Input.Password
                    autoComplete="new-password"
                    disabled={Boolean(clearSecrets?.[field.name])}
                    placeholder={setting?.secrets[field.name] ? `${setting.secrets[field.name]} · ${t('integrations.keepSecret')}` : t('integrations.notSet')}
                  />
                </Form.Item>
              </Space.Compact>
              {setting?.secrets[field.name] ? (
                <Form.Item name={['clearSecrets', field.name]} valuePropName="checked" noStyle>
                  <Checkbox style={{ marginTop: 6 }}>{t('integrations.clearSecret')}</Checkbox>
                </Form.Item>
              ) : null}
            </Form.Item>
          ) : (
            <Form.Item
              key={field.name}
              name={['config', field.name]}
              label={field.label}
              extra={field.help}
              valuePropName={field.type === 'boolean' ? 'checked' : 'value'}
              rules={[
                ...(field.required ? [{ required: true, message: t('common.required') }] : []),
                ...(field.type === 'url' ? [{ type: 'url' as const, message: t('integrations.invalidUrl') }] : []),
                ...(field.type === 'json'
                  ? [{ validator: async (_: unknown, v: string | undefined) => { if (!isValidJson(v)) throw new Error(t('integrations.invalidJson')); } }]
                  : []),
              ]}
            >
              <ConfigField field={field} />
            </Form.Item>
          ),
        )}
        <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
          <Typography.Text type="secondary">
            {t('integrations.updatedAt')}: {formatDateTime(setting?.updatedAt ?? null)}
          </Typography.Text>
          <Button type="primary" htmlType="submit" loading={saving}>
            {t('common.save')}
          </Button>
        </Space>
      </Form>
    </Card>
  );
}
