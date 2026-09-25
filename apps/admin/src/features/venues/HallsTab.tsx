/**
 * Залы и места филиала: список залов, план выбранного зала (редактор расстановки) и таблица мест.
 * Изменять — venues.manage в филиале; просмотр — тем, у кого есть раздел.
 */
import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Empty, List, Modal, Row, Space, Table, Tabs, Tag, Typography, type TableColumnsType } from 'antd';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { formatMoney, Permission, translate } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useCan } from '@/shared/auth/useCan';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageLoader } from '@/shared/ui/PageLoader';
import { SingleBranchGate } from '../reservations/SingleBranchGate';
import { venueConfigApi, venueKeys } from './api';
import { HallDrawer } from './HallDrawer';
import { PlanEditor } from './PlanEditor';
import type { Hall, Venue } from './types';
import { VenueDrawer } from './VenueDrawer';

export function HallsTab() {
  const { t } = useTranslation();
  return (
    <SingleBranchGate
      permissions={[Permission.VenuesManage]}
      title={t('venues.branchRequired.title')}
      text={t('venues.branchRequired.text')}
      none={t('venues.branchRequired.none')}
    >
      {(branchId) => <HallsWorkspace key={branchId} branchId={branchId} />}
    </SingleBranchGate>
  );
}

type HallEditing = { hall: Hall | null } | null;
type VenueEditing = { venue: Venue | null } | null;

function HallsWorkspace({ branchId }: { branchId: string }) {
  const { t, i18n } = useTranslation();
  const { can } = useCan();
  const canEdit = can(Permission.VenuesManage, branchId);
  const [params, setParams] = useSearchParams();
  const halls = useApiQuery(venueKeys.halls(branchId), () => venueConfigApi.halls(branchId));
  const venues = useApiQuery(venueKeys.venues(branchId), () => venueConfigApi.venues(branchId));
  const types = useApiQuery(venueKeys.types, venueConfigApi.types);
  const [hallEditing, setHallEditing] = useState<HallEditing>(null);
  const [venueEditing, setVenueEditing] = useState<VenueEditing>(null);
  const [planDirty, setPlanDirty] = useState(false);
  const [innerTab, setInnerTab] = useState<'plan' | 'venues'>('plan');

  const sortedHalls = [...(halls.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const hallId = params.get('hall');
  const hall = sortedHalls.find((h) => h.id === hallId) ?? sortedHalls[0] ?? null;
  const hallVenues = (venues.data ?? []).filter((v) => v.hallId === hall?.id).sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));

  const selectHall = (id: string) => {
    const apply = () =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('hall', id);
          return next;
        },
        { replace: true },
      );
    if (!planDirty || id === hall?.id) return apply();
    Modal.confirm({
      title: t('venues.plan.leaveTitle'),
      content: t('venues.plan.leaveText'),
      okText: t('venues.plan.leaveOk'),
      cancelText: t('common.cancel'),
      onOk: () => {
        setPlanDirty(false);
        apply();
      },
    });
  };

  const onDirtyChange = useCallback((dirty: boolean) => setPlanDirty(dirty), []);

  const venueColumns: TableColumnsType<Venue> = [
    {
      title: t('venues.fields.code'),
      dataIndex: 'code',
      render: (code: string, venue) => <Typography.Link onClick={() => setVenueEditing({ venue })}>{code}</Typography.Link>,
    },
    { title: t('venues.fields.name'), key: 'name', render: (_, venue) => translate(venue.name, i18n.language) },
    { title: t('venues.fields.type'), key: 'type', render: (_, venue) => translate(venue.typeName, i18n.language) || venue.typeCode },
    {
      title: t('venues.fields.capacity'),
      key: 'capacity',
      render: (_, venue) => t('reservations.capacityRange', { min: venue.capacityMin, max: venue.capacityMax }),
    },
    {
      title: t('venues.fields.deposit'),
      key: 'deposit',
      render: (_, venue) => (venue.deposit ? formatMoney(venue.deposit, i18n.language) : '—'),
    },
    {
      title: t('venues.fields.rules'),
      key: 'rules',
      render: (_, venue) => (
        <Space size={4} wrap>
          <Tag>{t('reservations.minutes', { count: venue.rules.durationMinutes })}</Tag>
          {venue.rules.requiresManualConfirmation ? <Tag color="gold">{t('venues.rules.requiresManualConfirmation')}</Tag> : null}
          {!venue.rules.bookableOnline ? <Tag>{t('reservations.phoneOnly')}</Tag> : null}
          {Object.values(venue.ruleOverrides).some((v) => v !== null && v !== undefined) ? <Tag color="blue">{t('venues.rules.custom')}</Tag> : null}
        </Space>
      ),
    },
    {
      title: t('venues.fields.status'),
      key: 'status',
      render: (_, venue) =>
        venue.isBookable ? <Tag color="success">{t('common.active')}</Tag> : <Tag>{venue.isActive ? t('reservations.inactive') : t('common.inactive')}</Tag>,
    },
  ];

  if (halls.error) return <ErrorAlert error={halls.error} onRetry={() => void halls.refetch()} />;
  if (!halls.data) return <PageLoader />;

  return (
    <>
      {!canEdit ? <Alert type="info" showIcon message={t('venues.readOnly')} style={{ marginBottom: 12 }} /> : null}
      {venues.error ? <ErrorAlert error={venues.error} onRetry={() => void venues.refetch()} /> : null}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={6}>
          <Card
            size="small"
            title={t('venues.halls.title')}
            extra={
              canEdit ? (
                <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setHallEditing({ hall: null })}>
                  {t('venues.halls.create')}
                </Button>
              ) : null
            }
          >
            {sortedHalls.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('venues.halls.empty')} />
            ) : (
              <List
                size="small"
                dataSource={sortedHalls}
                renderItem={(item) => {
                  const count = (venues.data ?? []).filter((v) => v.hallId === item.id).length;
                  return (
                    <List.Item
                      onClick={() => selectHall(item.id)}
                      style={{ cursor: 'pointer', background: item.id === hall?.id ? '#fbf3ea' : undefined, paddingInline: 8, borderRadius: 6 }}
                    >
                      <Space direction="vertical" size={0}>
                        <Typography.Text strong>{translate(item.name, i18n.language) || item.code}</Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {item.code} · {t('venues.fields.venues')}: {count} · {item.planWidth}×{item.planHeight}
                        </Typography.Text>
                        {!item.isActive ? <Tag>{t('common.inactive')}</Tag> : null}
                      </Space>
                    </List.Item>
                  );
                }}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={18}>
          {hall ? (
            <Card
              size="small"
              title={
                <Space wrap>
                  {translate(hall.name, i18n.language) || hall.code}
                  {!hall.isActive ? <Tag>{t('common.inactive')}</Tag> : null}
                </Space>
              }
              extra={
                <Space wrap>
                  <Button size="small" icon={<EditOutlined />} onClick={() => setHallEditing({ hall })}>
                    {t('venues.halls.editTitle')}
                  </Button>
                  {canEdit ? (
                    <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setVenueEditing({ venue: null })} disabled={!types.data?.length}>
                      {t('venues.venues.create')}
                    </Button>
                  ) : null}
                </Space>
              }
            >
              <Tabs
                activeKey={innerTab}
                onChange={(key) => setInnerTab(key as 'plan' | 'venues')}
                items={[
                  {
                    key: 'plan',
                    label: t('venues.halls.plan'),
                    children: (
                      <PlanEditor
                        key={hall.id}
                        hall={hall}
                        venues={hallVenues}
                        canEdit={canEdit}
                        onEditVenue={(venue) => setVenueEditing({ venue })}
                        onDirtyChange={onDirtyChange}
                      />
                    ),
                  },
                  {
                    key: 'venues',
                    label: `${t('venues.halls.venuesTab')} (${hallVenues.length})`,
                    children: (
                      <Table<Venue>
                        rowKey="id"
                        size="small"
                        dataSource={hallVenues}
                        columns={venueColumns}
                        pagination={false}
                        loading={venues.isLoading}
                        scroll={{ x: 'max-content' }}
                        locale={{ emptyText: t('venues.venues.empty') }}
                      />
                    ),
                  },
                ]}
              />
            </Card>
          ) : (
            <Card>
              <Empty description={sortedHalls.length === 0 ? t('venues.halls.empty') : t('venues.halls.select')} />
            </Card>
          )}
        </Col>
      </Row>
      <HallDrawer
        open={hallEditing !== null}
        branchId={branchId}
        hall={hallEditing?.hall ?? null}
        canEdit={canEdit}
        onClose={() => setHallEditing(null)}
        onSaved={(saved) => {
          setHallEditing({ hall: saved });
          selectHall(saved.id);
        }}
        onDeleted={() => setHallEditing(null)}
      />
      {hall ? (
        <VenueDrawer
          open={venueEditing !== null}
          branchId={branchId}
          venue={venueEditing?.venue ?? null}
          hallId={hall.id}
          halls={sortedHalls}
          types={types.data ?? []}
          siblings={hallVenues}
          canEdit={canEdit}
          onClose={() => setVenueEditing(null)}
          onSaved={(saved) => setVenueEditing({ venue: saved })}
        />
      ) : null}
    </>
  );
}
