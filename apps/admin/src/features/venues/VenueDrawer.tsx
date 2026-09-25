/**
 * Место (стол, VIP-зал, юрта…): зал, тип, код, переводимые название и описание, вместимость,
 * депозит (MoneyInput, тиыны), свои правила брони поверх правил типа, позиция на плане, активность, фото.
 */
import { DeleteOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Col, Divider, Drawer, Flex, Form, Image, Input, InputNumber, Row, Segmented, Select, Space, Switch, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { translate } from '@aula/api-client';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ImageDropZone } from '@/shared/ui/ImageDropZone';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { TranslatableInput, translatableRule } from '@/shared/ui/TranslatableInput';
import { venueConfigApi, venueKeys } from './api';
import { freeSpot } from './plan-math';
import { OverrideRulesFields } from './RulesFields';
import { VENUE_SHAPES, type Hall, type Venue, type VenueType } from './types';
import {
  capacityIssue,
  depositIssue,
  DEFAULT_POSITION,
  DEFAULT_RULES,
  formToVenueInput,
  MAX_VENUE_CAPACITY,
  RULE_KEYS,
  venueToForm,
  type VenueFormValues,
} from './venue-form';

const VENUE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const MAX_PHOTOS = 10;

export function VenueDrawer({
  open,
  branchId,
  venue,
  hallId,
  halls,
  types,
  siblings,
  canEdit,
  onClose,
  onSaved,
}: {
  open: boolean;
  branchId: string;
  /** null — новое место. */
  venue: Venue | null;
  /** Зал для нового места. */
  hallId: string;
  halls: Hall[];
  types: VenueType[];
  /** Места зала (позиция нового места — на свободном участке плана). */
  siblings: Venue[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: (venue: Venue) => void;
}) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const [form] = Form.useForm<VenueFormValues>();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const venueId = venue?.id ?? null;
  const typeId = Form.useWatch('typeId', form) as string | undefined;
  const formHallId = Form.useWatch('hallId', form) as string | undefined;
  const depositEnabled = Form.useWatch('depositEnabled', form) as boolean | undefined;
  const typeRules = useMemo(() => types.find((type) => type.id === typeId)?.rules ?? null, [types, typeId]);
  const activeTypes = types.filter((type) => type.isActive || type.id === venue?.typeId);
  const hall = halls.find((h) => h.id === (formHallId ?? hallId));

  // Форма заполняется при открытии и смене места (не при загрузке фото — правки не теряются).
  useEffect(() => {
    if (!open) return;
    const defaultType = activeTypes[0];
    const targetHall = halls.find((h) => h.id === hallId);
    const spot = targetHall
      ? freeSpot(
          siblings.map((s) => s.position),
          { w: DEFAULT_POSITION.w, h: DEFAULT_POSITION.h },
          { width: targetHall.planWidth, height: targetHall.planHeight },
        )
      : { x: 0, y: 0 };
    form.resetFields();
    form.setFieldsValue(
      venueToForm(venue, {
        hallId,
        typeId: defaultType?.id ?? '',
        typeRules: venue ? (types.find((type) => type.id === venue.typeId)?.rules ?? venue.rules) : (defaultType?.rules ?? DEFAULT_RULES),
        position: { ...DEFAULT_POSITION, ...spot },
      }),
    );
  }, [open, venueId, form]);

  // Сменили тип — «как у типа» показывает правила нового типа.
  useEffect(() => {
    if (!open || !typeRules) return;
    const overrides = form.getFieldValue('overrides') as VenueFormValues['overrides'] | undefined;
    if (!overrides) return;
    for (const key of RULE_KEYS) {
      if (!overrides[key]?.custom) form.setFieldValue(['overrides', key, 'value'], typeRules[key]);
    }
  }, [typeRules, open, form]);

  const refresh = (saved?: Venue) => {
    if (saved) queryClient.setQueryData<Venue[]>(venueKeys.venues(branchId), (list) => list?.map((v) => (v.id === saved.id ? saved : v)));
    void queryClient.invalidateQueries({ queryKey: venueKeys.venues(branchId) });
    void queryClient.invalidateQueries({ queryKey: ['reservations', 'timeline', branchId] });
  };

  const submit = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    const values = form.getFieldsValue(true) as VenueFormValues;
    const capacity = capacityIssue(values.capacityMin, values.capacityMax);
    const deposit = depositIssue(values);
    if (capacity || deposit) {
      form.setFields([
        ...(capacity ? [{ name: 'capacityMax' as const, errors: [t(`venues.venues.issues.${capacity}`)] }] : []),
        ...(deposit ? [{ name: 'depositAmount' as const, errors: [t(`venues.venues.issues.${deposit}`)] }] : []),
      ]);
      return;
    }
    setSaving(true);
    try {
      const input = formToVenueInput(values);
      const saved = venue ? await venueConfigApi.updateVenue(venue.id, input) : await venueConfigApi.createVenue(input);
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
    if (!venue) return;
    setUploading(true);
    let current: Venue | null = null;
    try {
      for (const file of files) current = await venueConfigApi.addVenuePhoto(venue.id, file);
      void message.success(t('venues.venues.photoUploaded'));
    } catch (error) {
      notifyError(error);
    } finally {
      setUploading(false);
      if (current) {
        refresh(current);
        onSaved(current);
      }
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={760}
      destroyOnHidden
      title={venue ? t('venues.venues.editTitle', { code: venue.code }) : t('venues.venues.createTitle')}
      extra={
        <Space>
          {venue && canEdit ? (
            <ConfirmAction
              title={t('venues.venues.deleteConfirm')}
              danger
              okText={t('common.delete')}
              successMessage={t('venues.venues.deleted')}
              onConfirm={async () => {
                await venueConfigApi.deleteVenue(venue.id);
                refresh();
                onClose();
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
      {venue && !venue.isBookable ? <Alert type="warning" showIcon message={t('venues.venues.notBookable')} style={{ marginBottom: 12 }} /> : null}
      <Form<VenueFormValues> form={form} layout="vertical" requiredMark="optional" disabled={!canEdit}>
        <Row gutter={12}>
          <Col xs={24} sm={8}>
            <Form.Item name="hallId" label={t('venues.fields.hall')} rules={[{ required: true }]}>
              <Select options={halls.map((h) => ({ value: h.id, label: translate(h.name, i18n.language) || h.code }))} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="typeId" label={t('venues.fields.type')} rules={[{ required: true }]}>
              <Select options={activeTypes.map((type) => ({ value: type.id, label: translate(type.name, i18n.language) || type.code }))} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item
              name="code"
              label={t('venues.fields.code')}
              extra={t('venues.venues.codeHint')}
              rules={[{ required: true, pattern: VENUE_CODE_RE, message: t('venues.venues.codeHint') }]}
            >
              <Input maxLength={32} />
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
          <Col xs={12} sm={6}>
            <Form.Item name="capacityMin" label={t('venues.fields.capacityMin')} rules={[{ required: true, type: 'integer', min: 1, max: MAX_VENUE_CAPACITY }]}>
              <InputNumber min={1} max={MAX_VENUE_CAPACITY} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={6}>
            <Form.Item name="capacityMax" label={t('venues.fields.capacityMax')} rules={[{ required: true, type: 'integer', min: 1, max: MAX_VENUE_CAPACITY }]}>
              <InputNumber min={1} max={MAX_VENUE_CAPACITY} precision={0} style={{ width: '100%' }} />
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

        <Divider orientation="left" plain>
          {t('venues.fields.deposit')}
        </Divider>
        <Row gutter={12} align="middle">
          <Col xs={24} sm={10}>
            <Form.Item name="depositEnabled" valuePropName="checked" label={t('venues.fields.depositEnabled')}>
              <Switch
                onChange={(checked) => {
                  if (!checked) form.setFields([{ name: 'depositAmount', errors: [] }]);
                }}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={14}>
            {depositEnabled ? (
              <Form.Item name="depositAmount" label={t('venues.fields.depositAmount')} required>
                <MoneyInput />
              </Form.Item>
            ) : null}
          </Col>
        </Row>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -8 }}>
          {t('venues.venues.depositHint')}
        </Typography.Paragraph>

        <Divider orientation="left" plain>
          {t('venues.fields.rules')}
        </Divider>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('venues.venues.rulesHint')}
        </Typography.Paragraph>
        <OverrideRulesFields form={form} typeRules={typeRules} disabled={!canEdit} />

        <Divider orientation="left" plain>
          {t('venues.fields.position')}
        </Divider>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('venues.venues.positionHint')}
          {hall ? ` ${t('venues.fields.planSize')}: ${hall.planWidth}×${hall.planHeight}.` : ''}
        </Typography.Paragraph>
        <Row gutter={8}>
          {(['x', 'y', 'w', 'h'] as const).map((key) => (
            <Col key={key} xs={6} sm={4}>
              <Form.Item name={key} label={t(`venues.fields.${key}`)} rules={[{ required: true, type: 'integer', min: key === 'x' || key === 'y' ? 0 : 1 }]}>
                <InputNumber min={key === 'x' || key === 'y' ? 0 : 1} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          ))}
          <Col xs={12} sm={4}>
            <Form.Item name="rotation" label={t('venues.fields.rotation')} rules={[{ required: true, type: 'integer', min: 0, max: 359 }]}>
              <InputNumber min={0} max={359} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={4}>
            <Form.Item name="shape" label={t('venues.fields.shape')}>
              <Segmented size="small" options={VENUE_SHAPES.map((shape) => ({ value: shape, label: t(`venues.shapes.${shape}`) }))} />
            </Form.Item>
          </Col>
        </Row>
      </Form>

      <Divider orientation="left" plain>
        {t('venues.fields.photos')}
      </Divider>
      {!venue ? (
        <Typography.Text type="secondary">{t('venues.venues.photosAfterCreate')}</Typography.Text>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }}>
          {venue.photos.length > 0 ? (
            <Image.PreviewGroup>
              <Flex gap={8} wrap>
                {venue.photos.map((photo) => (
                  <div key={photo.id} style={{ position: 'relative' }}>
                    <Image src={photo.thumbnailUrl ?? photo.url} width={120} height={90} style={{ objectFit: 'cover', borderRadius: 8 }} preview={{ src: photo.url }} />
                    {canEdit ? (
                      <ConfirmAction
                        title={t('common.delete')}
                        danger
                        successMessage={t('venues.venues.photoDeleted')}
                        buttonProps={{ size: 'small', icon: <DeleteOutlined />, style: { position: 'absolute', top: 4, right: 4 }, 'aria-label': t('common.delete') }}
                        onConfirm={async () => {
                          const saved = await venueConfigApi.deleteVenuePhoto(venue.id, photo.id);
                          refresh(saved);
                          onSaved(saved);
                        }}
                      >
                        {null}
                      </ConfirmAction>
                    ) : null}
                  </div>
                ))}
              </Flex>
            </Image.PreviewGroup>
          ) : null}
          {canEdit && venue.photos.length < MAX_PHOTOS ? (
            <ImageDropZone multiple limit={MAX_PHOTOS - venue.photos.length} loading={uploading} hint={t('venues.venues.photosHint')} onFiles={(files) => void upload(files)}>
              {t('venues.venues.dropPhotos')}
            </ImageDropZone>
          ) : null}
        </Space>
      )}
    </Drawer>
  );
}
