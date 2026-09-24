import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox, Col, Drawer, Form, Input, InputNumber, Radio, Row, Select, Space, Switch, Tabs } from 'antd';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Branch, BranchInput, BranchSettings, OpeningHours, Translatable } from '@aula/api-client';
import { branchesApi, legalEntitiesApi } from '@/shared/api/endpoints';
import { queryKeys } from '@/shared/api/query-keys';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { PageLoader } from '@/shared/ui/PageLoader';
import { TranslatableInput, translatableRule } from '@/shared/ui/TranslatableInput';
import { cleanOpeningHours, validateOpeningHours } from './opening-hours';
import { OpeningHoursEditor } from './OpeningHoursEditor';

const MapPointPicker = lazy(() => import('./MapPointPicker'));

/** Часовые пояса Казахстана (IANA). С 2024 года вся страна живёт по UTC+5. */
const TIMEZONES = ['Asia/Almaty', 'Asia/Qostanay', 'Asia/Aqtobe', 'Asia/Aqtau', 'Asia/Atyrau', 'Asia/Oral', 'Asia/Qyzylorda'];

/** Значения по умолчанию для нового филиала — как DEFAULT_BRANCH_SETTINGS на сервере. */
const DEFAULT_SETTINGS: BranchSettings = {
  acceptsDelivery: true,
  acceptsPickup: true,
  acceptsReservations: true,
  deliveryLeadMinutes: 60,
  pickupLeadMinutes: 30,
  maxScheduleDaysAhead: 7,
  stopListMode: 'mark_unavailable',
  paymentMethods: ['online', 'on_receipt'],
  awaitingPaymentTimeoutMinutes: 20,
  requirePhoneVerificationForOnReceipt: true,
  requirePhoneVerificationForReservations: false,
  staffNotifyPhone: null,
  staffTelegramChatId: null,
};

const DEFAULT_HOURS: OpeningHours = Object.fromEntries(
  (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((d) => [d, [{ open: '10:00', close: '23:00' }]]),
);

interface BranchFormValues {
  code: string;
  slug: string;
  name: Translatable;
  address: Translatable;
  lat: number;
  lng: number;
  phone: string;
  whatsapp?: string;
  email?: string;
  timezone: string;
  legalEntityId?: string | null;
  isActive: boolean;
  sortOrder: number;
  openingHours: OpeningHours;
  settings: BranchSettings;
}

function nullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function BranchFormDrawer({
  open,
  branch,
  onClose,
  onSaved,
}: {
  open: boolean;
  branch: Branch | null;
  onClose: () => void;
  onSaved: (branch: Branch) => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm<BranchFormValues>();
  const notifyError = useNotifyError();
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('main');
  const legalEntities = useQuery({ queryKey: queryKeys.legalEntities, queryFn: legalEntitiesApi.list, enabled: open });
  const lat = Form.useWatch('lat', form);
  const lng = Form.useWatch('lng', form);

  useEffect(() => {
    if (!open) return;
    setTab('main');
    form.resetFields();
    if (branch) {
      form.setFieldsValue({
        code: branch.code,
        slug: branch.slug,
        name: branch.name,
        address: branch.address,
        lat: branch.location.lat,
        lng: branch.location.lng,
        phone: branch.phone,
        whatsapp: branch.whatsapp ?? undefined,
        email: branch.email ?? undefined,
        timezone: branch.timezone,
        legalEntityId: branch.legalEntityId,
        isActive: branch.isActive,
        sortOrder: branch.sortOrder,
        openingHours: branch.openingHours,
        settings: { ...DEFAULT_SETTINGS, ...branch.settings },
      });
    } else {
      form.setFieldsValue({
        timezone: 'Asia/Almaty',
        isActive: true,
        sortOrder: 0,
        openingHours: DEFAULT_HOURS,
        settings: DEFAULT_SETTINGS,
        lat: 51.1282,
        lng: 71.4304,
        legalEntityId: legalEntities.data?.find((e) => e.isDefault)?.id ?? null,
      });
    }
  }, [open, branch, form, legalEntities.data]);

  const submit = async () => {
    let values: BranchFormValues;
    try {
      values = await form.validateFields();
    } catch (error) {
      // Переключаемся на вкладку с первой ошибкой.
      const first = (error as { errorFields?: Array<{ name: Array<string | number> }> }).errorFields?.[0]?.name[0];
      if (first === 'openingHours') setTab('hours');
      else if (first === 'settings') setTab('settings');
      else if (first === 'lat' || first === 'lng') setTab('location');
      else setTab('main');
      return;
    }
    const input: BranchInput = {
      code: values.code.trim().toUpperCase(),
      slug: values.slug.trim().toLowerCase(),
      name: values.name,
      address: values.address,
      location: { lat: values.lat, lng: values.lng },
      phone: values.phone.trim(),
      whatsapp: nullable(values.whatsapp),
      email: nullable(values.email),
      timezone: values.timezone,
      openingHours: cleanOpeningHours(values.openingHours),
      settings: {
        ...values.settings,
        staffNotifyPhone: nullable(values.settings.staffNotifyPhone),
        staffTelegramChatId: nullable(values.settings.staffTelegramChatId),
      },
      legalEntityId: values.legalEntityId ?? null,
      isActive: values.isActive,
      sortOrder: values.sortOrder,
    };
    setSaving(true);
    try {
      onSaved(branch ? await branchesApi.update(branch.id, input) : await branchesApi.create(input));
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  const req = { required: true, message: t('common.required') };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={760}
      title={branch ? t('branches.editTitle') : t('branches.createTitle')}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="primary" loading={saving} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </Space>
      }
    >
      <Form<BranchFormValues> form={form} layout="vertical" requiredMark="optional">
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'main',
              label: t('branches.tabs.main'),
              forceRender: true,
              children: (
                <>
                  <Row gutter={12}>
                    <Col xs={24} sm={8}>
                      <Form.Item name="code" label={t('branches.code')} extra={t('branches.codeHint')} rules={[req, { pattern: /^[A-Za-z0-9]{1,6}$/, message: t('branches.codeRule') }]}>
                        <Input maxLength={6} style={{ textTransform: 'uppercase' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={16}>
                      <Form.Item name="slug" label={t('branches.slug')} extra={t('branches.slugHint')} rules={[req, { pattern: /^[a-z0-9]+(-[a-z0-9]+)*$/, message: t('branches.slugRule') }]}>
                        <Input addonBefore="/ru/" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name="name" label={t('branches.name')} rules={[translatableRule(t('translatable.required'))]}>
                    <TranslatableInput maxLength={200} />
                  </Form.Item>
                  <Form.Item name="address" label={t('branches.address')} rules={[translatableRule(t('translatable.required'))]}>
                    <TranslatableInput maxLength={300} />
                  </Form.Item>
                  <Row gutter={12}>
                    <Col xs={24} sm={12}>
                      <Form.Item name="phone" label={t('branches.phone')} rules={[req]}>
                        <Input inputMode="tel" placeholder="+77172000000" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="whatsapp" label={t('branches.whatsapp')}>
                        <Input inputMode="tel" placeholder="+77010000000" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="email" label={t('auth.email')} rules={[{ type: 'email', message: t('common.invalidEmail') }]}>
                        <Input inputMode="email" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="timezone" label={t('branches.timezone')} rules={[req]}>
                        <Select options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name="legalEntityId" label={t('branches.legalEntity')} extra={t('branches.legalEntityHint')}>
                        <Select
                          allowClear
                          loading={legalEntities.isLoading}
                          options={(legalEntities.data ?? []).map((e) => ({ value: e.id, label: `${e.shortName} · ${e.bin}` }))}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={6}>
                      <Form.Item name="sortOrder" label={t('branches.sortOrder')}>
                        <InputNumber precision={0} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={12} sm={6}>
                      <Form.Item name="isActive" label={t('branches.isActive')} valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              ),
            },
            {
              key: 'location',
              label: t('branches.tabs.location'),
              forceRender: true,
              children: (
                <>
                  <Row gutter={12}>
                    <Col xs={12}>
                      <Form.Item name="lat" label={t('branches.lat')} rules={[req, { type: 'number', min: -90, max: 90 }]}>
                        <InputNumber step={0.0001} precision={6} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={12}>
                      <Form.Item name="lng" label={t('branches.lng')} rules={[req, { type: 'number', min: -180, max: 180 }]}>
                        <InputNumber step={0.0001} precision={6} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <p style={{ marginTop: 0, color: '#6b5a4b' }}>{t('branches.mapHint')}</p>
                  {tab === 'location' ? (
                    <Suspense fallback={<PageLoader />}>
                      <MapPointPicker
                        value={typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null}
                        onChange={(point) => form.setFieldsValue({ lat: point.lat, lng: point.lng })}
                      />
                    </Suspense>
                  ) : null}
                </>
              ),
            },
            {
              key: 'hours',
              label: t('branches.tabs.hours'),
              forceRender: true,
              children: (
                <Form.Item
                  name="openingHours"
                  rules={[
                    {
                      validator: async (_, hours: OpeningHours | undefined) => {
                        if (hours && Object.keys(validateOpeningHours(hours)).length > 0) throw new Error(t('branches.hours.fixIssues'));
                      },
                    },
                  ]}
                >
                  <OpeningHoursEditor />
                </Form.Item>
              ),
            },
            {
              key: 'settings',
              label: t('branches.tabs.settings'),
              forceRender: true,
              children: (
                <>
                  <Row gutter={12}>
                    {(['acceptsDelivery', 'acceptsPickup', 'acceptsReservations'] as const).map((key) => (
                      <Col xs={24} sm={8} key={key}>
                        <Form.Item name={['settings', key]} label={t(`branches.settings.${key}`)} valuePropName="checked">
                          <Switch />
                        </Form.Item>
                      </Col>
                    ))}
                  </Row>
                  <Form.Item
                    name={['settings', 'paymentMethods']}
                    label={t('branches.settings.paymentMethods')}
                    rules={[{ type: 'array', min: 1, message: t('branches.settings.paymentMethodsRule') }]}
                  >
                    <Checkbox.Group
                      options={[
                        { value: 'online', label: t('branches.settings.paymentOnline') },
                        { value: 'on_receipt', label: t('branches.settings.paymentOnReceipt') },
                      ]}
                    />
                  </Form.Item>
                  <Row gutter={12}>
                    <Col xs={24} sm={12}>
                      <Form.Item name={['settings', 'deliveryLeadMinutes']} label={t('branches.settings.deliveryLeadMinutes')}>
                        <InputNumber min={0} max={1440} precision={0} addonAfter={t('common.minutes')} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name={['settings', 'pickupLeadMinutes']} label={t('branches.settings.pickupLeadMinutes')}>
                        <InputNumber min={0} max={1440} precision={0} addonAfter={t('common.minutes')} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name={['settings', 'maxScheduleDaysAhead']} label={t('branches.settings.maxScheduleDaysAhead')}>
                        <InputNumber min={0} max={60} precision={0} addonAfter={t('common.days')} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name={['settings', 'awaitingPaymentTimeoutMinutes']} label={t('branches.settings.awaitingPaymentTimeoutMinutes')}>
                        <InputNumber min={5} max={1440} precision={0} addonAfter={t('common.minutes')} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name={['settings', 'stopListMode']} label={t('branches.settings.stopListMode')}>
                    <Radio.Group
                      options={[
                        { value: 'mark_unavailable', label: t('branches.settings.stopListMarkUnavailable') },
                        { value: 'hide', label: t('branches.settings.stopListHide') },
                      ]}
                    />
                  </Form.Item>
                  <Row gutter={12}>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name={['settings', 'requirePhoneVerificationForOnReceipt']}
                        label={t('branches.settings.requirePhoneVerificationForOnReceipt')}
                        valuePropName="checked"
                      >
                        <Switch />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        name={['settings', 'requirePhoneVerificationForReservations']}
                        label={t('branches.settings.requirePhoneVerificationForReservations')}
                        valuePropName="checked"
                      >
                        <Switch />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name={['settings', 'staffNotifyPhone']} label={t('branches.settings.staffNotifyPhone')} extra={t('branches.settings.staffNotifyPhoneHint')}>
                        <Input inputMode="tel" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item name={['settings', 'staffTelegramChatId']} label={t('branches.settings.staffTelegramChatId')}>
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              ),
            },
          ]}
        />
      </Form>
    </Drawer>
  );
}
