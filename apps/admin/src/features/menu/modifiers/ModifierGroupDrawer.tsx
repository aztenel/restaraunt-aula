import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Checkbox, Col, Divider, Drawer, Flex, Form, Input, InputNumber, Row, Space, Switch, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModifierGroup } from '@aula/api-client';
import { catalogApi } from '@/shared/api/catalog';
import { queryKeys } from '@/shared/api/query-keys';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { TranslatableInput, translatableRule } from '@/shared/ui/TranslatableInput';
import {
  formToModifierGroupInput,
  modifierGroupIssues,
  modifierGroupToForm,
  toggleDefaultOption,
  type ModifierGroupFormValues,
  type ModifierOptionFormValues,
} from '../forms';
import { ReorderButtons } from '../ReorderButtons';
import { moveBy } from '../reorder';
import { SLUG_PATTERN } from '../slug';

/** Максимальные значения — как на сервере (MAX_MODIFIER_SELECT, MAX_OPTIONS_PER_GROUP). */
const MAX_SELECT = 20;
const MAX_OPTIONS = 50;
/** Верхняя граница цены опции: 10 млн ₸ (как MAX_MENU_PRICE_TIYN). */
const MAX_PRICE_TIYN = 1_000_000_000;

/**
 * Группа модификаторов: min/max выбора (обязательная при min ≥ 1), опции с доплатой в тиынах
 * (MoneyInput), опция(и) по умолчанию, активность, порядок опций. Список опций отправляется целиком.
 */
export function ModifierGroupDrawer({
  open,
  group,
  canEdit,
  onClose,
  onSaved,
}: {
  open: boolean;
  group: ModifierGroup | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (group: ModifierGroup) => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const [form] = Form.useForm<ModifierGroupFormValues>();
  const [saving, setSaving] = useState(false);
  const minSelect = Form.useWatch('minSelect', form) ?? 0;
  const maxSelect = Form.useWatch('maxSelect', form) ?? 1;
  const options = Form.useWatch('options', form) as ModifierOptionFormValues[] | undefined;
  // Названия опций проверяет правило поля; здесь — настройки группы (как validateModifierGroupConfig).
  const issues = options ? modifierGroupIssues({ minSelect, maxSelect, options }).filter((issue) => issue !== 'option_name_required') : [];

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(modifierGroupToForm(group));
  }, [open, group, form]);

  const submit = async () => {
    let values: ModifierGroupFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (modifierGroupIssues(values).length > 0) return;
    setSaving(true);
    try {
      const input = formToModifierGroupInput(values);
      const saved = group ? await catalogApi.updateModifierGroup(group.id, input) : await catalogApi.createModifierGroup(input);
      await queryClient.invalidateQueries({ queryKey: queryKeys.modifierGroups });
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'translations'] });
      void message.success(group ? t('common.saved') : t('catalog.modifiers.created', { code: saved.code }));
      onSaved(saved);
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  const setOptions = (next: ModifierOptionFormValues[]) => form.setFieldValue('options', next);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={820}
      destroyOnHidden
      title={group ? t('catalog.modifiers.editTitle') : t('catalog.modifiers.createTitle')}
      extra={
        <Space>
          <Button onClick={onClose}>{canEdit ? t('common.cancel') : t('common.close')}</Button>
          {canEdit ? (
            <Button type="primary" loading={saving} disabled={issues.length > 0} onClick={() => void submit()}>
              {t('common.save')}
            </Button>
          ) : null}
        </Space>
      }
    >
      {group && group.dishCount > 0 ? (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('catalog.modifiers.usedBy', { count: group.dishCount })} />
      ) : null}
      <Form<ModifierGroupFormValues> form={form} layout="vertical" requiredMark="optional" disabled={!canEdit}>
        <Form.Item name="name" label={t('catalog.fields.name')} rules={[translatableRule(t('translatable.required'))]}>
          <TranslatableInput maxLength={200} />
        </Form.Item>
        <Form.Item name="description" label={t('catalog.fields.description')}>
          <TranslatableInput multiline rows={2} maxLength={4000} />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={8}>
            <Form.Item
              name="code"
              label={t('catalog.modifiers.code')}
              extra={group ? undefined : t('catalog.slugAuto')}
              rules={[{ pattern: SLUG_PATTERN, message: t('catalog.slugRule') }]}
            >
              <Input maxLength={80} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={5}>
            <Form.Item name="minSelect" label={t('catalog.modifiers.minSelect')} extra={t('catalog.modifiers.minHint')} rules={[{ required: true, message: t('common.required') }]}>
              <InputNumber min={0} max={MAX_SELECT} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={5}>
            <Form.Item name="maxSelect" label={t('catalog.modifiers.maxSelect')} rules={[{ required: true, message: t('common.required') }]}>
              <InputNumber min={1} max={MAX_SELECT} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={6}>
            <Form.Item name="isActive" label={t('catalog.fields.isActive')} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
        </Row>
        <Flex gap={8} style={{ marginBottom: 8 }}>
          <Tag color={minSelect >= 1 ? 'red' : 'default'}>{minSelect >= 1 ? t('catalog.modifiers.required') : t('catalog.modifiers.optional')}</Tag>
          <Typography.Text type="secondary">{t('catalog.modifiers.selectRange', { min: minSelect, max: maxSelect })}</Typography.Text>
        </Flex>
        <Divider orientation="left" plain>
          {t('catalog.modifiers.options')}
        </Divider>
        <Form.List name="options">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field, index) => (
                <Card key={field.key} size="small" style={{ marginBottom: 8 }}>
                  <Row gutter={12} align="top">
                    <Col xs={24} md={12}>
                      <Form.Item name={[field.name, 'name']} label={t('catalog.fields.name')} rules={[translatableRule(t('translatable.required'))]} style={{ marginBottom: 8 }}>
                        <TranslatableInput maxLength={200} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Form.Item
                        name={[field.name, 'price']}
                        label={t('catalog.modifiers.price')}
                        extra={t('catalog.modifiers.priceHint')}
                        rules={[{ required: true, message: t('money.empty') }]}
                        style={{ marginBottom: 8 }}
                      >
                        <MoneyInput max={MAX_PRICE_TIYN} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} md={6}>
                      <Flex vertical gap={4} align="flex-start">
                        <ReorderButtons
                          index={index}
                          count={fields.length}
                          disabled={!canEdit}
                          onMove={(delta) => setOptions(moveBy(form.getFieldValue('options') as ModifierOptionFormValues[], index, delta))}
                        />
                        <Form.Item name={[field.name, 'isDefault']} valuePropName="checked" noStyle>
                          <Checkbox
                            onChange={(e) =>
                              setOptions(toggleDefaultOption(form.getFieldValue('options') as ModifierOptionFormValues[], index, e.target.checked, maxSelect))
                            }
                          >
                            {t('catalog.modifiers.isDefault')}
                          </Checkbox>
                        </Form.Item>
                        <Space size={6}>
                          <Form.Item name={[field.name, 'isActive']} valuePropName="checked" noStyle>
                            <Switch size="small" />
                          </Form.Item>
                          <Typography.Text>{t('catalog.fields.isActive')}</Typography.Text>
                        </Space>
                        {canEdit && fields.length > 1 ? (
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)}>
                            {t('catalog.modifiers.removeOption')}
                          </Button>
                        ) : null}
                      </Flex>
                    </Col>
                  </Row>
                </Card>
              ))}
              {canEdit ? (
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  disabled={fields.length >= MAX_OPTIONS}
                  onClick={() => add({ name: {}, price: 0, isDefault: false, isActive: true } satisfies ModifierOptionFormValues)}
                >
                  {t('catalog.modifiers.addOption')}
                </Button>
              ) : null}
            </>
          )}
        </Form.List>
        {issues.length > 0 ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12 }}
            message={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {issues.map((issue) => (
                  <li key={issue}>{t(`catalog.modifiers.issues.${issue}`)}</li>
                ))}
              </ul>
            }
          />
        ) : null}
      </Form>
    </Drawer>
  );
}
