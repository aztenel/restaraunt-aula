import { Alert, Button, Card, Col, Drawer, Empty, Flex, Form, Input, Row, Space, Switch, Tag, Tooltip, Typography } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toApiError } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { banquetRefKeys, banquetsApi } from '../api';
import type { ContractTemplate, TemplateInput } from '../types';
import {
  insertPlaceholder,
  MAX_TEMPLATE_LENGTH,
  MIN_TEMPLATE_LENGTH,
  placeholderGroup,
  TEMPLATE_CODE_PATTERN,
  unknownFromErrorDetails,
  unknownPlaceholders,
} from './template-form';

interface FormValues {
  code: string;
  name: string;
  body: string;
  isDefault: boolean;
}

/** Пример подстановки для подсказки (не через i18n: фигурные скобки — синтаксис интерполяции). */
const PLACEHOLDER_EXAMPLE = '{{seller.name}}, {{client.bin}}, {{event.date}}, {{quote.total}}';

/** Редактор шаблона договора: текст, панель подстановок с сервера, подсветка неизвестных подстановок. */
export function TemplateEditorDrawer({
  open,
  template,
  readOnly,
  onClose,
  onSaved,
}: {
  open: boolean;
  template: ContractTemplate | null;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (template: ContractTemplate) => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm<FormValues>();
  const notifyError = useNotifyError();
  const [saving, setSaving] = useState(false);
  const [serverUnknown, setServerUnknown] = useState<string[]>([]);
  const bodyRef = useRef<TextAreaRef>(null);
  const body = Form.useWatch('body', form) ?? '';
  const placeholders = useApiQuery(banquetRefKeys.placeholders, banquetsApi.placeholders, { staleTime: 10 * 60_000, enabled: open });
  const known = useMemo(() => (placeholders.data ?? []).map((p) => p.key), [placeholders.data]);
  const localUnknown = placeholders.data ? unknownPlaceholders(body, known) : [];

  const groups = useMemo(() => {
    const map = new Map<string, Array<{ key: string; description: string }>>();
    for (const p of placeholders.data ?? []) {
      const group = placeholderGroup(p.key);
      map.set(group, [...(map.get(group) ?? []), p]);
    }
    return [...map.entries()];
  }, [placeholders.data]);

  useEffect(() => {
    if (!open) return;
    setServerUnknown([]);
    form.resetFields();
    form.setFieldsValue(template ? { code: template.code, name: template.name, body: template.body, isDefault: template.isDefault } : { code: '', name: '', body: '', isDefault: false });
  }, [open, template, form]);

  const insert = (key: string) => {
    if (readOnly) return;
    const textarea = bodyRef.current?.resizableTextArea?.textArea;
    const current: string = form.getFieldValue('body') ?? '';
    const next = insertPlaceholder(current, key, textarea?.selectionStart ?? null, textarea?.selectionEnd ?? null);
    form.setFieldsValue({ body: next.body });
    window.requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(next.caret, next.caret);
    });
  };

  const submit = async () => {
    const values = await form.validateFields();
    const input: TemplateInput = { code: values.code.trim(), name: values.name.trim(), body: values.body, isDefault: values.isDefault };
    setSaving(true);
    setServerUnknown([]);
    try {
      onSaved(template ? await banquetsApi.updateTemplate(template.id, input) : await banquetsApi.createTemplate(input));
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === 'banquet_template.unknown_placeholders') setServerUnknown(unknownFromErrorDetails(apiError.details));
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={1080}
      title={template ? t('banquets.templates.editTitle') : t('banquets.templates.createTitle')}
      destroyOnHidden
      extra={
        readOnly ? null : (
          <Space>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="primary" loading={saving} onClick={() => void submit()}>
              {t('common.save')}
            </Button>
          </Space>
        )
      }
    >
      <Row gutter={16}>
        <Col xs={24} lg={16}>
          <Form<FormValues> form={form} layout="vertical" disabled={readOnly} requiredMark="optional">
            <Row gutter={12}>
              <Col xs={24} sm={14}>
                <Form.Item name="name" label={t('banquets.templates.name')} rules={[{ required: true, whitespace: true, message: t('common.required') }, { max: 200 }]}>
                  <Input maxLength={200} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={10}>
                <Form.Item
                  name="code"
                  label={t('banquets.templates.code')}
                  extra={t('banquets.templates.codeHint')}
                  rules={[{ required: true, message: t('common.required') }, { pattern: TEMPLATE_CODE_PATTERN, message: t('banquets.templates.codeRule') }]}
                >
                  <Input maxLength={60} placeholder="banquet-standard" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name="body"
              label={t('banquets.templates.body')}
              extra={
                <span>
                  {t('banquets.templates.bodyHint')} <Typography.Text code>{PLACEHOLDER_EXAMPLE}</Typography.Text>
                </span>
              }
              rules={[
                { required: true, message: t('common.required') },
                { min: MIN_TEMPLATE_LENGTH, max: MAX_TEMPLATE_LENGTH, message: t('banquets.templates.bodyRule') },
              ]}
            >
              <Input.TextArea ref={bodyRef} autoSize={{ minRows: 18, maxRows: 40 }} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }} />
            </Form.Item>
            {localUnknown.length > 0 ? (
              <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t('banquets.templates.unknownLocal', { list: localUnknown.join(', ') })} />
            ) : null}
            {serverUnknown.length > 0 ? (
              <Alert type="error" showIcon style={{ marginBottom: 12 }} message={t('banquets.templates.unknownServer', { list: serverUnknown.join(', ') })} />
            ) : null}
            <Form.Item name="isDefault" label={t('banquets.templates.isDefault')} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Form>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title={t('banquets.templates.placeholders')} extra={<Typography.Text type="secondary">{t('banquets.templates.placeholdersHint')}</Typography.Text>}>
            {placeholders.isLoading ? null : groups.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <Flex vertical gap={10} style={{ maxHeight: 640, overflowY: 'auto' }}>
                {groups.map(([group, items]) => (
                  <div key={group}>
                    <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>
                      {group}
                    </Typography.Text>
                    <Flex wrap gap={4} style={{ marginTop: 4 }}>
                      {items.map((p) => (
                        <Tooltip key={p.key} title={p.description}>
                          <Tag
                            style={{ cursor: readOnly ? 'default' : 'pointer', marginInlineEnd: 0 }}
                            color={body.includes(p.key) ? 'gold' : undefined}
                            onClick={() => insert(p.key)}
                          >
                            {p.key}
                          </Tag>
                        </Tooltip>
                      ))}
                    </Flex>
                  </div>
                ))}
              </Flex>
            )}
          </Card>
        </Col>
      </Row>
    </Drawer>
  );
}
