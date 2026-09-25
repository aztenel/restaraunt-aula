import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Col, Divider, Drawer, Flex, Form, Input, InputNumber, Row, Select, Space, Switch } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Banner } from '@aula/api-client';
import { contentApi } from '@/shared/api/catalog';
import { queryKeys } from '@/shared/api/query-keys';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { BranchSelect } from '@/shared/ui/BranchSelect';
import { CatalogThumb } from '@/shared/ui/CatalogThumb';
import { ImageDropZone } from '@/shared/ui/ImageDropZone';
import { MissingTranslationsTag } from '@/shared/ui/MissingTranslationsTag';
import { TranslatableInput, translatableRule } from '@/shared/ui/TranslatableInput';
import { DateTimeInput } from '../DateTimeRange';
import { BANNER_PLACEMENTS, bannerToForm, formToBannerInput, isValidBannerLink, isValidWindow, type BannerFormValues } from '../forms';
import { useContentAbilities } from '../useContentAbilities';

/**
 * Баннер витрины: место показа, филиал или все филиалы, окно показа, переводимые заголовок,
 * подзаголовок и текст кнопки, ссылка, изображение (webp 1920/1200/600).
 */
export function BannerDrawer({ open, banner, onClose, onSaved }: { open: boolean; banner: Banner | null; onClose: () => void; onSaved: (banner: Banner) => void }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const abilities = useContentAbilities();
  const [form] = Form.useForm<BannerFormValues>();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const canEdit = banner ? abilities.banner(banner.branchId) : abilities.global || abilities.editableBranchIds.length > 0;
  const bannerId = banner?.id ?? null;

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(bannerToForm(banner, { branchId: abilities.global ? null : (abilities.editableBranchIds[0] ?? null) }));
    // Заполняется при открытии и смене баннера (загрузка изображения правки не сбрасывает).
  }, [open, bannerId, form]);

  const applyServer = (saved: Banner) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.banners });
    onSaved(saved);
  };

  const submit = async () => {
    let values: BannerFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const input = formToBannerInput(values);
      const saved = banner ? await contentApi.updateBanner(banner.id, input) : await contentApi.createBanner(input);
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'translations'] });
      void message.success(t('common.saved'));
      applyServer(saved);
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  const upload = async (files: File[]) => {
    const file = files[0];
    if (!banner || !file) return;
    setUploading(true);
    try {
      applyServer(await contentApi.uploadBannerImage(banner.id, file));
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
      width={760}
      destroyOnHidden
      title={banner ? t('content.banners.editTitle') : t('content.banners.createTitle')}
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
      {banner ? <MissingTranslationsTag items={banner.missingTranslations} /> : null}
      <Form<BannerFormValues> form={form} layout="vertical" requiredMark="optional" disabled={!canEdit} style={{ marginTop: 8 }}>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="placement" label={t('content.banners.placement')} rules={[{ required: true, message: t('common.required') }]}>
              <Select options={BANNER_PLACEMENTS.map((p) => ({ value: p, label: t(`content.banners.placements.${p}`) }))} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              name="branchId"
              label={t('layout.branch')}
              extra={t('content.banners.branchHint')}
              rules={[{ validator: async (_, value: string | null) => (value || abilities.global ? undefined : Promise.reject(new Error(t('content.branchRequired')))) }]}
            >
              <BranchSelect allowAll={abilities.global} onlyIds={abilities.editableBranchIds} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="title" label={t('content.fields.title')} rules={[translatableRule(t('translatable.required'))]}>
          <TranslatableInput maxLength={200} />
        </Form.Item>
        <Form.Item name="subtitle" label={t('content.fields.subtitle')}>
          <TranslatableInput multiline rows={2} maxLength={400} />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="ctaLabel" label={t('content.fields.ctaLabel')}>
              <TranslatableInput maxLength={60} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              name="linkUrl"
              label={t('content.fields.linkUrl')}
              extra={t('content.banners.linkHint')}
              rules={[{ validator: async (_, value: string) => (isValidBannerLink(value) ? undefined : Promise.reject(new Error(t('content.banners.linkRule')))) }]}
            >
              <Input maxLength={1000} placeholder="/greenline/menu" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col xs={24} sm={9}>
            <Form.Item name="activeFrom" label={t('content.fields.activeFrom')}>
              <DateTimeInput />
            </Form.Item>
          </Col>
          <Col xs={24} sm={9}>
            <Form.Item
              name="activeTo"
              label={t('content.fields.activeTo')}
              dependencies={['activeFrom']}
              rules={[
                ({ getFieldValue }) => ({
                  validator: async (_, value) => (isValidWindow(getFieldValue('activeFrom'), value) ? undefined : Promise.reject(new Error(t('content.periodRule')))),
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
      </Form>
      <Divider orientation="left" plain>
        {t('catalog.fields.image')}
      </Divider>
      {banner ? (
        <Flex gap={16} align="flex-start" wrap>
          <CatalogThumb image={banner.image} size={112} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <ImageDropZone disabled={!canEdit} loading={uploading} onFiles={(files) => void upload(files)} hint={t('content.banners.imageHint')}>
              {banner.image ? t('catalog.images.replace') : t('catalog.images.dropOne')}
            </ImageDropZone>
          </div>
        </Flex>
      ) : (
        <Alert type="info" showIcon message={t('catalog.images.saveFirst')} />
      )}
    </Drawer>
  );
}
