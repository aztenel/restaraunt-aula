import { CarOutlined, PhoneOutlined, ShoppingOutlined } from '@ant-design/icons';
import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { tx } from '@/shared/i18n/tx';
import type { CheckoutPaymentMethod, CourierDispatchStatus, OrderChannel, OrderStatus, OrderType } from '../types';

/** Доставка / самовывоз. */
export function OrderTypeTag({ type, large }: { type: OrderType; large?: boolean }) {
  const { t } = useTranslation();
  return (
    <Tag
      icon={type === 'delivery' ? <CarOutlined /> : <ShoppingOutlined />}
      color={type === 'delivery' ? 'geekblue' : 'green'}
      style={{ marginInlineEnd: 0, ...(large ? { fontSize: 14, paddingBlock: 2 } : {}) }}
    >
      {t(`orders.type.${type}`)}
    </Tag>
  );
}

/** Заказ по телефону (канал admin); заказы с сайта не помечаются. */
export function ChannelTag({ channel }: { channel: OrderChannel }) {
  const { t } = useTranslation();
  if (channel !== 'admin') return null;
  return (
    <Tag icon={<PhoneOutlined />} style={{ marginInlineEnd: 0 }}>
      {t('orders.channel.admin')}
    </Tag>
  );
}

/**
 * Способ и состояние оплаты: онлайн до оплаты — «ждёт оплату», после — «оплачен онлайн»;
 * при получении — деньги собирает курьер/касса.
 */
export function PaymentTag({ method, status }: { method: CheckoutPaymentMethod; status: OrderStatus }) {
  const { t } = useTranslation();
  if (method === 'on_receipt') {
    return (
      <Tag color="orange" style={{ marginInlineEnd: 0 }}>
        {t('orders.payment.payOnReceipt')}
      </Tag>
    );
  }
  const awaiting = status === 'awaiting_payment' || status === 'draft';
  return (
    <Tag color={awaiting ? 'gold' : 'success'} style={{ marginInlineEnd: 0 }}>
      {awaiting ? t('orders.payment.awaitingOnline') : t('orders.payment.paidOnline')}
    </Tag>
  );
}

const COURIER_COLORS: Record<CourierDispatchStatus, string> = {
  requested: 'default',
  estimating: 'default',
  awaiting_confirmation: 'gold',
  searching: 'processing',
  courier_assigned: 'blue',
  picked_up: 'geekblue',
  delivered: 'success',
  cancelled: 'default',
  failed: 'error',
};

export function CourierStatusTag({ status }: { status: CourierDispatchStatus }) {
  const { t } = useTranslation();
  return (
    <Tag color={COURIER_COLORS[status] ?? 'default'} style={{ marginInlineEnd: 0 }}>
      {tx(t, `orders.courier.statuses.${status}`, status)}
    </Tag>
  );
}

/** Заявка службы доставки завершена (можно вызвать курьера снова) — иначе её можно отменить. */
export function isFinishedDispatch(status: CourierDispatchStatus): boolean {
  return status === 'delivered' || status === 'cancelled' || status === 'failed';
}
