import { DeleteOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Col, Divider, Drawer, Flex, Form, Input, InputNumber, Row, Select, Space, Switch } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { translate, type Promotion } from '@aula/api-client';
import { contentApi } from '@/shared/api/catalog';
import { queryKeys } from '@/shared/api/query-keys';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { useBranch } from '@/shared/branch/BranchProvider';
import { CatalogThumb } from '@/shared/ui/CatalogThumb';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ImageDropZone } from '@/shared/ui/ImageDropZone';
import { MissingTranslationsTag } from '@/shared/ui/MissingTranslationsTag';
import { TranslatableInput, translatableRule } from '@/shared/ui/TranslatableInput';
import { SLUG_PATTERN } from '../../menu/slug';
import { DateTimeInput } from '../DateTimeRange';
import { formToPromotionInput, isValidWindow, promotionToForm, type PromotionFormValues } from '../forms';
import { useContentAbilities } from '../useContentAbilities';

/** Акция: переводимые тексты и SEO, срок действия, филиалы (пусто — вся сеть), изображение. */
export function PromotionDrawer({
  open,
  promotion,
  onClose,
  onSaved,
}: {
  open: boolean;
  promotion: Promotion | null;
  onClose: () => void;
  onSaved: (promotion: Promotion) => void;
}) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const abilities = useContentAbilities();
  const { branches } = useBranch();
  const [form] = Form.useForm<PromotionFormValues>();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const canEdit = promotion ? abilities.promotion(promotion.branchIds) : abilities.global || abilities.editableBranchIds.length > 0;
  const promotionId = promotion?.id ?? null;

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(promotionToForm(promotion, { branchIds: abilities.global ? [] : abilities.editableBranchIds.slice(0, 1) }));
  }, [open, promotionId, form]);

  const applyServer = (saved: Promotion) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.promotions });
    onSaved(saved);
  };

  const submit = async () => {
    let values: PromotionFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const input = formToPromotionInput(values);
      const saved = promotion ? await contentApi.updatePromotion(promotion.id, input) : await contentApi.createPromotion(input);
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'translations'] });
      void message.success(promotion ? t('common.saved') : t('catalog.createdWithSlug', { slug: saved.slug }));
      form.setFieldsValue({ slug: saved.slug });
      applyServer(saved);
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  const upload = async (files: File[]) => {
    const file = files[0];
    if (!promotion || !file) return;
    setUploading(true);
    try {
      applyServer(await contentApi.uploadPromotionImage(promotion.id, file));
      void message.success(t('catalog.images.uploaded'));
    } catch (error) {
      notifyError(error);
    } finally {
      setUploading(false);
    }
  };

  const branchOptions = branches
    .filter((b) => abilities.global || abilities.editableBranchIds.includes(b.id))
    .map((b) => ({ value: b.id, label: translate(b.name, i18n.language) }));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={760}
      destroyOnHidden
      title={promotion ? t('content.promotions.editTitle') : t('content.promotions.createTitle')}
      extra={
        <Space>
          <Button onClick={onClose}>{canEdit ? t('common.cancel') : t('common.close')}</Button>
          {canEdit ? (
            <Button type="primary" loading={saving} onClick={() => void submit()}>
              {t('common.save')}
            </Button>
          ) : null}
        </Space>
      }
    >
      {promotion ? <MissingTranslationsTag items={promotion.missingTranslations} /> : null}
      <Form<PromotionFormValues> form={form} layout="vertical" requiredMark="optional" disabled={!canEdit} style={{ marginTop: 8 }}>
        <Form.Item name="title" label={t('content.fields.title')} rules={[translatableRule(t('translatable.required'))]}>
          <TranslatableInput maxLength={200} />
        </Form.Item>
        <Form.Item name="description" label={t('catalog.fields.description')}>
          <TranslatableInput multiline rows={3} maxLength={5000} />
        </Form.Item>
        <Form.Item name="terms" label={t('content.fields.terms')}>
          <TranslatableInput multiline rows={3} maxLength={5000} />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item
              name="branchIds"
              label={t('content.promotions.branches')}
              extra={t('content.promotions.branchesHint')}
              rules={[
                {
                  validator: async (_, value: string[] | undefined) =>
                    (value && value.length > 0) || abilities.global ? undefined : Promise.reject(new Error(t('content.branchRequired'))),
                },
              ]}
            >
              <Select mode="multiple" allowClear placeholder={t('layout.allBranches')} options={branchOptions} optionFilterProp="label" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              name="slug"
              label={t('catalog.fields.slug')}
              extra={promotion ? t('catalog.slugCurrent', { slug: promotion.slug }) : t('catalog.slugAuto')}
              rules={[{ pattern: SLUG_PATTERN, message: t('catalog.slugRule') }]}
            >
              <Input maxLength={80} placeholder={promotion ? undefined : t('catalog.slugPlaceholder')} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} sm={9}>
            <Form.Item name="validFrom" label={t('content.fields.validFrom')}>
              <DateTimeInput />
            </Form.Item>
          </Col>
          <Col xs={24} sm={9}>
            <Form.Item
              name="validTo"
              label={t('content.fields.validTo')}
              dependencies={['validFrom']}
              rules={[
                ({ getFieldValue }) => ({
                  validator: async (_, value) => (isValidWindow(getFieldValue('validFrom'), value) ? undefined : Promise.reject(new Error(t('content.periodRule')))),
                }),
              ]}
            >
              <DateTimeInput />
            </Form.Item>
          </Col>
          <Col xs={12} sm={3}>
            <Form.Item name="sortOrder" label={t('catalog.fields.sortOrder')}>
              <InputNumber precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={3}>
            <Form.Item name="isActive" label={t('catalog.fields.isActive')} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
        </Row>
        <Divider orientation="left" plain>
          {t('catalog.seo')}
        </Divider>
        <Form.Item name="seoTitle" label={t('catalog.fields.seoTitle')}>
          <TranslatableInput maxLength={120} />
        </Form.Item>
        <Form.Item name="seoDescription" label={t('catalog.fields.seoDescription')}>
          <TranslatableInput multiline rows={2} maxLength={320} />
        </Form.Item>
      </Form>
      <Divider orientation="left" plain>
        {t('catalog.fields.image')}
      </Divider>
      {promotion ? (
        <Flex gap={16} align="flex-start" wrap>
          <CatalogThumb image={promotion.image} size={112} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <ImageDropZone disabled={!canEdit} loading={uploading} onFiles={(files) => void upload(files)}>
              {promotion.image ? t('catalog.images.replace') : t('catalog.images.dropOne')}
            </ImageDropZone>
            {promotion.image && canEdit ? (
              <div style={{ marginTop: 8 }}>
                <ConfirmAction
                  danger
                  title={t('catalog.images.removeConfirm')}
                  description={t('catalog.auditNote')}
                  buttonProps={{ size: 'small', icon: <DeleteOutlined /> }}
                  successMessage={t('common.saved')}
                  onConfirm={async () => applyServer(await contentApi.removePromotionImage(promotion.id))}
                >
                  {t('catalog.images.remove')}
                </ConfirmAction>
              </div>
            ) : null}
          </div>
        </Flex>
      ) : (
        <Alert type="info" showIcon message={t('catalog.images.saveFirst')} />
      )}
    </Drawer>
  );
}
