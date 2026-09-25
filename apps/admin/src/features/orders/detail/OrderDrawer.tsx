import { ExpandOutlined } from '@ant-design/icons';
import { Button, Drawer, Grid, Spin, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useApiQuery } from '@/shared/api/hooks';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { ordersApi, ordersKeys } from '../api';
import { OrderDetailsView } from './OrderDetailsView';

/** Карточка заказа поверх очереди/списка (?order=<id> в адресе — ссылку можно передать коллеге). */
export function OrderDrawer({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const screens = Grid.useBreakpoint();
  const navigate = useNavigate();
  const detail = useApiQuery(ordersKeys.detail(orderId ?? ''), () => ordersApi.get(orderId ?? ''), { enabled: orderId !== null });
  const order = orderId ? detail.data : undefined;

  return (
    <Drawer
      open={orderId !== null}
      onClose={onClose}
      width={screens.xl ? 1040 : screens.md ? '90%' : '100%'}
      title={order ? t('orders.detail.title', { number: order.number }) : ' '}
      extra={
        order ? (
          <Tooltip title={t('orders.detail.openFull')}>
            <Button icon={<ExpandOutlined />} aria-label={t('orders.detail.openFull')} onClick={() => navigate(`/orders/${order.id}`)} />
          </Tooltip>
        ) : null
      }
      destroyOnHidden
    >
      {detail.isLoading ? <Spin style={{ display: 'block', margin: '48px auto' }} /> : null}
      {detail.error ? <ErrorAlert error={detail.error} onRetry={() => void detail.refetch()} /> : null}
      {order ? <OrderDetailsView order={order} /> : null}
    </Drawer>
  );
}
