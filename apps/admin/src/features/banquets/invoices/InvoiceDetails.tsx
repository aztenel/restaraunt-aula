import { BankOutlined, FilePdfOutlined, LinkOutlined, ReloadOutlined, RollbackOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import { App, Button, Card, Descriptions, Empty, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useApiMutation } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { tx } from '@/shared/i18n/tx';
import { formatDateTime } from '@/shared/lib/dates';
import { MoneyText } from '@/shared/ui/MoneyText';
import { StatusTag } from '@/shared/ui/StatusTag';
import { useRequestAbilities } from '../abilities';
import { banquetsApi, openSignedLink } from '../api';
import { formatIsoDate } from '../common/format';
import { CopyLink, InvoiceStatusTag } from '../common/ui';
import { canRefundPayment, invoiceActions, paymentLinkActions } from '../invoice-form';
import { useInvalidateBanquets } from '../request/useRequestMutation';
import { bpToPercentText } from '../sla';
import type { Invoice, InvoicePayment, InvoiceRefund } from '../types';
import { BankTransferModal, CancelInvoiceModal, RefundModal } from './InvoiceModals';

/** Счёт: реквизиты, суммы (от сервера), поступления, регистрация перевода, отмена, возвраты, PDF. */
export function InvoiceDetails({ invoice, requestNumber }: { invoice: Invoice; requestNumber?: string }) {
  const { t, i18n } = useTranslation();
  const notifyError = useNotifyError();
  const abilities = useRequestAbilities(invoice.branchId);
  const actions = invoiceActions(invoice, abilities);
  const [transferOpen, setTransferOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [refundPayment, setRefundPayment] = useState<InvoicePayment | null>(null);
  const { modal } = App.useApp();
  const invalidate = useInvalidateBanquets();
  const link = paymentLinkActions(invoice, abilities);
  const sendLink = useApiMutation((regenerate: boolean) => banquetsApi.sendPaymentLink(invoice.id, regenerate), {
    successMessage: t('banquets.invoices.paymentLink.sent'),
    onSuccess: () => invalidate(),
  });

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space wrap>
        {actions.registerPayment ? (
          <Button type="primary" icon={<BankOutlined />} onClick={() => setTransferOpen(true)}>
            {t('banquets.invoices.bankTransfer.action')}
          </Button>
        ) : null}
        <Button icon={<FilePdfOutlined />} onClick={() => void openSignedLink(() => banquetsApi.invoicePdf(invoice.id)).catch(notifyError)}>
          PDF
        </Button>
        {actions.cancel ? (
          <Button danger icon={<StopOutlined />} onClick={() => setCancelOpen(true)}>
            {t('banquets.invoices.cancel.action')}
          </Button>
        ) : null}
        <Link to={`/banquets/${invoice.requestId}?tab=invoices`}>{t('banquets.invoices.detail.openRequest')}</Link>
      </Space>
      <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label={t('banquets.common.status')}>
          <InvoiceStatusTag status={invoice.status} overdue={invoice.overdue} />
        </Descriptions.Item>
        <Descriptions.Item label={t('banquets.invoices.request')}>
          <Link to={`/banquets/${invoice.requestId}`}>{requestNumber ?? invoice.requestId}</Link>
        </Descriptions.Item>
        <Descriptions.Item label={t('banquets.invoices.payer')}>
          {tx(t, `banquets.invoices.payerShort.${invoice.payerType}`, invoice.payerType)} · {tx(t, `banquets.invoices.purposes.${invoice.purpose}`, invoice.purpose)}
        </Descriptions.Item>
        <Descriptions.Item label={t('banquets.invoices.buyer')}>
          {invoice.buyer.name}
          {invoice.buyer.bin ? ` · ${invoice.buyer.bin}` : ''}
        </Descriptions.Item>
        <Descriptions.Item label={t('banquets.invoices.amount')}>
          <MoneyText value={invoice.amount} strong />
        </Descriptions.Item>
        <Descriptions.Item label={t('banquets.invoices.vat')}>
          {invoice.vatRateBp > 0 ? (
            <>
              <MoneyText value={invoice.vat} /> ({bpToPercentText(invoice.vatRateBp, i18n.language)}%)
            </>
          ) : (
            t('banquets.invoices.noVat')
          )}
        </Descriptions.Item>
        <Descriptions.Item label={t('banquets.invoices.paid')}>
          <MoneyText value={invoice.paid} type="success" />
        </Descriptions.Item>
        <Descriptions.Item label={t('banquets.invoices.refunded')}>
          <MoneyText value={invoice.refunded} />
        </Descriptions.Item>
        <Descriptions.Item label={t('banquets.invoices.remaining')}>
          <MoneyText value={invoice.remaining} strong type={invoice.remaining.amount > 0 ? 'danger' : undefined} />
        </Descriptions.Item>
        <Descriptions.Item label={t('banquets.invoices.dueDate')}>
          <Typography.Text type={invoice.overdue ? 'danger' : undefined}>{formatIsoDate(invoice.dueDate)}</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label={t('banquets.invoices.issuedAt')}>{formatDateTime(invoice.issuedAt)}</Descriptions.Item>
        {invoice.paidAt ? <Descriptions.Item label={t('banquets.invoices.paidAt')}>{formatDateTime(invoice.paidAt)}</Descriptions.Item> : null}
        {invoice.cancelledAt ? (
          <Descriptions.Item label={t('banquets.invoices.cancelledAt')}>
            {formatDateTime(invoice.cancelledAt)}
            {invoice.cancelReason ? ` · ${invoice.cancelReason}` : ''}
          </Descriptions.Item>
        ) : null}
        <Descriptions.Item label={t('banquets.invoices.description')} span={2}>
          {invoice.description}
        </Descriptions.Item>
        <Descriptions.Item label={t('banquets.invoices.publicLink')} span={2}>
          <Space direction="vertical" size={0}>
            <CopyLink url={invoice.publicUrl} />
            {invoice.payerType === 'individual' ? <Typography.Text type="secondary">{t('banquets.invoices.onlineHint')}</Typography.Text> : null}
          </Space>
        </Descriptions.Item>
        {invoice.payerType === 'individual' ? (
          <Descriptions.Item label={t('banquets.invoices.paymentLink.title')} span={2}>
            <Space direction="vertical" size={6}>
              <Space wrap size={6}>
                {invoice.paymentStatus ? <StatusTag domain="payment" status={invoice.paymentStatus} /> : <Tag>{t('banquets.invoices.paymentLink.none')}</Tag>}
                {invoice.paymentUrl ? <CopyLink url={invoice.paymentUrl} label={t('banquets.invoices.paymentLink.open')} /> : null}
              </Space>
              {link.resend || link.regenerate ? (
                <Space wrap>
                  {link.resend ? (
                    <Button
                      size="small"
                      icon={<SendOutlined />}
                      loading={sendLink.isPending && sendLink.variables === false}
                      onClick={() => sendLink.mutate(false)}
                    >
                      {t('banquets.invoices.paymentLink.resend')}
                    </Button>
                  ) : null}
                  {link.regenerate ? (
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      loading={sendLink.isPending && sendLink.variables === true}
                      onClick={() =>
                        modal.confirm({
                          title: t('banquets.invoices.paymentLink.regenerateConfirm'),
                          content: t('banquets.invoices.paymentLink.regenerateHint'),
                          okText: t('banquets.invoices.paymentLink.regenerate'),
                          cancelText: t('common.cancel'),
                          onOk: () => sendLink.mutateAsync(true).catch(() => undefined),
                        })
                      }
                    >
                      {t('banquets.invoices.paymentLink.regenerate')}
                    </Button>
                  ) : null}
                </Space>
              ) : null}
              {!invoice.paymentUrl && invoice.paymentStatus && link.resend ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  <LinkOutlined /> {t('banquets.invoices.paymentLink.inactiveHint')}
                </Typography.Text>
              ) : null}
            </Space>
          </Descriptions.Item>
        ) : null}
      </Descriptions>
      <Card size="small" title={t('banquets.invoices.detail.payments')}>
        {invoice.payments.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('banquets.invoices.detail.noPayments')} />
        ) : (
          <Table<InvoicePayment>
            size="small"
            rowKey="paymentId"
            pagination={false}
            dataSource={invoice.payments}
            scroll={{ x: 'max-content' }}
            columns={[
              { title: t('banquets.invoices.paidAt'), dataIndex: 'paidAt', render: (v: string) => formatDateTime(v) },
              { title: t('banquets.invoices.detail.method'), dataIndex: 'method', render: (m: string) => tx(t, `banquets.invoices.methods.${m}`, m) },
              { title: t('banquets.invoices.amount'), dataIndex: 'amount', align: 'right', render: (v: InvoicePayment['amount']) => <MoneyText value={v} strong /> },
              {
                title: t('banquets.invoices.refunded'),
                dataIndex: 'refunded',
                align: 'right',
                render: (v: InvoicePayment['refunded']) => (v.amount > 0 ? <MoneyText value={v} type="danger" /> : '—'),
              },
              {
                title: t('banquets.invoices.refundable'),
                dataIndex: 'refundable',
                align: 'right',
                render: (v: InvoicePayment['refundable']) => <MoneyText value={v} type={v.amount > 0 ? undefined : 'secondary'} />,
              },
              { title: t('banquets.invoices.detail.documentNumber'), dataIndex: 'documentNumber', render: (v: string | null) => v ?? '—' },
              { title: t('banquets.invoices.detail.recordedBy'), dataIndex: 'recordedByName' },
              {
                title: '',
                key: 'refund',
                render: (_, p) =>
                  canRefundPayment(p, abilities) ? (
                    <Button size="small" danger icon={<RollbackOutlined />} onClick={() => setRefundPayment(p)}>
                      {t('banquets.invoices.refund.action')}
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </Card>
      {invoice.refunds.length > 0 ? (
        <Card size="small" title={t('banquets.invoices.refunds.title')}>
          <Table<InvoiceRefund>
            size="small"
            rowKey="refundId"
            pagination={false}
            dataSource={invoice.refunds}
            scroll={{ x: 'max-content' }}
            columns={[
              { title: t('banquets.invoices.refunds.createdAt'), dataIndex: 'createdAt', render: (v: string) => formatDateTime(v) },
              { title: t('banquets.invoices.amount'), dataIndex: 'amount', align: 'right', render: (v: InvoiceRefund['amount']) => <MoneyText value={v} strong /> },
              { title: t('banquets.common.status'), dataIndex: 'status', render: (status: string) => <RefundStatusTag status={status} /> },
              { title: t('banquets.invoices.refunds.reason'), dataIndex: 'reason' },
              { title: t('banquets.invoices.refunds.completedAt'), dataIndex: 'completedAt', render: (v: string | null) => (v ? formatDateTime(v) : '—') },
            ]}
          />
        </Card>
      ) : null}
      <BankTransferModal open={transferOpen} invoice={invoice} onClose={() => setTransferOpen(false)} />
      <CancelInvoiceModal open={cancelOpen} invoice={invoice} onClose={() => setCancelOpen(false)} />
      <RefundModal open={refundPayment !== null} requestId={invoice.requestId} payment={refundPayment} onClose={() => setRefundPayment(null)} />
    </Space>
  );
}

const REFUND_COLORS: Record<string, string> = { pending: 'processing', succeeded: 'success', failed: 'error' };

export function RefundStatusTag({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <Tag color={REFUND_COLORS[status] ?? 'default'} style={{ marginInlineEnd: 0 }}>
      {tx(t, `banquets.invoices.refunds.statuses.${status}`, status)}
    </Tag>
  );
}
