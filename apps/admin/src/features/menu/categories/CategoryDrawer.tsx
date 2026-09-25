import { DeleteOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { App, Alert, Button, Col, Divider, Drawer, Flex, Form, Input, Row, Space, Switch, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Category } from '@aula/api-client';
import { catalogApi } from '@/shared/api/catalog';
import { queryKeys } from '@/shared/api/query-keys';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { CatalogThumb } from '@/shared/ui/CatalogThumb';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ImageDropZone } from '@/shared/ui/ImageDropZone';
import { MissingTranslationsTag } from '@/shared/ui/MissingTranslationsTag';
import { TranslatableInput, translatableRule } from '@/shared/ui/TranslatableInput';
import { categoryToForm, formToCategoryInput, type CategoryFormValues } from '../forms';
import { SLUG_PATTERN } from '../slug';

/** Категория: переводимые название/описание/SEO, адрес (slug), активность, изображение. */
export function CategoryDrawer({
  open,
  category,
  canEdit,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null — новая категория. */
  category: Category | null;
  canEdit: boolean;
  onClose: () => void;
  /** created — категория только что создана (форма остаётся открытой для загрузки изображения). */
  onSaved: (category: Category, created: boolean) => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const [form] = Form.useForm<CategoryFormValues>();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Форма заполняется при открытии и смене категории (не при загрузке изображения — правки не теряются).
  const categoryId = category?.id ?? null;
  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(categoryToForm(category));
  }, [open, categoryId, form]);

  const applyServer = (next: Category) => {
    queryClient.setQueryData<Category[]>(queryKeys.categories, (list) => list?.map((c) => (c.id === next.id ? next : c)));
    void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
  };

  const submit = async () => {
    let values: CategoryFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const input = formToCategoryInput(values);
      const saved = category ? await catalogApi.updateCategory(category.id, input) : await catalogApi.createCategory(input);
      applyServer(saved);
      form.setFieldsValue(categoryToForm(saved));
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'translations'] });
      void message.success(category ? t('common.saved') : t('catalog.createdWithSlug', { slug: saved.slug }));
      onSaved(saved, !category);
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  const upload = async (files: File[]) => {
    const file = files[0];
    if (!category || !file) return;
    setUploading(true);
    try {
      const saved = await catalogApi.uploadCategoryImage(category.id, file);
      applyServer(saved);
      onSaved(saved, false);
      void message.success(t('catalog.images.uploaded'));
    } catch (error) {
      notifyError(error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={720}
      destroyOnHidden
      title={category ? t('catalog.categories.editTitle') : t('catalog.categories.createTitle')}
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
      {category ? <MissingTranslationsTag items={category.missingTranslations} /> : null}
      <Form<CategoryFormValues> form={form} layout="vertical" requiredMark="optional" disabled={!canEdit} style={{ marginTop: 8 }}>
        <Form.Item name="name" label={t('catalog.fields.name')} rules={[translatableRule(t('translatable.required'))]}>
          <TranslatableInput maxLength={200} />
        </Form.Item>
        <Form.Item name="description" label={t('catalog.fields.description')}>
          <TranslatableInput multiline rows={3} maxLength={4000} />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={16}>
            <Form.Item
              name="slug"
              label={t('catalog.fields.slug')}
              extra={category ? t('catalog.slugCurrent', { slug: category.slug }) : t('catalog.slugAuto')}
              rules={[{ pattern: SLUG_PATTERN, message: t('catalog.slugRule') }]}
            >
              <Input maxLength={80} placeholder={category ? undefined : t('catalog.slugPlaceholder')} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="isActive" label={t('catalog.fields.isActive')} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
        </Row>
        <Divider orientation="left" plain>
          {t('catalog.seo')}
        </Divider>
        <Form.Item name="seoTitle" label={t('catalog.fields.seoTitle')} extra={t('catalog.seoTitleHint')}>
          <TranslatableInput maxLength={120} />
        </Form.Item>
        <Form.Item name="seoDescription" label={t('catalog.fields.seoDescription')}>
          <TranslatableInput multiline rows={2} maxLength={320} />
        </Form.Item>
      </Form>
      <Divider orientation="left" plain>
        {t('catalog.fields.image')}
      </Divider>
      {category ? (
        <Flex gap={16} align="flex-start" wrap>
          <CatalogThumb image={category.image} size={112} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <ImageDropZone disabled={!canEdit} loading={uploading} onFiles={(files) => void upload(files)}>
              {category.image ? t('catalog.images.replace') : t('catalog.images.dropOne')}
            </ImageDropZone>
            {category.image && canEdit ? (
              <div style={{ marginTop: 8 }}>
                <ConfirmAction
                  danger
                  title={t('catalog.images.removeConfirm')}
                  description={t('catalog.auditNote')}
                  buttonProps={{ size: 'small', icon: <DeleteOutlined /> }}
                  successMessage={t('common.saved')}
                  onConfirm={async () => {
                    const saved = await catalogApi.removeCategoryImage(category.id);
                    applyServer(saved);
                    onSaved(saved, false);
                  }}
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
      {!canEdit ? (
        <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
          {t('catalog.readOnly')}
        </Typography.Paragraph>
      ) : null}
    </Drawer>
  );
}
