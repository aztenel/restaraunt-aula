import { CheckCircleTwoTone, CloseCircleTwoTone, ExportOutlined, RollbackOutlined, WalletOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Collapse, Descriptions, Empty, Flex, Space, Table, Tag, Timeline, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@aula/api-client';
import { useBranch } from '@/shared/branch/BranchProvider';
import { formatDateTime, formatDateTimeSeconds } from '@/shared/lib/dates';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { JsonBlock } from '@/shared/ui/JsonBlock';
import { MoneyText } from '@/shared/ui/MoneyText';
import { StatusTag } from '@/shared/ui/StatusTag';
import { paymentKeys, paymentsApi } from './api';
import { ManualRefundActions } from './ManualRefundActions';
import { buildPaymentTimeline, type TimelineEvent } from './payment-timeline';
import { MethodText, PurposeTag, ReferenceLink, RefundModeTag, RefundStatusTag } from './PaymentTags';
import { RefundDialog } from './RefundDialog';
import type { PaymentDetails, PaymentRefund, ProviderLogEntry, WebhookEvent } from './types';

function TimelineLabel({ event }: { event: TimelineEvent }) {
  const { t, i18n } = useTranslation();
  const money = (value: { amount: number; currency: 'KZT' }) => formatMoney(value, i18n.language);
  switch (event.kind) {
    case 'created':
      return <>{t('payments.history.created')}</>;
    case 'paid':
      return <>{t('payments.history.paid')}</>;
    case 'webhook':
      return (
        <Space size={4} wrap>
          {t('payments.history.webhook', { status: event.status })}
          <Tag color={event.outcome === 'applied' ? 'success' : event.outcome === 'ignored' ? 'default' : 'error'}>
            {t(`payments.webhookOutcome.${event.outcome}`)}
          </Tag>
        </Space>
      );
    case 'refund_requested':
      return <>{t('payments.history.refundRequested', { amount: money(event.amount) })}</>;
    case 'refund_completed':
      return (
        <>
          {event.status === 'succeeded'
            ? t('payments.history.refundSucceeded', { amount: money(event.amount) })
            : t('payments.history.refundFailed', { amount: money(event.amount) })}
        </>
      );
    case 'current':
      return (
        <Space size={6}>
          {t('payments.history.current')}
          <StatusTag domain="payment" status={event.status} />
        </Space>
      );
  }
}

function timelineColor(event: TimelineEvent): string {
  if (event.kind === 'paid') return 'green';
  if (event.kind === 'refund_requested') return 'orange';
  if (event.kind === 'refund_completed') return event.status === 'succeeded' ? 'magenta' : 'red';
  if (event.kind === 'webhook') return event.outcome === 'applied' ? 'blue' : 'gray';
  if (event.kind === 'current') return 'gray';
  return 'blue';
}

function RefundsTable({ refunds }: { refunds: PaymentRefund[] }) {
  const { t } = useTranslation();
  if (refunds.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('payments.detail.noRefunds')} />;
  return (
    <Table<PaymentRefund>
      rowKey="id"
      size="small"
      pagination={false}
      scroll={{ x: 'max-content' }}
      dataSource={refunds}
      columns={[
        { title: t('payments.refunds.columns.createdAt'), key: 'createdAt', render: (_, r) => formatDateTime(r.createdAt) },
        { title: t('payments.refunds.columns.amount'), key: 'amount', render: (_, r) => <MoneyText value={r.amount} strong /> },
        {
          title: t('payments.refunds.columns.status'),
          key: 'status',
          render: (_, r) => (
            <Space direction="vertical" size={2}>
              <Space size={4} wrap>
                <RefundStatusTag status={r.status} />
                <RefundModeTag mode={r.mode} />
              </Space>
              {r.awaitingManualConfirmation ? <Tag color="gold">{t('payments.refunds.awaiting')}</Tag> : null}
            </Space>
          ),
        },
        {
          title: t('payments.refunds.columns.reason'),
          key: 'reason',
          render: (_, r) => (
            <Space direction="vertical" size={0} style={{ maxWidth: 320 }}>
              <Typography.Text>{r.reason}</Typography.Text>
              {r.comment ? <Typography.Text type="secondary">{t('payments.refunds.comment', { text: r.comment })}</Typography.Text> : null}
              {r.failureReason ? <Typography.Text type="danger">{t('payments.refunds.failure', { text: r.failureReason })}</Typography.Text> : null}
              {r.attempts > 0 && r.mode === 'gateway' ? (
                <Typography.Text type="secondary">{t('payments.refunds.attempts', { count: r.attempts })}</Typography.Text>
              ) : null}
              {r.completedAt ? (
                <Typography.Text type="secondary">{t('payments.refunds.completedAt', { date: formatDateTime(r.completedAt) })}</Typography.Text>
              ) : null}
            </Space>
          ),
        },
        { title: t('common.actions'), key: 'actions', render: (_, r) => <ManualRefundActions refund={r} /> },
      ]}
    />
  );
}

function WebhooksTable({ events }: { events: WebhookEvent[] }) {
  const { t } = useTranslation();
  if (events.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('payments.detail.noWebhooks')} />;
  return (
    <Table<WebhookEvent>
      rowKey="id"
      size="small"
      pagination={false}
      scroll={{ x: 'max-content' }}
      dataSource={events}
      columns={[
        { title: t('payments.webhookColumns.receivedAt'), key: 'receivedAt', render: (_, e) => formatDateTimeSeconds(e.receivedAt) },
        { title: t('payments.webhookColumns.eventId'), key: 'eventId', render: (_, e) => <Typography.Text code>{e.eventId}</Typography.Text> },
        { title: t('payments.webhookColumns.status'), key: 'status', dataIndex: 'status' },
        {
          title: t('payments.webhookColumns.outcome'),
          key: 'outcome',
          render: (_, e) => (
            <Tag color={e.outcome === 'applied' ? 'success' : e.outcome === 'ignored' ? 'default' : 'error'}>{t(`payments.webhookOutcome.${e.outcome}`)}</Tag>
          ),
        },
        { title: t('payments.webhookColumns.reportedAmount'), key: 'reportedAmount', render: (_, e) => (e.reportedAmount ? <MoneyText value={e.reportedAmount} /> : '—') },
      ]}
    />
  );
}

function ProviderLog({ entries }: { entries: ProviderLogEntry[] }) {
  const { t } = useTranslation();
  if (entries.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('payments.detail.noLog')} />;
  return (
    <>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {t('payments.detail.maskedHint')}
      </Typography.Paragraph>
      <Collapse
        size="small"
        items={entries.map((entry) => ({
          key: entry.id,
          label: (
            <Flex gap={8} wrap align="center">
              {entry.success ? <CheckCircleTwoTone twoToneColor="#52c41a" /> : <CloseCircleTwoTone twoToneColor="#ff4d4f" />}
              <Typography.Text>{formatDateTimeSeconds(entry.occurredAt)}</Typography.Text>
              <Tag>{entry.integration}</Tag>
              <Typography.Text strong>{entry.operation}</Typography.Text>
              <Typography.Text type="secondary">{t(`payments.direction.${entry.direction}`)}</Typography.Text>
              {entry.statusCode ? <Tag color={entry.success ? 'default' : 'error'}>HTTP {entry.statusCode}</Tag> : null}
              {entry.durationMs !== null && entry.durationMs !== undefined ? (
                <Typography.Text type="secondary">{t('payments.detail.duration', { ms: entry.durationMs })}</Typography.Text>
              ) : null}
            </Flex>
          ),
          children: (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {entry.error ? <Alert type="error" showIcon message={`${t('payments.detail.error')}: ${entry.error}`} /> : null}
              <Typography.Text strong>{t('payments.detail.request')}</Typography.Text>
              <JsonBlock value={entry.request ?? null} maxHeight={240} />
              <Typography.Text strong>{t('payments.detail.response')}</Typography.Text>
              <JsonBlock value={entry.response ?? null} maxHeight={240} />
            </Space>
          ),
        }))}
      />
    </>
  );
}

/**
 * Карточка платежа: суммы (оплачено, возвращено, можно вернуть — от сервера), статус и история,
 * возвраты с ручным подтверждением, уведомления провайдера и маскированный журнал обмена.
 * Действия — по флагам сервера: canRefund (payments.refund), canCollect (payments.manual).
 */
export function PaymentDetailsView({ details }: { details: PaymentDetails }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { branchName } = useBranch();
  const [refunding, setRefunding] = useState(false);
  const { payment } = details;
  const timeline = buildPaymentTimeline(details);
  const customer = [payment.customer.name, payment.customer.phone, payment.customer.email].filter(Boolean).join(' · ');

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {payment.amountMismatch ? <Alert type="warning" showIcon message={t('payments.detail.mismatch')} /> : null}
      {payment.failureReason ? <Alert type="error" showIcon message={t('payments.detail.failureReason', { reason: payment.failureReason })} /> : null}
      {payment.cancelReason ? <Alert type="info" showIcon message={t('payments.detail.cancelReason', { reason: payment.cancelReason })} /> : null}

      {payment.canRefund || payment.canCollect ? (
        <Flex gap={8} wrap>
          {payment.canRefund ? (
            <Button danger icon={<RollbackOutlined />} onClick={() => setRefunding(true)}>
              {t('payments.actions.refund')}
            </Button>
          ) : null}
          {payment.canCollect ? (
            <ConfirmAction
              title={t('payments.actions.collectConfirm')}
              description={t('payments.actions.collectHint', { amount: formatMoney(payment.amount, i18n.language) })}
              buttonProps={{ type: 'primary', icon: <WalletOutlined /> }}
              successMessage={t('payments.actions.collected')}
              onConfirm={async () => {
                await paymentsApi.collect(payment.id);
                await queryClient.invalidateQueries({ queryKey: paymentKeys.all });
              }}
            >
              {t('payments.actions.collect')}
            </ConfirmAction>
          ) : null}
        </Flex>
      ) : null}

      <Descriptions
        bordered
        size="small"
        column={{ xs: 1, sm: 1, md: 2 }}
        items={[
          { key: 'amount', label: t('payments.detail.amount'), children: <MoneyText value={payment.amount} strong /> },
          { key: 'status', label: t('payments.detail.status'), children: <StatusTag domain="payment" status={payment.status} /> },
          { key: 'refunded', label: t('payments.detail.refunded'), children: <MoneyText value={payment.refundedAmount} /> },
          { key: 'refundable', label: t('payments.detail.refundable'), children: <MoneyText value={payment.refundableAmount} /> },
          { key: 'purpose', label: t('payments.detail.purpose'), children: <PurposeTag purpose={payment.purpose} /> },
          { key: 'reference', label: t('payments.detail.reference'), children: <ReferenceLink purpose={payment.purpose} referenceId={payment.referenceId} /> },
          { key: 'method', label: t('payments.detail.method'), children: <MethodText method={payment.method} provider={payment.provider} /> },
          {
            key: 'branch',
            label: t('payments.detail.branch'),
            children: payment.branchId ? branchName(payment.branchId) : <Typography.Text type="secondary">{t('payments.list.noBranch')}</Typography.Text>,
          },
          { key: 'description', label: t('payments.detail.description'), children: payment.description, span: 'filled' },
          { key: 'customer', label: t('payments.detail.customer'), children: customer || '—', span: 'filled' },
          { key: 'createdAt', label: t('payments.detail.createdAt'), children: formatDateTimeSeconds(payment.createdAt) },
          { key: 'paidAt', label: t('payments.detail.paidAt'), children: formatDateTimeSeconds(payment.paidAt) },
          ...(payment.expiresAt ? [{ key: 'expiresAt', label: t('payments.detail.expiresAt'), children: formatDateTime(payment.expiresAt) }] : []),
          { key: 'invoiceNo', label: t('payments.detail.invoiceNo'), children: payment.invoiceNo },
          ...(payment.externalId
            ? [{ key: 'externalId', label: t('payments.detail.externalId'), children: <Typography.Text copyable>{payment.externalId}</Typography.Text> }]
            : []),
          ...(payment.paymentUrl && (payment.status === 'created' || payment.status === 'pending')
            ? [
                {
                  key: 'paymentUrl',
                  label: t('payments.detail.paymentUrl'),
                  children: (
                    <Typography.Link href={payment.paymentUrl} target="_blank" rel="noreferrer">
                      <ExportOutlined /> {t('payments.detail.openPaymentUrl')}
                    </Typography.Link>
                  ),
                },
              ]
            : []),
        ]}
      />

      <Card size="small" title={t('payments.detail.sections.history')}>
        <Timeline
          items={timeline.map((event, index) => ({
            key: `${event.kind}-${index}`,
            color: timelineColor(event),
            children: (
              <div>
                <TimelineLabel event={event} />
                {event.at ? (
                  <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                    {formatDateTimeSeconds(event.at)}
                  </Typography.Text>
                ) : null}
              </div>
            ),
          }))}
        />
      </Card>

      <Card size="small" title={t('payments.detail.sections.refunds')}>
        <RefundsTable refunds={details.refunds} />
      </Card>

      <Card size="small" title={t('payments.detail.sections.webhooks')}>
        <WebhooksTable events={details.webhookEvents} />
      </Card>

      <Card size="small" title={t('payments.detail.sections.providerLog')}>
        <ProviderLog entries={details.providerLog} />
      </Card>

      {refunding ? <RefundDialog payment={payment} open onClose={() => setRefunding(false)} /> : null}
    </Space>
  );
}
