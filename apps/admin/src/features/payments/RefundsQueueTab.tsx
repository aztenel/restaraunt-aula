import { Alert, Empty, Flex, Segmented, Select, Space, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Permission } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useCan } from '@/shared/auth/useCan';
import { useBranch } from '@/shared/branch/BranchProvider';
import { formatDateTime } from '@/shared/lib/dates';
import { BranchSelect } from '@/shared/ui/BranchSelect';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MoneyText } from '@/shared/ui/MoneyText';
import { PaginatedTable } from '@/shared/ui/PaginatedTable';
import { paymentKeys, paymentsApi } from './api';
import { ManualRefundActions } from './ManualRefundActions';
import { PurposeTag, ReferenceLink, RefundModeTag, RefundStatusTag } from './PaymentTags';
import { REFUND_MODES, type PaymentRefund, type RefundMode, type RefundQueueQuery, type RefundStatus } from './types';

type StatusFilter = RefundStatus | 'all';

/**
 * Очередь возвратов. По умолчанию — ручные возвраты, ждущие подтверждения финансистом (наличные при
 * получении, банковский перевод: status=pending, mode=manual). Подтвердить/отклонить — payments.manual.
 */
export function RefundsQueueTab({ onOpenPayment }: { onOpenPayment: (paymentId: string) => void }) {
  const { t } = useTranslation();
  const { branchesWith } = useCan();
  const { selectedBranchId, branchName } = useBranch();
  const scope = branchesWith(Permission.PaymentsView);
  const initialBranch = selectedBranchId && (scope === 'all' || scope.includes(selectedBranchId)) ? selectedBranchId : null;
  const [branchId, setBranchId] = useState<string | null>(initialBranch);
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [mode, setMode] = useState<RefundMode | undefined>('manual');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  const query: RefundQueueQuery = useMemo(
    () => ({ branchId: branchId ?? undefined, status: status === 'all' ? undefined : status, mode, page, perPage }),
    [branchId, status, mode, page, perPage],
  );
  const list = useApiQuery(paymentKeys.refunds(query), () => paymentsApi.refunds(query), { keepPrevious: true });

  return (
    <>
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('payments.refunds.hint')} />
      <Flex gap={8} wrap style={{ marginBottom: 16 }}>
        <Segmented<StatusFilter>
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          options={[
            ...(['pending', 'succeeded', 'failed'] as const).map((value) => ({ value, label: t(`payments.refunds.status.${value}`) })),
            { value: 'all' as const, label: t('payments.refunds.allStatuses') },
          ]}
        />
        <Select<RefundMode>
          allowClear
          placeholder={t('payments.refunds.allModes')}
          style={{ width: 210 }}
          value={mode}
          onChange={(value) => {
            setMode(value);
            setPage(1);
          }}
          options={REFUND_MODES.map((value) => ({ value, label: t(`payments.refunds.mode.${value}`) }))}
        />
        <BranchSelect
          allowAll={scope === 'all'}
          allowClear={scope !== 'all'}
          onlyIds={scope === 'all' ? undefined : scope}
          placeholder={t('payments.filters.allBranches')}
          style={{ width: 220 }}
          value={branchId}
          onChange={(value) => {
            setBranchId(value);
            setPage(1);
          }}
        />
      </Flex>
      {list.error ? <ErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : null}
      <PaginatedTable<PaymentRefund>
        rowKey="id"
        data={list.data}
        loading={list.isLoading || list.isPlaceholderData}
        page={page}
        perPage={perPage}
        onPageChange={(p, pp) => {
          setPage(p);
          setPerPage(pp);
        }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('payments.refunds.empty')} /> }}
        columns={[
          { title: t('payments.refunds.columns.createdAt'), key: 'createdAt', render: (_, r) => <span style={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.createdAt)}</span> },
          {
            title: t('payments.refunds.columns.payment'),
            key: 'payment',
            render: (_, r) => (
              <Space direction="vertical" size={2}>
                <Space size={4} wrap>
                  <PurposeTag purpose={r.payment.purpose} />
                  <ReferenceLink purpose={r.payment.purpose} referenceId={r.payment.referenceId} />
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t(`payments.method.${r.payment.method}`)}
                  {r.payment.branchId ? ` · ${branchName(r.payment.branchId)}` : ''}
                </Typography.Text>
                <Typography.Link onClick={() => onOpenPayment(r.paymentId)}>{t('payments.refunds.openPayment')}</Typography.Link>
              </Space>
            ),
          },
          { title: t('payments.refunds.columns.amount'), key: 'amount', align: 'right', render: (_, r) => <MoneyText value={r.amount} strong /> },
          {
            title: t('payments.refunds.columns.reason'),
            key: 'reason',
            render: (_, r) => (
              <Space direction="vertical" size={0} style={{ maxWidth: 320 }}>
                <Typography.Text>{r.reason}</Typography.Text>
                {r.comment ? <Typography.Text type="secondary">{t('payments.refunds.comment', { text: r.comment })}</Typography.Text> : null}
                {r.failureReason ? <Typography.Text type="danger">{t('payments.refunds.failure', { text: r.failureReason })}</Typography.Text> : null}
                {r.completedAt ? (
                  <Typography.Text type="secondary">{t('payments.refunds.completedAt', { date: formatDateTime(r.completedAt) })}</Typography.Text>
                ) : null}
              </Space>
            ),
          },
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
                {r.attempts > 0 && r.mode === 'gateway' ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('payments.refunds.attempts', { count: r.attempts })}
                  </Typography.Text>
                ) : null}
              </Space>
            ),
          },
          { title: t('common.actions'), key: 'actions', render: (_, r) => <ManualRefundActions refund={r} size="middle" /> },
        ]}
      />
    </>
  );
}
