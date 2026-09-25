import { AuditOutlined, CopyOutlined, ExportOutlined, LinkOutlined, RollbackOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Flex,
  Popconfirm,
  Row,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { formatMoney, Permission, translate, type AuditRecord, type Money } from '@aula/api-client';
import { systemApi } from '@/shared/api/endpoints';
import { useApiQuery } from '@/shared/api/hooks';
import { useCan } from '@/shared/auth/useCan';
import { useBranch } from '@/shared/branch/BranchProvider';
import { tx } from '@/shared/i18n/tx';
import { formatDateTime, formatDateTimeSeconds } from '@/shared/lib/dates';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MoneyText } from '@/shared/ui/MoneyText';
import { StatusTag } from '@/shared/ui/StatusTag';
import { OrderActionButtons } from '../common/OrderActionButtons';
import { ChannelTag, CourierStatusTag, OrderTypeTag, PaymentTag } from '../common/OrderTags';
import { detailActions } from '../order-actions';
import type { AdminOrderDetails, AdminOrderItem, AdminOrderPayment, AdminOrderRefund } from '../types';
import { useCourierAction } from '../useOrderMutations';
import { CancelOrderDialog } from './CancelOrderDialog';
import { RefundDialog } from './RefundDialog';

const PointMap = lazy(() => import('./PointMap'));

function TotalRow({ label, value, strong, negative }: { label: ReactNode; value: Money; strong?: boolean; negative?: boolean }) {
  return (
    <Flex justify="space-between" gap={16} style={{ padding: '2px 0' }}>
      <Typography.Text strong={strong}>{label}</Typography.Text>
      <span>
        {negative ? '−' : null}
        <MoneyText value={value} strong={strong} />
      </span>
    </Flex>
  );
}

function ItemsTable({ items }: { items: AdminOrderItem[] }) {
  const { t, i18n } = useTranslation();
  return (
    <Table<AdminOrderItem>
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={items}
      locale={{ emptyText: t('orders.detail.noItems') }}
      scroll={{ x: 'max-content' }}
      columns={[
        {
          title: t('orders.detail.dish'),
          key: 'name',
          render: (_, item) => (
            <div style={{ minWidth: 180 }}>
              <Typography.Text strong>{translate(item.name, i18n.language)}</Typography.Text>
              {item.basePrice.amount !== item.unitPrice.amount ? (
                <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                  {t('orders.detail.basePrice', { price: formatMoney(item.basePrice, i18n.language) })}
                </Typography.Text>
              ) : null}
              {item.modifiers.length > 0 ? (
                <div>
                  {item.modifiers.map((m) => (
                    <Typography.Text key={`${m.groupId}:${m.optionId}`} type="secondary" style={{ display: 'block', fontSize: 13 }}>
                      {translate(m.groupName, i18n.language)}: {translate(m.optionName, i18n.language)}
                      {m.price.amount > 0 ? (
                        <>
                          {' '}
                          (+<MoneyText value={m.price} type="secondary" />)
                        </>
                      ) : null}
                    </Typography.Text>
                  ))}
                </div>
              ) : null}
            </div>
          ),
        },
        { title: t('orders.detail.quantity'), dataIndex: 'quantity', align: 'center', width: 70 },
        { title: t('orders.detail.unitPrice'), key: 'unit', align: 'right', render: (_, item) => <MoneyText value={item.unitPrice} /> },
        { title: t('orders.detail.lineTotal'), key: 'total', align: 'right', render: (_, item) => <MoneyText value={item.lineTotal} strong /> },
      ]}
    />
  );
}

function Totals({ order }: { order: AdminOrderDetails }) {
  const { t } = useTranslation();
  return (
    <div style={{ maxWidth: 360, marginInlineStart: 'auto', marginTop: 12 }}>
      <TotalRow label={t('orders.detail.subtotal')} value={order.subtotal} />
      {order.discount.amount > 0 ? (
        <TotalRow
          label={order.promoCode ? `${t('orders.detail.discount')} · ${t('orders.detail.promo', { code: order.promoCode })}` : t('orders.detail.discount')}
          value={order.discount}
          negative
        />
      ) : null}
      {order.type === 'delivery' ? <TotalRow label={t('orders.detail.deliveryFee')} value={order.deliveryFee} /> : null}
      <TotalRow label={t('orders.detail.total')} value={order.total} strong />
      {order.certificateAmount.amount > 0 ? (
        <TotalRow label={t('orders.detail.certificate', { code: order.certificateMaskedCode ?? '' })} value={order.certificateAmount} negative />
      ) : null}
      {order.certificateAmount.amount > 0 ? <TotalRow label={t('orders.detail.amountDue')} value={order.amountDue} strong /> : null}
    </div>
  );
}

function CourierCard({ order }: { order: AdminOrderDetails }) {
  const { t } = useTranslation();
  const courier = useCourierAction();
  const dispatch = order.courierDispatch;
  if (!dispatch && !order.canRetryCourier) return null;
  return (
    <Card size="small" title={t('orders.courier.title')} style={{ marginTop: 16 }}>
      {dispatch ? (
      <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label={t('orders.courier.provider')}>{dispatch.provider}</Descriptions.Item>
        <Descriptions.Item label={t('orders.courier.status')}>
          <Space size={4} wrap>
            <CourierStatusTag status={dispatch.status} />
            {dispatch.providerStatus ? <Typography.Text type="secondary">{dispatch.providerStatus}</Typography.Text> : null}
          </Space>
        </Descriptions.Item>
        {dispatch.courierName || dispatch.courierPhone ? (
          <Descriptions.Item label={t('orders.courier.courier')}>
            {[dispatch.courierName, dispatch.courierPhone].filter(Boolean).join(' · ')}
          </Descriptions.Item>
        ) : null}
        {dispatch.price ? (
          <Descriptions.Item label={t('orders.courier.price')}>
            <MoneyText value={dispatch.price} />
          </Descriptions.Item>
        ) : null}
        {dispatch.trackingUrl ? (
          <Descriptions.Item label={t('orders.courier.tracking')}>
            <a href={dispatch.trackingUrl} target="_blank" rel="noreferrer">
              <LinkOutlined /> {t('orders.courier.tracking')}
            </a>
          </Descriptions.Item>
        ) : null}
        <Descriptions.Item label={t('orders.courier.attempts', { count: dispatch.attempts })}>{formatDateTime(dispatch.requestedAt)}</Descriptions.Item>
      </Descriptions>
      ) : null}
      {dispatch?.lastError ? (
        <Alert type="error" showIcon style={{ marginTop: 8 }} message={t('orders.courier.lastError')} description={dispatch.lastError} />
      ) : null}
      {order.canRetryCourier || order.canCancelCourier ? (
        <Flex gap={8} style={{ marginTop: 12 }} wrap>
          {order.canRetryCourier ? (
            <Popconfirm title={t('orders.courier.retryConfirm')} onConfirm={() => courier.mutateAsync({ id: order.id, action: 'retry' })}>
              <Button loading={courier.isPending}>{dispatch ? t('orders.courier.retry') : t('orders.courier.request')}</Button>
            </Popconfirm>
          ) : null}
          {order.canCancelCourier ? (
            <Popconfirm title={t('orders.courier.cancelConfirm')} onConfirm={() => courier.mutateAsync({ id: order.id, action: 'cancel' })}>
              <Button danger loading={courier.isPending}>
                {t('orders.courier.cancel')}
              </Button>
            </Popconfirm>
          ) : null}
        </Flex>
      ) : null}
    </Card>
  );
}

function InfoTab({ order }: { order: AdminOrderDetails }) {
  const { t, i18n } = useTranslation();
  const { branchName, getBranch } = useBranch();
  const delivery = order.delivery;
  const branch = getBranch(order.branchId);
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={14}>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          {t('orders.detail.items')}
        </Typography.Title>
        <ItemsTable items={order.items} />
        <Totals order={order} />
        {order.comment ? (
          <Alert type="warning" style={{ marginTop: 16 }} message={t('orders.detail.comment')} description={order.comment} showIcon />
        ) : null}
        {order.cancellation ? (
          <Alert
            type="error"
            style={{ marginTop: 16 }}
            showIcon
            message={`${t('orders.detail.cancellation')}: ${tx(t, `orders.reasons.${order.cancellation.reasonCode}`, order.cancellation.reasonCode)}`}
            description={order.cancellation.reason ?? undefined}
          />
        ) : null}
      </Col>
      <Col xs={24} xl={10}>
        <Descriptions size="small" column={1} bordered title={t('orders.detail.customer')}>
          <Descriptions.Item label={t('orders.detail.name')}>{order.customer.name ?? '—'}</Descriptions.Item>
          <Descriptions.Item label={t('orders.detail.phone')}>
            <a href={`tel:${order.customer.phone}`}>{order.customer.phone}</a>
          </Descriptions.Item>
          {order.customer.email ? <Descriptions.Item label={t('orders.detail.email')}>{order.customer.email}</Descriptions.Item> : null}
          <Descriptions.Item label={t('orders.detail.branch')}>{branchName(order.branchId)}</Descriptions.Item>
          <Descriptions.Item label={t('orders.detail.channel')}>
            {t(`orders.channel.${order.channel}`)}
            {order.createdByName ? (
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                {t('orders.detail.createdBy', { name: order.createdByName })}
              </Typography.Text>
            ) : null}
          </Descriptions.Item>
          <Descriptions.Item label={t('orders.detail.placedAt')}>{formatDateTime(order.placedAt)}</Descriptions.Item>
          <Descriptions.Item label={t('orders.detail.scheduledFor')}>
            {order.scheduledFor ? <Tag color="orange">{formatDateTime(order.scheduledFor)}</Tag> : t('orders.detail.asap')}
          </Descriptions.Item>
          <Descriptions.Item label={t('orders.detail.promisedAt')}>
            {formatDateTime(order.promisedAt)}
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              {t('orders.detail.eta', { minutes: order.etaMinutes })}
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label={t('orders.detail.trackingUrl')}>
            <Typography.Link href={order.trackingUrl} target="_blank" copyable={{ text: order.trackingUrl, icon: <CopyOutlined /> }}>
              <ExportOutlined />
            </Typography.Link>
          </Descriptions.Item>
        </Descriptions>
        {delivery ? (
          <>
            <Descriptions size="small" column={1} bordered title={t('orders.detail.delivery')} style={{ marginTop: 16 }}>
              <Descriptions.Item label={t('orders.detail.address')}>
                <Typography.Text strong>{delivery.addressText}</Typography.Text>
                {[
                  delivery.apartment && `${t('orders.detail.apartment')} ${delivery.apartment}`,
                  delivery.entrance && `${t('orders.detail.entrance')} ${delivery.entrance}`,
                  delivery.floor && `${t('orders.detail.floor')} ${delivery.floor}`,
                  delivery.intercom && `${t('orders.detail.intercom')} ${delivery.intercom}`,
                ]
                  .filter(Boolean)
                  .map((line) => (
                    <div key={String(line)}>{line}</div>
                  ))}
              </Descriptions.Item>
              {delivery.courierComment ? <Descriptions.Item label={t('orders.detail.courierComment')}>{delivery.courierComment}</Descriptions.Item> : null}
              <Descriptions.Item label={t('orders.detail.zone')}>{delivery.zoneName ? translate(delivery.zoneName, i18n.language) : '—'}</Descriptions.Item>
              {delivery.contactless ? (
                <Descriptions.Item label={t('orders.detail.contactless')}>
                  <Tag color="purple">{t('orders.queue.contactless')}</Tag>
                </Descriptions.Item>
              ) : null}
            </Descriptions>
            <div style={{ marginTop: 12 }} role="region" aria-label={t('orders.detail.map')}>
              <Suspense fallback={<Spin />}>
                <PointMap point={delivery.point} branch={branch?.location} pointLabel={delivery.addressText} branchLabel={branchName(order.branchId)} />
              </Suspense>
            </div>
          </>
        ) : null}
        {order.type === 'delivery' ? <CourierCard order={order} /> : null}
      </Col>
    </Row>
  );
}

function PaymentsTab({ order, onRefund }: { order: AdminOrderDetails; onRefund: () => void }) {
  const { t, i18n } = useTranslation();
  return (
    <>
      <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 8 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {t('orders.detail.payments.title')}
        </Typography.Title>
        <Space wrap>
          <Typography.Text strong>{t('orders.detail.refundable', { amount: formatMoney(order.refundable, i18n.language) })}</Typography.Text>
          {order.canRefund ? (
            <Button icon={<RollbackOutlined />} onClick={onRefund}>
              {t('orders.actions.refund')}
            </Button>
          ) : null}
        </Space>
      </Flex>
      <Table<AdminOrderPayment>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={order.payments}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('orders.detail.payments.empty') }}
        columns={[
          {
            title: t('orders.detail.payments.method'),
            key: 'method',
            render: (_, p) => (
              <div>
                {tx(t, `orders.paymentMethods.${p.method}`, p.method)}
                <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                  {p.provider}
                  {p.attempt ? ` · ${t('orders.detail.payments.attempt', { n: p.attempt })}` : ''}
                </Typography.Text>
              </div>
            ),
          },
          { title: t('orders.detail.payments.status'), key: 'status', render: (_, p) => <StatusTag domain="payment" status={p.status} /> },
          { title: t('orders.detail.payments.amount'), key: 'amount', align: 'right', render: (_, p) => <MoneyText value={p.amount} strong /> },
          {
            title: t('orders.detail.payments.refunded'),
            key: 'refunded',
            align: 'right',
            render: (_, p) => (p.refundedAmount.amount > 0 ? <MoneyText value={p.refundedAmount} type="danger" /> : '—'),
          },
          { title: t('orders.detail.payments.paidAt'), key: 'paidAt', render: (_, p) => formatDateTime(p.paidAt) },
          {
            title: t('orders.detail.payments.link'),
            key: 'link',
            render: (_, p) =>
              p.paymentUrl ? (
                <Typography.Link href={p.paymentUrl} target="_blank" copyable={{ text: p.paymentUrl }}>
                  <LinkOutlined />
                </Typography.Link>
              ) : (
                '—'
              ),
          },
        ]}
      />
      <Typography.Title level={5} style={{ marginTop: 24 }}>
        {t('orders.detail.refunds.title')}
      </Typography.Title>
      <Table<AdminOrderRefund>
        size="small"
        rowKey="refundId"
        pagination={false}
        dataSource={order.refunds}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('orders.detail.refunds.empty') }}
        columns={[
          { title: t('orders.detail.refunds.createdAt'), key: 'createdAt', render: (_, r) => formatDateTime(r.createdAt) },
          { title: t('orders.detail.refunds.kind'), key: 'kind', render: (_, r) => tx(t, `orders.refundKinds.${r.kind}`, r.kind) },
          {
            title: t('orders.detail.refunds.status'),
            key: 'status',
            render: (_, r) => (
              <Tag color={r.status === 'succeeded' ? 'success' : r.status === 'failed' ? 'error' : 'gold'}>
                {tx(t, `orders.refundStatuses.${r.status}`, r.status)}
              </Tag>
            ),
          },
          { title: t('orders.detail.refunds.amount'), key: 'amount', align: 'right', render: (_, r) => <MoneyText value={r.amount} strong /> },
          { title: t('orders.detail.refunds.reason'), dataIndex: 'reason' },
        ]}
      />
    </>
  );
}

function HistoryTab({ order }: { order: AdminOrderDetails }) {
  const { t } = useTranslation();
  if (order.history.length === 0) return <Empty description={t('orders.detail.history.empty')} />;
  return (
    <Timeline
      style={{ marginTop: 8 }}
      items={order.history.map((h) => ({
        key: `${h.at}:${h.to}`,
        color: h.to === 'cancelled' ? 'red' : h.to === 'completed' ? 'green' : 'blue',
        children: (
          <div>
            <Space wrap size={6}>
              <StatusTag domain="order" status={h.to} />
              <Typography.Text type="secondary">{formatDateTimeSeconds(h.at)}</Typography.Text>
            </Space>
            <div>
              <Typography.Text>
                {h.actorKind === 'staff' ? h.actorName : h.actorKind === 'guest' ? t('orders.detail.history.guest') : t('orders.detail.history.system')}
              </Typography.Text>
            </div>
            {h.reasonCode ? (
              <Typography.Text type="secondary">
                {tx(t, `orders.reasons.${h.reasonCode}`, h.reasonCode)}
                {h.reason ? `: ${h.reason}` : ''}
              </Typography.Text>
            ) : null}
          </div>
        ),
      }))}
    />
  );
}

function AuditTab({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const { canSomewhere } = useCan();
  const allowed = canSomewhere(Permission.AuditView);
  const params = { entityType: 'order', entityId: orderId, perPage: 50 };
  const log = useApiQuery(['system', 'audit-log', params], () => systemApi.auditLog(params), { enabled: allowed });
  const link = `/audit-log?entityType=order&entityId=${encodeURIComponent(orderId)}`;
  if (!allowed) return <Alert type="info" showIcon message={t('orders.detail.audit.noAccess')} />;
  return (
    <>
      <Link to={link}>
        <AuditOutlined /> {t('orders.detail.audit.open')}
      </Link>
      {log.error ? <ErrorAlert error={log.error} onRetry={() => void log.refetch()} /> : null}
      <Table<AuditRecord>
        style={{ marginTop: 12 }}
        size="small"
        rowKey="id"
        loading={log.isLoading}
        pagination={false}
        dataSource={log.data?.items ?? []}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('orders.detail.audit.empty') }}
        columns={[
          { title: t('audit.time'), key: 'time', render: (_, r) => formatDateTimeSeconds(r.occurredAt) },
          { title: t('audit.actor'), key: 'actor', render: (_, r) => r.actorName },
          { title: t('audit.action'), key: 'action', render: (_, r) => <Typography.Text code>{r.action}</Typography.Text> },
        ]}
      />
    </>
  );
}

/**
 * Карточка заказа: действия (от сервера), состав со снимком модификаторов, суммы (MoneyText),
 * гость, адрес и точка на карте, оплата и возвраты, курьер, история статусов, журнал.
 */
export function OrderDetailsView({ order, extra }: { order: AdminOrderDetails; extra?: ReactNode }) {
  const { t } = useTranslation();
  const [cancelMode, setCancelMode] = useState<'cancel' | 'reject' | null>(null);
  const [refundOpen, setRefundOpen] = useState(false);
  const actions = detailActions(order);

  return (
    <>
      <Flex justify="space-between" align="flex-start" wrap gap={12} style={{ marginBottom: 16 }}>
        <Space direction="vertical" size={6}>
          <Space wrap size={6}>
            <StatusTag domain="order" status={order.status} />
            <OrderTypeTag type={order.type} />
            <PaymentTag method={order.paymentMethod} status={order.status} />
            <ChannelTag channel={order.channel} />
          </Space>
          <Space size={4} align="baseline">
            <MoneyText value={order.total} strong />
          </Space>
        </Space>
        <Flex gap={8} wrap justify="flex-end">
          <OrderActionButtons
            order={order}
            actions={actions}
            onReject={() => setCancelMode('reject')}
            onCancel={() => setCancelMode('cancel')}
          />
          {extra}
        </Flex>
      </Flex>
      <Tabs
        items={[
          { key: 'info', label: t('orders.detail.tabs.info'), children: <InfoTab order={order} /> },
          {
            key: 'payments',
            label: t('orders.detail.tabs.payments'),
            children: <PaymentsTab order={order} onRefund={() => setRefundOpen(true)} />,
          },
          { key: 'history', label: t('orders.detail.tabs.history'), children: <HistoryTab order={order} /> },
          { key: 'audit', label: t('orders.detail.tabs.audit'), children: <AuditTab orderId={order.id} /> },
        ]}
      />
      <CancelOrderDialog
        key={`cancel:${order.id}:${cancelMode ?? 'closed'}`}
        orderId={cancelMode ? order.id : null}
        preferred={cancelMode ?? undefined}
        onClose={() => setCancelMode(null)}
      />
      <RefundDialog key={`refund:${order.id}:${refundOpen}`} order={order} open={refundOpen} onClose={() => setRefundOpen(false)} />
    </>
  );
}
