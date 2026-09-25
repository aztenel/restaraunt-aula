import { Alert, Card, Descriptions, Drawer, Empty, Grid, Space, Spin, Table, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { formatMoney, MINUS_SIGN, translate, type Money } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useBranch } from '@/shared/branch/BranchProvider';
import { formatDateTime } from '@/shared/lib/dates';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MoneyText } from '@/shared/ui/MoneyText';
import { StatusTag } from '@/shared/ui/StatusTag';
import { formatLocalDate } from './abilities';
import { certificateKeys, certificatesApi } from './api';
import { CertificateActions } from './CertificateActions';
import type { CertificateDetails, LedgerEntry, LedgerKind } from './types';

const LEDGER_COLORS: Record<LedgerKind, string> = { issue: 'blue', debit: 'orange', credit: 'green', expire: 'default', reinstate: 'cyan' };
/** Операции, уменьшающие остаток (показываются со знаком минус). */
const OUTGOING: readonly LedgerKind[] = ['debit', 'expire'];

function person(p: { name?: string | null; phone?: string | null; email?: string | null }): string {
  return [p.name, p.phone, p.email].filter(Boolean).join(' · ') || '—';
}

function SignedMoney({ kind, amount }: { kind: LedgerKind; amount: Money }) {
  const { i18n } = useTranslation();
  const outgoing = OUTGOING.includes(kind);
  return (
    <Typography.Text type={outgoing ? 'danger' : 'success'} style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
      {outgoing ? MINUS_SIGN : '+'}
      {formatMoney(amount, i18n.language)}
    </Typography.Text>
  );
}

export function CertificateDetailsView({ details }: { details: CertificateDetails }) {
  const { t, i18n } = useTranslation();
  const { branchName } = useBranch();
  const { certificate, order } = details;
  const setDescription = certificate.setDescription ? translate(certificate.setDescription, i18n.language) : '';

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {certificate.statusReason ? <Alert type="warning" showIcon message={t('certificates.detail.statusReason', { reason: certificate.statusReason })} /> : null}
      <CertificateActions certificate={certificate} />
      <Descriptions
        bordered
        size="small"
        column={{ xs: 1, sm: 1, md: 2 }}
        items={[
          {
            key: 'code',
            label: t('certificates.detail.code'),
            children: <Typography.Text style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{certificate.maskedCode}</Typography.Text>,
          },
          { key: 'status', label: t('certificates.detail.status'), children: <StatusTag domain="certificate" status={certificate.status} /> },
          { key: 'name', label: t('certificates.detail.name'), children: translate(certificate.name, i18n.language) },
          { key: 'kind', label: t('certificates.detail.kind'), children: t(`certificates.kind.${certificate.kind}`) },
          { key: 'balance', label: t('certificates.detail.balance'), children: <MoneyText value={certificate.balance} strong /> },
          { key: 'nominal', label: t('certificates.detail.nominal'), children: <MoneyText value={certificate.nominal} /> },
          { key: 'price', label: t('certificates.detail.price'), children: <MoneyText value={certificate.price} /> },
          { key: 'issuedAt', label: t('certificates.detail.issuedAt'), children: formatDateTime(certificate.issuedAt) },
          { key: 'validUntil', label: t('certificates.detail.validUntil'), children: formatLocalDate(certificate.validUntil) },
          ...(setDescription ? [{ key: 'set', label: t('certificates.detail.setDescription'), children: setDescription, span: 'filled' as const }] : []),
          { key: 'buyer', label: t('certificates.detail.buyer'), children: person(certificate.buyer) },
          { key: 'recipient', label: t('certificates.detail.recipient'), children: person(certificate.recipient) },
          ...(certificate.message ? [{ key: 'message', label: t('certificates.detail.message'), children: certificate.message, span: 'filled' as const }] : []),
          {
            key: 'delivery',
            label: t('certificates.detail.delivery'),
            span: 'filled',
            children: (
              <span>
                {t('certificates.detail.deliveryInfo', {
                  channel: t(`certificates.deliveryChannel.${certificate.deliveryChannel}`),
                  locale: t(`certificates.locale.${certificate.locale}`),
                  count: certificate.deliveryCount,
                })}
                {certificate.lastDeliveredAt ? `, ${t('certificates.detail.lastDelivered', { date: formatDateTime(certificate.lastDeliveredAt) })}` : ''}
              </span>
            ),
          },
          ...(order
            ? [
                {
                  key: 'order',
                  label: t('certificates.detail.order'),
                  span: 'filled' as const,
                  children: (
                    <Space direction="vertical" size={0}>
                      <span>
                        {t('certificates.detail.orderInfo', {
                          source: t(`certificates.detail.orderSource.${order.source}`),
                          status: t(`certificates.detail.orderStatus.${order.status}`),
                          quantity: order.quantity,
                          total: formatMoney(order.total, i18n.language),
                        })}
                      </span>
                      {order.buyerCompany ? <Typography.Text type="secondary">{t('certificates.detail.orderCompany', { company: order.buyerCompany })}</Typography.Text> : null}
                      {order.paymentId ? <Link to={`/payments?payment=${order.paymentId}`}>{t('certificates.detail.openPayment')}</Link> : null}
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Card size="small" title={t('certificates.detail.ledger')}>
        {details.ledger.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('certificates.detail.noLedger')} />
        ) : (
          <Table<LedgerEntry>
            rowKey="id"
            size="small"
            pagination={false}
            scroll={{ x: 'max-content' }}
            dataSource={details.ledger}
            columns={[
              { title: t('certificates.detail.ledgerColumns.occurredAt'), key: 'occurredAt', render: (_, e) => formatDateTime(e.occurredAt) },
              {
                title: t('certificates.detail.ledgerColumns.kind'),
                key: 'kind',
                render: (_, e) => <Tag color={LEDGER_COLORS[e.kind]}>{t(`certificates.detail.ledgerKind.${e.kind}`)}</Tag>,
              },
              { title: t('certificates.detail.ledgerColumns.amount'), key: 'amount', align: 'right', render: (_, e) => <SignedMoney kind={e.kind} amount={e.amount} /> },
              { title: t('certificates.detail.ledgerColumns.balanceAfter'), key: 'balanceAfter', align: 'right', render: (_, e) => <MoneyText value={e.balanceAfter} /> },
              { title: t('certificates.detail.ledgerColumns.channel'), key: 'channel', render: (_, e) => t(`certificates.detail.channel.${e.channel}`) },
              { title: t('certificates.detail.ledgerColumns.branch'), key: 'branch', render: (_, e) => (e.branchId ? branchName(e.branchId) : '—') },
              { title: t('certificates.detail.ledgerColumns.actor'), key: 'actor', dataIndex: 'actorName' },
              { title: t('certificates.detail.ledgerColumns.comment'), key: 'comment', render: (_, e) => e.comment || '—' },
            ]}
          />
        )}
      </Card>
    </Space>
  );
}

/** Карточка сертификата поверх списка (?certificate=<id> в адресе). */
export function CertificateDrawer({ certificateId, onClose }: { certificateId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const screens = Grid.useBreakpoint();
  const detail = useApiQuery(certificateKeys.detail(certificateId ?? ''), () => certificatesApi.get(certificateId ?? ''), {
    enabled: certificateId !== null,
  });
  const details = certificateId ? detail.data : undefined;
  return (
    <Drawer
      open={certificateId !== null}
      onClose={onClose}
      width={screens.xl ? 960 : screens.md ? '90%' : '100%'}
      title={details ? t('certificates.detail.title', { code: details.certificate.maskedCode }) : ' '}
      destroyOnHidden
    >
      {detail.isLoading ? <Spin style={{ display: 'block', margin: '48px auto' }} /> : null}
      {detail.error ? <ErrorAlert error={detail.error} onRetry={() => void detail.refetch()} /> : null}
      {details ? <CertificateDetailsView details={details} /> : null}
    </Drawer>
  );
}
