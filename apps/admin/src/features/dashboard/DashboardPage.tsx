import { Alert, Badge, Card, Col, Empty, List, Row, Space, Statistic, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Permission } from '@aula/api-client';
import { useAuth } from '@/shared/auth/AuthProvider';
import { useCan } from '@/shared/auth/useCan';
import { useBranch } from '@/shared/branch/BranchProvider';
import { STREAM_PATHS, useAdminFeed } from '@/shared/feed/FeedProvider';
import { FEED_STREAMS, type FeedStream } from '@/shared/feed/types';
import { formatDateTime } from '@/shared/lib/dates';
import { PageHeader } from '@/shared/ui/PageHeader';
import { OrdersQueueWidget } from '@/features/orders/OrdersQueueWidget';

const STREAM_PERMISSIONS: Record<FeedStream, Permission[]> = {
  orders: [Permission.OrdersView],
  reservations: [Permission.ReservationsView],
  banquets: [Permission.BanquetsView],
  system: [Permission.SystemJobs, Permission.IntegrationsManage],
};

const STREAM_COLORS: Record<FeedStream, string> = {
  orders: 'gold',
  reservations: 'blue',
  banquets: 'purple',
  system: 'default',
};

/*
 * «Очереди» — стартовый экран смены: новые заказы, брони и банкетные заявки в реальном времени.
 * TODO(ordering/reservation/banquet): виджеты очередей со счётчиками и списками из API модулей:
 *   GET /api/v1/admin/orders?branchId=&status=paid,accepted,cooking,ready&perPage=20
 *   GET /api/v1/admin/reservations?branchId=&status=pending,awaiting_deposit&date=today
 *   GET /api/v1/admin/banquets?status=new,in_progress&sla=breached
 *   Ключи запросов начинать с ['orders'] / ['reservations'] / ['banquets'] — их обновляет лента событий.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const { selectedBranchId, branchName } = useBranch();
  const { canAny } = useCan();
  const { status, items, unread } = useAdminFeed();
  const streams = FEED_STREAMS.filter((stream) => canAny(STREAM_PERMISSIONS[stream]));
  const visibleItems = items.filter((item) => streams.includes(item.stream));

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle', {
          name: me?.name ?? '',
          branch: selectedBranchId ? branchName(selectedBranchId) : t('layout.allBranches'),
        })}
      />
      {status === 'unavailable' ? <Alert type="info" showIcon message={t('dashboard.feedUnavailable')} style={{ marginBottom: 16 }} /> : null}
      {status === 'reconnecting' ? <Alert type="warning" showIcon message={t('layout.feed.reconnecting')} style={{ marginBottom: 16 }} /> : null}
      <Row gutter={[16, 16]}>
        {streams.map((stream) => (
          <Col key={stream} xs={24} sm={12} xl={6}>
            <Card>
              <Statistic
                title={
                  <Space>
                    <Badge status={unread[stream] > 0 ? 'processing' : 'default'} />
                    {t(`feed.streams.${stream}`)}
                  </Space>
                }
                value={unread[stream]}
                suffix={<Typography.Text type="secondary">{t('dashboard.new')}</Typography.Text>}
              />
              <Link to={STREAM_PATHS[stream]}>{t('dashboard.open')}</Link>
            </Card>
          </Col>
        ))}
      </Row>
      <OrdersQueueWidget />
      <Card title={t('dashboard.recent')} style={{ marginTop: 16 }}>
        {visibleItems.length === 0 ? (
          <Empty description={t('feed.empty')} />
        ) : (
          <List
            dataSource={visibleItems}
            renderItem={(item) => (
              <List.Item
                extra={<Typography.Text type="secondary">{formatDateTime(item.occurredAt ?? item.receivedAt)}</Typography.Text>}
              >
                <Space wrap>
                  <Tag color={STREAM_COLORS[item.stream]}>{t(`feed.streams.${item.stream}`)}</Tag>
                  {item.kind === 'created' ? <Tag color="red">{t('feed.kinds.created')}</Tag> : null}
                  <Link to={STREAM_PATHS[item.stream]}>{item.title}</Link>
                  {item.branchId && !selectedBranchId ? <Typography.Text type="secondary">{branchName(item.branchId)}</Typography.Text> : null}
                </Space>
              </List.Item>
            )}
          />
        )}
      </Card>
    </>
  );
}
