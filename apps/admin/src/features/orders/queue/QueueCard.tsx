import { CarOutlined, ClockCircleOutlined, EnvironmentOutlined, FieldTimeOutlined, MessageOutlined, UserOutlined } from '@ant-design/icons';
import { Button, Card, Flex, Space, Tag, Typography } from 'antd';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { formatMoney, translate } from '@aula/api-client';
import { useBranch } from '@/shared/branch/BranchProvider';
import { dayjs, DISPLAY_TIMEZONE, toDisplay } from '@/shared/lib/dates';
import { MoneyText } from '@/shared/ui/MoneyText';
import { OrderActionButtons } from '../common/OrderActionButtons';
import { ChannelTag, CourierStatusTag, OrderTypeTag, PaymentTag } from '../common/OrderTags';
import { queueCardActions } from '../order-actions';
import type { QueueOrder } from '../types';
import { elapsedParts } from './queue-utils';

const VISIBLE_ITEMS = 4;

export function formatElapsed(t: TFunction, fromIso: string, nowMs: number): string {
  const { days, hours, minutes } = elapsedParts(fromIso, nowMs);
  if (days > 0) return t('orders.elapsed.days', { d: days, h: hours });
  if (hours > 0) return t('orders.elapsed.hours', { h: hours, m: minutes });
  if (minutes === 0) return t('orders.elapsed.justNow');
  return t('orders.elapsed.minutes', { m: minutes });
}

/** Время для очереди: «19:30» сегодня или «26.09 19:30». */
export function formatQueueTime(iso: string): string {
  const local = toDisplay(iso);
  if (!local) return '—';
  return local.isSame(dayjs().tz(DISPLAY_TIMEZONE), 'day') ? local.format('HH:mm') : local.format('DD.MM HH:mm');
}

/**
 * Карточка заказа в очереди: номер, сколько прошло, тип, оплата, время «ко времени», опоздание,
 * гость, адрес, состав, итог, курьер службы доставки и крупные кнопки разрешённых сервером действий.
 */
export function QueueCard({
  order,
  now,
  highlighted,
  showBranch,
  onOpen,
  onReject,
  onCancel,
}: {
  order: QueueOrder;
  now: number;
  highlighted: boolean;
  showBranch: boolean;
  onOpen: () => void;
  onReject: () => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { branchName } = useBranch();
  const actions = queueCardActions(order);
  const items = order.items.slice(0, VISIBLE_ITEMS);
  const hidden = order.items.length - items.length;
  const classes = ['aula-queue-card', highlighted ? 'aula-queue-card--new' : '', order.isLate ? 'aula-queue-card--late' : ''].filter(Boolean).join(' ');

  return (
    <Card className={classes} size="small" onClick={onOpen} hoverable>
      <Flex justify="space-between" align="flex-start" gap={8}>
        <div style={{ minWidth: 0 }}>
          <Space size={6} wrap>
            <span className="aula-queue-number">{order.number}</span>
            {highlighted ? <Tag color="red">{t('orders.queue.newBadge')}</Tag> : null}
          </Space>
          {showBranch ? (
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              {branchName(order.branchId)}
            </Typography.Text>
          ) : null}
        </div>
        <span className="aula-queue-elapsed" title={t('orders.queue.placedAgo', { time: formatElapsed(t, order.placedAt, now) })}>
          <ClockCircleOutlined /> {formatElapsed(t, order.placedAt, now)}
        </span>
      </Flex>

      <Space size={[4, 4]} wrap style={{ marginTop: 6 }}>
        <OrderTypeTag type={order.type} />
        <PaymentTag method={order.paymentMethod} status={order.status} />
        <ChannelTag channel={order.channel} />
        {order.contactless ? <Tag color="purple">{t('orders.queue.contactless')}</Tag> : null}
        {order.courier ? <CourierStatusTag status={order.courier.status} /> : null}
      </Space>
      {order.courier && (order.courier.courierName || order.courier.trackingUrl) ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 13 }}>
          <CarOutlined /> {order.courier.courierName ?? t('orders.courier.title')}
          {order.courier.trackingUrl ? (
            <>
              {' · '}
              <a href={order.courier.trackingUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                {t('orders.courier.tracking')}
              </a>
            </>
          ) : null}
        </Typography.Text>
      ) : null}

      {order.scheduledFor ? (
        <Tag color="orange" icon={<FieldTimeOutlined />} style={{ marginTop: 6, fontSize: 14, paddingBlock: 2 }}>
          {t('orders.queue.scheduledFor', { time: formatQueueTime(order.scheduledFor) })}
        </Tag>
      ) : null}
      <div style={{ marginTop: 4 }}>
        {order.isLate ? (
          <Tag color="error" style={{ fontWeight: 600 }}>
            {t('orders.queue.late')}
          </Tag>
        ) : null}
        <Typography.Text type={order.isLate ? 'danger' : 'secondary'} style={{ fontSize: 13 }}>
          {t('orders.queue.promisedAt', { time: formatQueueTime(order.promisedAt) })}
        </Typography.Text>
      </div>

      <div style={{ marginTop: 6 }}>
        <Typography.Text>
          <UserOutlined /> {order.customer.name ?? '—'} ·{' '}
          <a href={`tel:${order.customer.phone}`} onClick={(e) => e.stopPropagation()}>
            {order.customer.phone}
          </a>
        </Typography.Text>
        {order.deliveryAddress ? (
          <Typography.Paragraph style={{ margin: '2px 0 0' }} ellipsis={{ rows: 2 }}>
            <EnvironmentOutlined /> {order.deliveryAddress}
          </Typography.Paragraph>
        ) : null}
      </div>

      <ul className="aula-queue-items">
        {items.map((item) => (
          <li key={item.id}>
            <Typography.Text strong>{item.quantity} ×</Typography.Text> {translate(item.name, i18n.language)}
            {item.modifiers.length > 0 ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {' '}
                ({item.modifiers.map((m) => translate(m.optionName, i18n.language)).join(', ')})
              </Typography.Text>
            ) : null}
          </li>
        ))}
        {hidden > 0 ? (
          <li>
            <Typography.Text type="secondary">{t('orders.queue.more', { count: hidden })}</Typography.Text>
          </li>
        ) : null}
      </ul>

      {order.comment ? (
        <Typography.Paragraph type="warning" style={{ margin: '6px 0 0' }} ellipsis={{ rows: 2 }}>
          <MessageOutlined /> {order.comment}
        </Typography.Paragraph>
      ) : null}

      <Flex justify="space-between" align="center" style={{ marginTop: 8 }}>
        <span>
          <MoneyText value={order.total} strong />
          {order.paymentMethod === 'on_receipt' && order.amountDue.amount !== order.total.amount ? (
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              {t('orders.queue.toCollect', { amount: formatMoney(order.amountDue, i18n.language) })}
            </Typography.Text>
          ) : null}
        </span>
        <Button type="link" size="small" onClick={onOpen} style={{ paddingInline: 0 }}>
          {t('orders.queue.details')}
        </Button>
      </Flex>

      {actions.length > 0 ? (
        <div style={{ marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
          <OrderActionButtons order={order} actions={actions} block onReject={onReject} onCancel={onCancel} />
        </div>
      ) : null}
    </Card>
  );
}
