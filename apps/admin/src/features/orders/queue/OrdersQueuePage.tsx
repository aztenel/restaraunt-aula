import './queue.css';
import { ReloadOutlined, WifiOutlined } from '@ant-design/icons';
import { Alert, Badge, Button, Collapse, Empty, Flex, Space, Spin, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useApiQuery } from '@/shared/api/hooks';
import { useBranch } from '@/shared/branch/BranchProvider';
import { useAdminFeed } from '@/shared/feed/FeedProvider';
import { toDisplay } from '@/shared/lib/dates';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { ordersApi, ordersKeys } from '../api';
import type { CancelMode } from '../cancel-form';
import { CancelOrderDialog } from '../detail/CancelOrderDialog';
import { OrderDrawer } from '../detail/OrderDrawer';
import { useNow } from '../useOrderMutations';
import { QueueCard } from './QueueCard';
import { countIn, ordersIn, QUEUE_COLUMNS } from './queue-utils';
import { useNewOrderHighlights } from './useNewOrderHighlights';

/** Опрос очереди: 15 с без ленты событий (запасной канал), 60 с при живой ленте — страховка. */
const POLL_FALLBACK_MS = 15_000;
const POLL_WITH_FEED_MS = 60_000;

/**
 * Очередь оператора (главный экран смены): GET /admin/orders/queue для филиала из шапки,
 * колонки по статусам, кнопки — только разрешённые сервером переходы. Новые заказы приходят
 * лентой событий (звук + подсветка), без ленты — опросом раз в 15 секунд.
 */
export function OrdersQueuePage() {
  const { t } = useTranslation();
  const { selectedBranchId } = useBranch();
  const { status: feedStatus, items: feedItems, soundEnabled } = useAdminFeed();
  const feedOpen = feedStatus === 'open';
  const [params, setParams] = useSearchParams();
  const openOrderId = params.get('order');
  const [cancelTarget, setCancelTarget] = useState<{ id: string; mode: CancelMode } | null>(null);
  const now = useNow(30_000);

  const queue = useApiQuery(ordersKeys.queue(selectedBranchId), () => ordersApi.queue(selectedBranchId), {
    refetchInterval: feedOpen ? POLL_WITH_FEED_MS : POLL_FALLBACK_MS,
    refetchIntervalInBackground: true,
  });
  const { highlighted, acknowledge } = useNewOrderHighlights(queue.data, feedItems, { soundOnPoll: !feedOpen && soundEnabled });

  const openOrder = (id: string) => {
    acknowledge(id);
    const next = new URLSearchParams(params);
    next.set('order', id);
    setParams(next);
  };
  const closeOrder = () => {
    const next = new URLSearchParams(params);
    next.delete('order');
    setParams(next);
  };

  const awaiting = ordersIn(queue.data, 'awaiting_payment');
  const showBranch = selectedBranchId === null;

  const cardProps = (id: string) => ({
    now,
    highlighted: highlighted.has(id),
    showBranch,
    onOpen: () => openOrder(id),
    onReject: () => {
      acknowledge(id);
      setCancelTarget({ id, mode: 'reject' });
    },
    onCancel: () => {
      acknowledge(id);
      setCancelTarget({ id, mode: 'cancel' });
    },
  });

  return (
    <>
      <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 12 }}>
        <Space size={8} wrap>
          {feedOpen ? <WifiOutlined style={{ color: '#2f7d4f' }} /> : null}
          <Typography.Text type="secondary">
            {queue.data ? t('orders.queue.updatedAt', { time: toDisplay(queue.data.generatedAt)?.format('HH:mm:ss') ?? '—' }) : null}
          </Typography.Text>
        </Space>
        <Button icon={<ReloadOutlined />} loading={queue.isFetching} onClick={() => void queue.refetch()}>
          {t('common.refresh')}
        </Button>
      </Flex>

      {!feedOpen ? <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t('orders.queue.polling')} /> : null}
      {showBranch ? <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('orders.queue.branchHint')} /> : null}
      {queue.error ? <ErrorAlert error={queue.error} onRetry={() => void queue.refetch()} /> : null}

      {awaiting.length > 0 ? (
        <Collapse
          size="small"
          style={{ marginBottom: 12, background: '#fffcf7' }}
          items={[
            {
              key: 'awaiting',
              label: (
                <Space>
                  <Badge color="gold" />
                  {t('orders.queue.awaitingPayment', { count: countIn(queue.data, 'awaiting_payment') })}
                </Space>
              ),
              children: (
                <>
                  <Typography.Paragraph type="secondary">{t('orders.queue.awaitingPaymentHint')}</Typography.Paragraph>
                  <div className="aula-queue-board" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(272px, 1fr))' }}>
                    {awaiting.map((order) => (
                      <QueueCard key={order.id} order={order} {...cardProps(order.id)} />
                    ))}
                  </div>
                </>
              ),
            },
          ]}
        />
      ) : null}

      {queue.isLoading ? (
        <Spin style={{ display: 'block', margin: '48px auto' }} />
      ) : (
        <div className="aula-queue-board" role="list">
          {QUEUE_COLUMNS.map((status) => {
            const orders = ordersIn(queue.data, status);
            return (
              <section key={status} className={`aula-queue-column${status === 'paid' ? ' aula-queue-column--new' : ''}`} aria-label={t(`orders.queue.columns.${status}`)}>
                <div className="aula-queue-column-header">
                  <span>{t(`orders.queue.columns.${status}`)}</span>
                  <Badge count={countIn(queue.data, status)} showZero color={status === 'paid' ? '#d4380d' : '#8a5a36'} />
                </div>
                {orders.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('orders.queue.empty')} style={{ margin: '24px 0' }} />
                ) : (
                  orders.map((order) => <QueueCard key={order.id} order={order} {...cardProps(order.id)} />)
                )}
              </section>
            );
          })}
        </div>
      )}

      <OrderDrawer orderId={openOrderId} onClose={closeOrder} />
      <CancelOrderDialog orderId={cancelTarget?.id ?? null} preferred={cancelTarget?.mode} onClose={() => setCancelTarget(null)} />
    </>
  );
}
