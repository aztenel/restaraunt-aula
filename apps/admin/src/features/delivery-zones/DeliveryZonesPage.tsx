import { CloseOutlined, DeleteOutlined, EditOutlined, PlusOutlined, UndoOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Badge, Button, Card, Col, Empty, Flex, Form, Grid, InputNumber, List, Row, Space, Spin, Switch, Tag, Typography } from 'antd';
import { lazy, Suspense, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney, Permission, toApiError, translate, type GeoPoint } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { useBranch } from '@/shared/branch/BranchProvider';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { PageHeader } from '@/shared/ui/PageHeader';
import { TranslatableInput } from '@/shared/ui/TranslatableInput';
import { BranchScope } from '@/features/orders/common/BranchScope';
import { MAP_COLORS } from '@/features/orders/common/map-config';
import { zonesApi, zonesKeys } from './api';
import {
  EMPTY_ZONE_FORM,
  formValuesToCreateInput,
  formValuesToZoneInput,
  MAX_ETA_MINUTES,
  validateZoneForm,
  zoneToFormValues,
  type DeliveryZone,
  type ZoneFormErrors,
  type ZoneFormValues,
} from './zone-form';

const ZonesMap = lazy(() => import('./ZonesMap'));

/** Форма зоны (своя форма на каждый выбор — ключ снаружи): поля, сохранение, удаление. */
function ZoneFormCard({
  zone,
  draft,
  dirty,
  saving,
  alert,
  onDirty,
  onSave,
  onDelete,
  onResetShape,
  onClose,
}: {
  /** undefined — новая зона. */
  zone: DeliveryZone | undefined;
  draft: GeoPoint[];
  dirty: boolean;
  saving: boolean;
  alert: { type: 'error' | 'warning'; message: string } | null;
  onDirty: () => void;
  onSave: (values: ZoneFormValues) => void;
  onDelete: () => Promise<void>;
  onResetShape: () => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [form] = Form.useForm<ZoneFormValues>();
  const title = zone ? t('deliveryZones.editTitle', { name: translate(zone.name, i18n.language) }) : t('deliveryZones.newTitle');

  const fieldRule = (field: keyof ZoneFormErrors) => ({
    validator: async () => {
      const issue = validateZoneForm({ ...EMPTY_ZONE_FORM, ...form.getFieldsValue(true) }, draft)[field];
      if (issue) throw new Error(t(`deliveryZones.issues.${issue}`));
    },
  });

  const save = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    onSave({ ...EMPTY_ZONE_FORM, ...form.getFieldsValue(true) });
  };

  return (
    <Card
      title={
        <Space wrap>
          {title}
          {dirty ? <Tag color="warning">{t('deliveryZones.unsaved')}</Tag> : null}
        </Space>
      }
      extra={<Button type="text" icon={<CloseOutlined />} aria-label={t('deliveryZones.close')} onClick={onClose} />}
      style={{ marginBottom: 16 }}
    >
      {alert ? <Alert type={alert.type} showIcon style={{ marginBottom: 12 }} message={alert.message} /> : null}
      <Flex justify="space-between" align="center" style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">{t('deliveryZones.points', { count: draft.length })}</Typography.Text>
        {zone ? (
          <Button size="small" icon={<UndoOutlined />} onClick={onResetShape}>
            {t('deliveryZones.resetShape')}
          </Button>
        ) : null}
      </Flex>
      <Form<ZoneFormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={zone ? zoneToFormValues(zone) : EMPTY_ZONE_FORM}
        onValuesChange={onDirty}
      >
        <Form.Item name="name" label={t('deliveryZones.name')} rules={[fieldRule('name')]}>
          <TranslatableInput maxLength={200} />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="deliveryFee" label={t('deliveryZones.deliveryFee')} rules={[fieldRule('deliveryFee')]}>
              <MoneyInput />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="minOrderAmount" label={t('deliveryZones.minOrderAmount')} rules={[fieldRule('minOrderAmount')]}>
              <MoneyInput />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="freeDeliveryFrom" label={t('deliveryZones.freeDeliveryFrom')} extra={t('deliveryZones.freeDeliveryHint')} rules={[fieldRule('freeDeliveryFrom')]}>
              <MoneyInput allowClear />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="etaMinutes" label={t('deliveryZones.etaMinutes')} rules={[fieldRule('etaMinutes')]}>
              <InputNumber min={1} max={MAX_ETA_MINUTES} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12}>
            <Form.Item name="sortOrder" label={t('deliveryZones.sortOrder')}>
              <InputNumber precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12}>
            <Form.Item name="isActive" label={t('deliveryZones.isActive')} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
        </Row>
      </Form>
      <Flex gap={8} wrap justify="space-between">
        <Button type="primary" size="large" loading={saving} onClick={() => void save()}>
          {t('common.save')}
        </Button>
        {zone ? (
          <ConfirmAction
            danger
            title={t('deliveryZones.deleteConfirm', { name: translate(zone.name, i18n.language) })}
            description={t('deliveryZones.deleteHint')}
            successMessage={t('deliveryZones.deleted')}
            buttonProps={{ icon: <DeleteOutlined />, size: 'large' }}
            onConfirm={onDelete}
          >
            {t('deliveryZones.delete')}
          </ConfirmAction>
        ) : null}
      </Flex>
    </Card>
  );
}

type Selection = string | 'new' | null;

function ZonesEditor({ branchId }: { branchId: string }) {
  const { t, i18n } = useTranslation();
  const { modal, message } = App.useApp();
  const notifyError = useNotifyError();
  const queryClient = useQueryClient();
  const screens = Grid.useBreakpoint();
  const { getBranch, branchName } = useBranch();
  const branch = getBranch(branchId);

  const zonesQuery = useApiQuery(zonesKeys.branch(branchId), () => zonesApi.list(branchId));
  const zones = useMemo(() => [...(zonesQuery.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [zonesQuery.data]);

  const [selected, setSelected] = useState<Selection>(null);
  const [draft, setDraft] = useState<GeoPoint[]>([]);
  const [version, setVersion] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflictId, setConflictId] = useState<string | null>(null);
  const [polygonIssue, setPolygonIssue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const current = selected && selected !== 'new' ? zones.find((z) => z.id === selected) : undefined;
  const name = (zone: DeliveryZone) => translate(zone.name, i18n.language) || '—';

  /** Выбрать зону (или новую) и начать правку с её полигоном; форма пересоздаётся по ключу. */
  const load = (next: Selection, polygon: GeoPoint[]) => {
    setSelected(next);
    setDraft(polygon);
    setVersion((v) => v + 1);
    setDirty(false);
    setConflictId(null);
    setPolygonIssue(null);
  };

  /** Несохранённые правки — с подтверждением. */
  const guard = (action: () => void) => {
    if (!dirty) return action();
    modal.confirm({ title: t('deliveryZones.unsaved'), okText: t('common.confirm'), cancelText: t('common.cancel'), onOk: action });
  };

  const selectZone = (id: string) => {
    if (id === selected) return;
    guard(() => {
      setDrawing(false);
      load(id, zones.find((z) => z.id === id)?.polygon ?? []);
    });
  };

  const startDrawing = () =>
    guard(() => {
      load('new', []);
      setDrawing(true);
    });

  const close = () =>
    guard(() => {
      setDrawing(false);
      load(null, []);
    });

  const save = async (values: ZoneFormValues) => {
    const issue = validateZoneForm(values, draft).polygon;
    if (issue) {
      setPolygonIssue(t(`deliveryZones.issues.${issue}`));
      return;
    }
    setSaving(true);
    try {
      const saved =
        selected === 'new' || !selected
          ? await zonesApi.create(formValuesToCreateInput(branchId, values, draft))
          : await zonesApi.update(selected, formValuesToZoneInput(values, draft));
      await queryClient.invalidateQueries({ queryKey: zonesKeys.branch(branchId) });
      void queryClient.invalidateQueries({ queryKey: ['phone-order', 'zones', branchId] });
      void message.success(t('deliveryZones.saved'));
      load(saved.id, saved.polygon);
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === 'delivery_zone.overlap') {
        const conflicting = apiError.details.conflictingZoneId;
        setConflictId(typeof conflicting === 'string' ? conflicting : '');
      } else {
        notifyError(apiError);
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!current) return;
    await zonesApi.remove(current.id);
    await queryClient.invalidateQueries({ queryKey: zonesKeys.branch(branchId) });
    void queryClient.invalidateQueries({ queryKey: ['phone-order', 'zones', branchId] });
    load(null, []);
  };

  const conflictZone = conflictId ? zones.find((z) => z.id === conflictId) : undefined;
  const alert =
    conflictId !== null
      ? { type: 'error' as const, message: conflictZone ? t('deliveryZones.overlap', { name: name(conflictZone) }) : t('deliveryZones.overlapUnknown') }
      : polygonIssue
        ? { type: 'warning' as const, message: polygonIssue }
        : null;
  const money = (value: DeliveryZone['deliveryFee']) => formatMoney(value, i18n.language);

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={15} xxl={16}>
        <Card size="small" styles={{ body: { padding: 8 } }}>
          <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 8, paddingInline: 4 }}>
            {drawing ? (
              <Button icon={<CloseOutlined />} onClick={() => setDrawing(false)}>
                {t('deliveryZones.cancelDraw')}
              </Button>
            ) : (
              <Button type="primary" icon={<PlusOutlined />} onClick={startDrawing}>
                {t('deliveryZones.draw')}
              </Button>
            )}
            <Typography.Text type="secondary" style={{ fontSize: 13, flex: '1 1 240px', textAlign: 'right' }}>
              {drawing ? t('deliveryZones.drawHint') : selected ? t('deliveryZones.editHint') : null}
            </Typography.Text>
          </Flex>
          {zonesQuery.error ? <ErrorAlert error={zonesQuery.error} onRetry={() => void zonesQuery.refetch()} /> : null}
          {zonesQuery.isLoading ? (
            <Spin style={{ display: 'block', margin: '120px auto' }} />
          ) : (
            <Suspense fallback={<Spin style={{ display: 'block', margin: '120px auto' }} />}>
              <ZonesMap
                zones={zones}
                branch={branch?.location ?? null}
                branchLabel={branchName(branchId)}
                selectedId={selected}
                draft={draft}
                resetKey={`${selected ?? 'none'}:${version}`}
                drawing={drawing}
                conflictId={conflictId || null}
                language={i18n.language}
                tooltips={{
                  firstVertex: t('deliveryZones.geoman.firstVertex'),
                  continueLine: t('deliveryZones.geoman.continueLine'),
                  finishPoly: t('deliveryZones.geoman.finishPoly'),
                }}
                height={screens.lg ? 620 : 380}
                onSelect={selectZone}
                onDraftChange={(polygon) => {
                  setDraft(polygon);
                  setDirty(true);
                  setConflictId(null);
                  setPolygonIssue(null);
                }}
                onDrawn={(polygon) => {
                  setDrawing(false);
                  setDraft(polygon);
                  setVersion((v) => v + 1);
                  setDirty(true);
                  setPolygonIssue(null);
                }}
              />
            </Suspense>
          )}
        </Card>
      </Col>

      <Col xs={24} lg={9} xxl={8}>
        {selected ? (
          <ZoneFormCard
            key={`${selected}:${current?.id ?? 'new'}`}
            zone={current}
            draft={draft}
            dirty={dirty}
            saving={saving}
            alert={alert}
            onDirty={() => setDirty(true)}
            onSave={(values) => void save(values)}
            onDelete={remove}
            onResetShape={() => current && load(current.id, current.polygon)}
            onClose={close}
          />
        ) : null}

        <Card title={t('deliveryZones.zones')} size="small">
          {zones.length === 0 && !zonesQuery.isLoading ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('deliveryZones.empty')} /> : null}
          <List<DeliveryZone>
            dataSource={zones}
            renderItem={(zone) => (
              <List.Item
                onClick={() => selectZone(zone.id)}
                style={{
                  cursor: 'pointer',
                  paddingInline: 8,
                  borderRadius: 8,
                  background: zone.id === conflictId ? '#fff1f0' : zone.id === selected ? '#eef5fc' : undefined,
                }}
                actions={[<Button key="edit" type="text" icon={<EditOutlined />} aria-label={t('common.edit')} />]}
              >
                <List.Item.Meta
                  avatar={
                    <Badge
                      color={zone.id === conflictId ? MAP_COLORS.zoneConflict : zone.isActive ? MAP_COLORS.zone : MAP_COLORS.zoneInactive}
                      style={{ marginTop: 6 }}
                    />
                  }
                  title={
                    <Space size={6} wrap>
                      {name(zone)}
                      {!zone.isActive ? <Tag>{t('deliveryZones.inactive')}</Tag> : null}
                    </Space>
                  }
                  description={
                    <>
                      {t('deliveryZones.summary', { fee: money(zone.deliveryFee), min: money(zone.minOrderAmount), eta: zone.etaMinutes })}
                      {zone.freeDeliveryFrom ? (
                        <div>
                          <Tag color="green" style={{ marginTop: 4 }}>
                            {t('deliveryZones.freeFrom', { amount: money(zone.freeDeliveryFrom) })}
                          </Tag>
                        </div>
                      ) : null}
                    </>
                  }
                />
              </List.Item>
            )}
          />
        </Card>
      </Col>
    </Row>
  );
}

/**
 * Зоны доставки филиала (delivery_zones.manage): карта OSM с маркером филиала, полигоны зон
 * (рисование и правка — leaflet-geoman), форма зоны сбоку. Пересечение зон одного филиала
 * отклоняет сервер — зона-конфликт подсвечивается на карте и в списке.
 */
export function DeliveryZonesPage() {
  const { t } = useTranslation();
  const { selectedBranchId, branchName } = useBranch();
  return (
    <>
      <PageHeader
        title={selectedBranchId ? `${t('nav.deliveryZones')} · ${branchName(selectedBranchId)}` : t('nav.deliveryZones')}
        subtitle={t('sections.deliveryZones')}
      />
      <BranchScope
        permission={Permission.DeliveryZonesManage}
        title={t('deliveryZones.selectBranch.title')}
        text={t('deliveryZones.selectBranch.text')}
        none={t('deliveryZones.selectBranch.none')}
      >
        {(branchId) => <ZonesEditor key={branchId} branchId={branchId} />}
      </BranchScope>
    </>
  );
}
