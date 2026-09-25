/** Зал филиала: код, переводимые название и описание, размер плана, порядок, активность, фон плана. */
import { DeleteOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Col, Divider, Drawer, Form, Image, Input, InputNumber, Row, Space, Switch, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ImageDropZone } from '@/shared/ui/ImageDropZone';
import { TranslatableInput, translatableRule } from '@/shared/ui/TranslatableInput';
import { venueConfigApi, venueKeys } from './api';
import { backgroundUrl } from './HallPlan';
import type { Hall } from './types';
import { formToHallInput, formToHallPatch, hallToForm, PLAN_LIMITS, type HallFormValues } from './venue-form';

const HALL_CODE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function HallDrawer({
  open,
  branchId,
  hall,
  canEdit,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  branchId: string;
  /** null — новый зал. */
  hall: Hall | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (hall: Hall) => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const [form] = Form.useForm<HallFormValues>();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const hallId = hall?.id ?? null;

  // Форма заполняется при открытии и смене зала (не при загрузке фона — правки не теряются).
  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(hallToForm(hall));
  }, [open, hallId, form]);

  const refresh = (saved?: Hall) => {
    if (saved) queryClient.setQueryData<Hall[]>(venueKeys.halls(branchId), (list) => list?.map((h) => (h.id === saved.id ? saved : h)));
    void queryClient.invalidateQueries({ queryKey: venueKeys.halls(branchId) });
    void queryClient.invalidateQueries({ queryKey: ['reservations', 'timeline', branchId] });
  };

  const submit = async () => {
    let values: HallFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const full = { ...hallToForm(hall), ...values };
      const saved = hall ? await venueConfigApi.updateHall(hall.id, formToHallPatch(full)) : await venueConfigApi.createHall(formToHallInput(full, branchId));
      refresh(saved);
      void message.success(t('common.saved'));
      onSaved(saved);
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  const upload = async (files: File[]) => {
    const file = files[0];
    if (!hall || !file) return;
    setUploading(true);
    try {
      const saved = await venueConfigApi.setHallBackground(hall.id, file);
      refresh(saved);
      onSaved(saved);
      void message.success(t('venues.halls.backgroundUploaded'));
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
      width={640}
      destroyOnHidden
      title={hall ? t('venues.halls.editTitle') : t('venues.halls.createTitle')}
      extra={
        <Space>
          {hall && canEdit ? (
            <ConfirmAction
              title={t('venues.halls.deleteConfirm')}
              danger
              okText={t('common.delete')}
              successMessage={t('venues.halls.deleted')}
              onConfirm={async () => {
                await venueConfigApi.deleteHall(hall.id);
                refresh();
                onDeleted();
              }}
            >
              {t('common.delete')}
            </ConfirmAction>
          ) : null}
          <Button onClick={onClose}>{canEdit ? t('common.cancel') : t('common.close')}</Button>
          {canEdit ? (
            <Button type="primary" loading={saving} onClick={() => void submit()}>
              {t('common.save')}
            </Button>
          ) : null}
        </Space>
      }
    >
      <Form<HallFormValues> form={form} layout="vertical" requiredMark="optional" disabled={!canEdit}>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item
              name="code"
              label={t('venues.fields.code')}
              extra={t('venues.halls.codeHint')}
              rules={[{ required: true, pattern: HALL_CODE_RE, message: t('venues.halls.codeHint') }]}
            >
              <Input maxLength={32} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={6}>
            <Form.Item name="sortOrder" label={t('venues.fields.sortOrder')}>
              <InputNumber min={0} max={10000} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={6}>
            <Form.Item name="isActive" label={t('venues.fields.isActive')} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="name" label={t('venues.fields.name')} rules={[translatableRule(t('translatable.required'))]}>
          <TranslatableInput maxLength={100} />
        </Form.Item>
        <Form.Item name="description" label={t('venues.fields.description')}>
          <TranslatableInput multiline rows={2} maxLength={1000} />
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item
              name="planWidth"
              label={t('venues.fields.planWidth')}
              rules={[{ required: true, type: 'integer', min: PLAN_LIMITS.min, max: PLAN_LIMITS.max }]}
            >
              <InputNumber min={PLAN_LIMITS.min} max={PLAN_LIMITS.max} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="planHeight"
              label={t('venues.fields.planHeight')}
              rules={[{ required: true, type: 'integer', min: PLAN_LIMITS.min, max: PLAN_LIMITS.max }]}
            >
              <InputNumber min={PLAN_LIMITS.min} max={PLAN_LIMITS.max} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: -12, marginBottom: 12, fontSize: 12 }}>
          {t('venues.halls.planHint')}
        </Typography.Text>
      </Form>
      <Divider orientation="left" plain>
        {t('venues.fields.background')}
      </Divider>
      {!hall ? (
        <Typography.Text type="secondary">{t('venues.halls.backgroundAfterCreate')}</Typography.Text>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }}>
          {hall.background ? (
            <Space align="start">
              <Image src={hall.background.thumbnailUrl ?? hall.background.url} preview={{ src: backgroundUrl(hall.background) }} width={200} />
              {canEdit ? (
                <ConfirmAction
                  title={t('venues.halls.backgroundRemove')}
                  danger
                  buttonProps={{ icon: <DeleteOutlined />, size: 'small' }}
                  onConfirm={async () => {
                    const saved = await venueConfigApi.removeHallBackground(hall.id);
                    refresh(saved);
                    onSaved(saved);
                  }}
                >
                  {t('venues.halls.backgroundRemove')}
                </ConfirmAction>
              ) : null}
            </Space>
          ) : null}
          {canEdit ? (
            <ImageDropZone loading={uploading} onFiles={(files) => void upload(files)} hint={t('venues.halls.backgroundHint')}>
              {t('venues.halls.backgroundUpload')}
            </ImageDropZone>
          ) : null}
        </Space>
      )}
    </Drawer>
  );
}
