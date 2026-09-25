import { CheckCircleTwoTone, EnvironmentOutlined, SendOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Flex,
  Form,
  Input,
  Radio,
  Result,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Typography,
} from 'antd';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Permission, translate, type GeoPoint } from '@aula/api-client';
import { useApiMutation, useApiQuery } from '@/shared/api/hooks';
import { useBranch } from '@/shared/branch/BranchProvider';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { BranchSelect } from '@/shared/ui/BranchSelect';
import { ordersApi, ordersKeys, phoneOrderKeys, storefrontApi } from '../api';
import { BranchScope, useBranchIdsWith } from '../common/BranchScope';
import { formatQueueTime } from '../queue/QueueCard';
import type { AdminCreateOrderInput, AdminOrderDetails, CheckoutPaymentMethod, OrderType, PublicDishCard } from '../types';
import { DishPicker } from './DishPicker';
import { ModifiersModal } from './ModifiersModal';
import {
  addLine,
  buildCreateInput,
  buildQuoteInput,
  checkoutChecks,
  newIdempotencyKey,
  normalizePhoneInput,
  removeLine,
  setLineQuantity,
  type CartLine,
  type PhoneOrderDetails,
  type PhoneOrderDraft,
} from './phone-order';
import { QuotePanel } from './QuotePanel';

const AddressMap = lazy(() => import('./AddressMap'));

type Locale = 'kk' | 'ru' | 'en';
const QUOTE_DEBOUNCE_MS = 400;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

type FormValues = Omit<PhoneOrderDetails, 'scheduledFor' | 'paymentMethod' | 'locale'> & { phone: string };

const INITIAL_VALUES: FormValues = {
  phone: '',
  name: '',
  email: '',
  addressText: '',
  apartment: '',
  entrance: '',
  floor: '',
  intercom: '',
  courierComment: '',
  contactless: false,
  comment: '',
  consent: false,
  marketing: false,
};

function PhoneOrderForm({ branchId, onCreated }: { branchId: string; onCreated: (order: AdminOrderDetails) => void }) {
  const { t, i18n } = useTranslation();
  const { getBranch, setSelection } = useBranch();
  const allowedBranches = useBranchIdsWith(Permission.OrdersManage);
  const branch = getBranch(branchId);
  const uiLocale: Locale = i18n.language === 'kk' ? 'kk' : 'ru';
  const [form] = Form.useForm<FormValues>();

  const acceptsDelivery = branch?.settings.acceptsDelivery ?? true;
  const acceptsPickup = branch?.settings.acceptsPickup ?? true;
  const paymentMethods = branch?.settings.paymentMethods ?? ['online', 'on_receipt'];

  const [type, setType] = useState<OrderType>(acceptsDelivery ? 'delivery' : 'pickup');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [point, setPoint] = useState<GeoPoint | null>(null);
  const [promoInput, setPromoInput] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [certificateInput, setCertificateInput] = useState('');
  const [certificateCode, setCertificateCode] = useState('');
  const [scheduled, setScheduled] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod>(paymentMethods.includes('on_receipt') ? 'on_receipt' : 'online');
  const [locale, setLocale] = useState<Locale>(uiLocale);
  const [modifiersFor, setModifiersFor] = useState<PublicDishCard | null>(null);
  const [idempotencyKey] = useState(newIdempotencyKey);

  const phone = Form.useWatch('phone', form) ?? '';
  const name = Form.useWatch('name', form) ?? '';
  const addressText = Form.useWatch('addressText', form) ?? '';
  const consent = Form.useWatch('consent', form) ?? false;

  // ---------------------------------------------------------------- Расчёт сервера
  const draft: PhoneOrderDraft = useMemo(
    () => ({ branchId, type, cart, point, promoCode, certificateCode, phone }),
    [branchId, type, cart, point, promoCode, certificateCode, phone],
  );
  const quoteInput = useMemo(() => buildQuoteInput(draft), [draft]);
  const debouncedInput = useDebounced(quoteInput, QUOTE_DEBOUNCE_MS);
  const quote = useApiQuery(phoneOrderKeys.quote(debouncedInput), () => ordersApi.quote(debouncedInput!), {
    enabled: debouncedInput !== null,
    keepPrevious: true,
    retry: false,
  });
  const quoteData = quoteInput ? quote.data : undefined;
  const quoteStale = quoteInput !== null && (JSON.stringify(quoteInput) !== JSON.stringify(debouncedInput) || quote.isFetching);

  // ---------------------------------------------------------------- Время и зоны
  const slots = useApiQuery(phoneOrderKeys.slots(branchId, type, date), () => storefrontApi.slots(branchId, type, date, uiLocale), {
    staleTime: 60_000,
  });
  const zones = useApiQuery(phoneOrderKeys.zones(branchId, uiLocale), () => storefrontApi.zones(branchId, uiLocale), {
    enabled: type === 'delivery',
    staleTime: 5 * 60_000,
  });
  const asapUnavailable = slots.data && !slots.data.asap.available ? slots.data.asap.reason : null;
  useEffect(() => {
    if (asapUnavailable) setScheduled(true);
  }, [asapUnavailable]);

  const create = useApiMutation((input: AdminCreateOrderInput) => ordersApi.create(input), {
    invalidate: [ordersKeys.all],
    onSuccess: (order) => onCreated(order),
  });

  const checks = checkoutChecks(draft, { name, addressText, consent, scheduledFor: slot, scheduled }, quoteData);
  const canSubmit = checks.length === 0 && !quoteStale && Boolean(quoteData?.canCheckout);

  const submit = async () => {
    const values: FormValues = { ...INITIAL_VALUES, ...(await form.validateFields()) };
    const details: PhoneOrderDetails = { ...values, paymentMethod, scheduledFor: scheduled ? slot : null, locale };
    create.mutate(buildCreateInput(draft, details, idempotencyKey));
  };

  const pickDish = (dish: PublicDishCard) => {
    if (dish.hasModifiers) setModifiersFor(dish);
    else setCart((current) => addLine(current, { dishId: dish.id, dishSlug: dish.slug, name: dish.name, quantity: 1, modifierOptionIds: [], modifierLabels: [] }));
  };

  if (!branch) return <Spin style={{ display: 'block', margin: '48px auto' }} />;
  const branchLabel = translate(branch.name, i18n.language);

  return (
    <Form<FormValues> form={form} layout="vertical" initialValues={INITIAL_VALUES} requiredMark={false} size="large">
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item label={t('orders.phone.branch')}>
                    <BranchSelect value={branchId} onlyIds={allowedBranches} onChange={(id) => id && setSelection(id)} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label={t('orders.phone.type')}>
                    <Segmented<OrderType>
                      block
                      value={type}
                      onChange={(value) => {
                        setType(value);
                        setSlot(null);
                      }}
                      options={[
                        { value: 'delivery', label: t('orders.type.delivery'), disabled: !acceptsDelivery },
                        { value: 'pickup', label: t('orders.type.pickup'), disabled: !acceptsPickup },
                      ]}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Typography.Title level={5} style={{ marginTop: 0 }}>
                {t('orders.phone.customer')}
              </Typography.Title>
              <Row gutter={16}>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="phone"
                    label={t('orders.phone.phone')}
                    extra={t('orders.phone.phoneHint')}
                    rules={[
                      {
                        validator: async (_, value: string) => {
                          if (!/^\+7\d{10}$/.test(normalizePhoneInput(value ?? ''))) throw new Error(t('orders.phone.phoneRule'));
                        },
                      },
                    ]}
                  >
                    <Input inputMode="tel" autoComplete="off" placeholder="+7 777 123 45 67" onBlur={(e) => form.setFieldValue('phone', normalizePhoneInput(e.target.value))} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="name" label={t('orders.phone.name')} rules={[{ required: true, whitespace: true, message: t('orders.phone.checks.name') }]}>
                    <Input maxLength={100} autoComplete="off" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="email" label={t('orders.phone.email')} rules={[{ type: 'email', message: t('common.invalidEmail') }]}>
                    <Input maxLength={200} autoComplete="off" />
                  </Form.Item>
                </Col>
              </Row>
            </Card>

            {type === 'delivery' ? (
              <Card title={t('orders.phone.address')}>
                <Form.Item name="addressText" label={t('orders.phone.addressText')} rules={[{ required: true, min: 3, whitespace: true, message: t('orders.phone.checks.address') }]}>
                  <Input maxLength={500} placeholder={t('orders.phone.addressPlaceholder')} />
                </Form.Item>
                <Row gutter={12}>
                  {(['apartment', 'entrance', 'floor', 'intercom'] as const).map((field) => (
                    <Col key={field} xs={12} md={6}>
                      <Form.Item name={field} label={t(`orders.phone.${field}`)}>
                        <Input maxLength={50} />
                      </Form.Item>
                    </Col>
                  ))}
                </Row>
                <Form.Item name="courierComment" label={t('orders.phone.courierComment')}>
                  <Input maxLength={500} />
                </Form.Item>
                <Form.Item name="contactless" valuePropName="checked">
                  <Checkbox>{t('orders.phone.contactless')}</Checkbox>
                </Form.Item>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  <EnvironmentOutlined /> {t('orders.phone.mapHint')}
                </Typography.Paragraph>
                <Suspense fallback={<Spin />}>
                  <AddressMap
                    value={point}
                    onChange={setPoint}
                    branch={branch.location}
                    branchLabel={branchLabel}
                    zones={zones.data ?? []}
                    activeZoneId={quoteData?.delivery?.zoneId ?? null}
                  />
                </Suspense>
                <Typography.Text type={point ? 'secondary' : 'warning'} style={{ display: 'block', marginTop: 6 }}>
                  {point ? t('orders.phone.point', { lat: point.lat, lng: point.lng }) : t('orders.phone.pointMissing')}
                </Typography.Text>
              </Card>
            ) : null}

            <Card>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item label={t('orders.phone.time')}>
                    <Radio.Group value={scheduled ? 'scheduled' : 'asap'} onChange={(e) => setScheduled(e.target.value === 'scheduled')}>
                      <Radio.Button value="asap" disabled={Boolean(asapUnavailable)}>
                        {t('orders.phone.asap')}
                      </Radio.Button>
                      <Radio.Button value="scheduled">{t('orders.phone.scheduled')}</Radio.Button>
                    </Radio.Group>
                    {asapUnavailable ? (
                      <Typography.Text type="warning" style={{ display: 'block', marginTop: 6 }}>
                        {t(`orders.phone.asapUnavailable.${asapUnavailable}`)}
                      </Typography.Text>
                    ) : null}
                    {!scheduled && slots.data?.asap.readyAt ? (
                      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6 }}>
                        {t('orders.phone.readyAt', { time: formatQueueTime(slots.data.asap.readyAt) })}
                      </Typography.Text>
                    ) : null}
                  </Form.Item>
                  {scheduled ? (
                    <Space wrap>
                      <Select<string>
                        style={{ minWidth: 150 }}
                        placeholder={t('orders.phone.date')}
                        value={date ?? slots.data?.date}
                        loading={slots.isFetching}
                        onChange={(value) => {
                          setDate(value);
                          setSlot(null);
                        }}
                        options={(slots.data?.dates ?? []).map((d) => ({ value: d, label: d.split('-').reverse().join('.') }))}
                      />
                      <Select<string>
                        style={{ minWidth: 120 }}
                        placeholder={t('orders.phone.slot')}
                        value={slot ?? undefined}
                        onChange={setSlot}
                        notFoundContent={t('orders.phone.noSlots')}
                        options={(slots.data?.slots ?? []).map((s) => ({ value: s.at, label: s.time }))}
                      />
                    </Space>
                  ) : null}
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label={t('orders.phone.payment')} extra={paymentMethod === 'online' ? t('orders.phone.paymentOnlineHint') : undefined}>
                    <Radio.Group value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as CheckoutPaymentMethod)}>
                      <Radio.Button value="on_receipt" disabled={!paymentMethods.includes('on_receipt')}>
                        {t('orders.phone.paymentOnReceipt')}
                      </Radio.Button>
                      <Radio.Button value="online" disabled={!paymentMethods.includes('online')}>
                        {t('orders.phone.paymentOnline')}
                      </Radio.Button>
                    </Radio.Group>
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col xs={24} md={12}>
                  <Form.Item label={t('orders.phone.promoCode')}>
                    <Space.Compact style={{ width: '100%' }}>
                      <Input
                        value={promoInput}
                        maxLength={32}
                        allowClear
                        onChange={(e) => {
                          setPromoInput(e.target.value);
                          if (!e.target.value) setPromoCode('');
                        }}
                        onPressEnter={(e) => {
                          e.preventDefault();
                          setPromoCode(promoInput.trim());
                        }}
                      />
                      <Button onClick={() => setPromoCode(promoInput.trim())}>{t('orders.phone.apply')}</Button>
                    </Space.Compact>
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item label={t('orders.phone.certificateCode')}>
                    <Space.Compact style={{ width: '100%' }}>
                      <Input
                        value={certificateInput}
                        maxLength={32}
                        allowClear
                        onChange={(e) => {
                          setCertificateInput(e.target.value);
                          if (!e.target.value) setCertificateCode('');
                        }}
                        onPressEnter={(e) => {
                          e.preventDefault();
                          setCertificateCode(certificateInput.trim());
                        }}
                      />
                      <Button onClick={() => setCertificateCode(certificateInput.trim())}>{t('orders.phone.apply')}</Button>
                    </Space.Compact>
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="comment" label={t('orders.phone.comment')}>
                <Input.TextArea rows={2} maxLength={1000} />
              </Form.Item>
              <Form.Item label={t('orders.phone.locale')}>
                <Select<Locale>
                  style={{ maxWidth: 220 }}
                  value={locale}
                  onChange={setLocale}
                  options={[
                    { value: 'kk', label: t('languages.kk') },
                    { value: 'ru', label: t('languages.ru') },
                    { value: 'en', label: 'English' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="consent" valuePropName="checked" rules={[{ validator: async (_, v: boolean) => (v ? undefined : Promise.reject(new Error(t('orders.phone.consentRule')))) }]}>
                <Checkbox>{t('orders.phone.consent')}</Checkbox>
              </Form.Item>
              <Form.Item name="marketing" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Checkbox>{t('orders.phone.marketing')}</Checkbox>
              </Form.Item>
            </Card>
          </Space>
        </Col>

        <Col xs={24} xl={10}>
          <Space direction="vertical" size={16} style={{ width: '100%', position: 'sticky', top: 72 }}>
            <Card title={t('orders.phone.menu')} size="small">
              <DishPicker branchSlug={branch.slug} locale={uiLocale} onPick={pickDish} />
            </Card>
            <Card title={t('orders.phone.cart.title')} size="small">
              {quote.error && quoteInput ? <ErrorAlert error={quote.error} onRetry={() => void quote.refetch()} /> : null}
              <QuotePanel
                cart={cart}
                quote={quoteData}
                stale={quoteStale}
                onQuantity={(key, quantity) => setCart((current) => setLineQuantity(current, key, quantity))}
                onRemove={(key) => setCart((current) => removeLine(current, key))}
                onClear={() => setCart([])}
              />
              {checks.length > 0 ? (
                <Alert
                  type="info"
                  style={{ marginTop: 12 }}
                  message={
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {checks.map((check) => (
                        <li key={check}>{t(`orders.phone.checks.${check}`)}</li>
                      ))}
                    </ul>
                  }
                />
              ) : null}
              <Button
                type="primary"
                size="large"
                block
                icon={<SendOutlined />}
                style={{ marginTop: 12, minHeight: 52 }}
                disabled={!canSubmit}
                loading={create.isPending}
                onClick={() => void submit().catch(() => undefined)}
              >
                {t('orders.phone.submit')}
              </Button>
            </Card>
          </Space>
        </Col>
      </Row>
      <ModifiersModal
        branchSlug={branch.slug}
        locale={uiLocale}
        dish={modifiersFor}
        onClose={() => setModifiersFor(null)}
        onAdd={({ optionIds, labels, quantity }) => {
          const dish = modifiersFor;
          if (dish) {
            setCart((current) =>
              addLine(current, { dishId: dish.id, dishSlug: dish.slug, name: dish.name, quantity, modifierOptionIds: optionIds, modifierLabels: labels }),
            );
          }
          setModifiersFor(null);
        }}
      />
    </Form>
  );
}

/**
 * Заказ по телефону (канал admin, право orders.manage в филиале): филиал, тип, блюда с модификаторами
 * (меню витрины филиала), гость, адрес и точка на карте, время, оплата при получении или онлайн
 * (ссылку отправляет сервер), промокод. Итог — только из POST /admin/orders/quote.
 */
export function PhoneOrderPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [created, setCreated] = useState<AdminOrderDetails | null>(null);
  const [formKey, setFormKey] = useState(0);

  if (created) {
    return (
      <Card>
        <Result
          icon={<CheckCircleTwoTone twoToneColor="#2f7d4f" />}
          title={t('orders.phone.created', { number: created.number })}
          subTitle={created.paymentMethod === 'online' ? t('orders.phone.createdOnline') : undefined}
          extra={
            <Flex gap={8} justify="center" wrap>
              <Button type="primary" size="large" onClick={() => navigate(`/orders/${created.id}`)}>
                {t('orders.phone.openOrder')}
              </Button>
              <Button
                size="large"
                onClick={() => {
                  setCreated(null);
                  setFormKey((k) => k + 1);
                }}
              >
                {t('orders.phone.newOrder')}
              </Button>
            </Flex>
          }
        />
      </Card>
    );
  }

  return (
    <BranchScope permission={Permission.OrdersManage} title={t('orders.phone.selectBranch')} none={t('orders.phone.noBranches')}>
      {(branchId) => <PhoneOrderForm key={`${branchId}:${formKey}`} branchId={branchId} onCreated={setCreated} />}
    </BranchScope>
  );
}
