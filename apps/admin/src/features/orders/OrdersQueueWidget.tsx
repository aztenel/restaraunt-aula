import { PhoneOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import { Badge, Button, Card, Flex, Space, Statistic, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Permission } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useCan } from '@/shared/auth/useCan';
import { useBranch } from '@/shared/branch/BranchProvider';
import { useAdminFeed } from '@/shared/feed/FeedProvider';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { ordersApi, ordersKeys } from './api';
import { countIn, QUEUE_COLUMNS, queueSummary } from './queue/queue-utils';

/**
 * Виджет стартовой страницы: сколько заказов в каждом статусе очереди выбранного филиала
 * (счётчики — из GET /admin/orders/queue; лента событий обновляет их сразу, опрос — страховка).
 */
export function OrdersQueueWidget() {
  const { t } = useTranslation();
  const { canSomewhere } = useCan();
  const { selectedBranchId } = useBranch();
  const { status } = useAdminFeed();
  const allowed = canSomewhere(Permission.OrdersView);
  const queue = useApiQuery(ordersKeys.queue(selectedBranchId), () => ordersApi.queue(selectedBranchId), {
    enabled: allowed,
    refetchInterval: status === 'open' ? 60_000 : 15_000,
  });
  if (!allowed) return null;
  const summary = queueSummary(queue.data);

  return (
    <Card
      style={{ marginTop: 16 }}
      title={
        <Space>
          <ShoppingCartOutlined />
          {t('orders.widget.title')}
          <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
            {t('orders.widget.active', { count: summary.active })}
          </Typography.Text>
        </Space>
      }
      extra={
        <Space wrap>
          {canSomewhere(Permission.OrdersManage) ? (
            <Link to="/orders/new">
              <Button icon={<PhoneOutlined />}>{t('orders.widget.newOrder')}</Button>
            </Link>
          ) : null}
          <Link to="/orders">
            <Button type="primary">{t('orders.widget.openQueue')}</Button>
          </Link>
        </Space>
      }
      loading={queue.isLoading}
    >
      {queue.error ? <ErrorAlert error={queue.error} onRetry={() => void queue.refetch()} /> : null}
      <Flex gap={12} wrap>
        {QUEUE_COLUMNS.map((column) => {
          const count = countIn(queue.data, column);
          return (
            <div key={column} style={{ flex: '1 1 140px' }}>
              <Link to="/orders">
                <Card size="small" hoverable style={column === 'paid' && count > 0 ? { borderColor: '#d4380d', background: '#fff4ef' } : undefined}>
                  <Statistic
                    title={
                      <Space size={6}>
                        {column === 'paid' ? <Badge status={count > 0 ? 'processing' : 'default'} /> : null}
                        {t(`orders.queue.columns.${column}`)}
                      </Space>
                    }
                    value={count}
                    valueStyle={column === 'paid' && count > 0 ? { color: '#d4380d', fontWeight: 700 } : undefined}
                  />
                </Card>
              </Link>
            </div>
          );
        })}
      </Flex>
      {summary.late > 0 || summary.awaitingPayment > 0 ? (
        <Flex gap={8} wrap style={{ marginTop: 12 }}>
          {summary.late > 0 ? <Tag color="error">{t('orders.widget.late', { count: summary.late })}</Tag> : null}
          {summary.awaitingPayment > 0 ? <Tag color="gold">{t('orders.widget.awaitingPayment', { count: summary.awaitingPayment })}</Tag> : null}
        </Flex>
      ) : null}
    </Card>
  );
}
