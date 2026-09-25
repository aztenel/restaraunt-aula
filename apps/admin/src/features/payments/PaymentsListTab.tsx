import { WarningOutlined } from '@ant-design/icons';
import { AutoComplete, Button, Flex, Input, Select, Space, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney, Permission } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useCan } from '@/shared/auth/useCan';
import { useBranch } from '@/shared/branch/BranchProvider';
import { formatDateTime } from '@/shared/lib/dates';
import { BranchSelect } from '@/shared/ui/BranchSelect';
import { DateRangeFilter } from '@/shared/ui/DateRangeFilter';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MoneyText } from '@/shared/ui/MoneyText';
import { PaginatedTable } from '@/shared/ui/PaginatedTable';
import { StatusTag } from '@/shared/ui/StatusTag';
import { paymentKeys, paymentsApi } from './api';
import { emptyPaymentFilters, toPaymentListQuery, type PaymentFilters } from './payment-filters';
import { MethodText, PurposeTag, ReferenceLink } from './PaymentTags';
import {
  PAYMENT_METHODS,
  PAYMENT_PROVIDERS,
  PAYMENT_PURPOSES,
  PAYMENT_STATUSES,
  type Payment,
  type PaymentMethod,
  type PaymentPurpose,
  type PaymentStatus,
} from './types';

/**
 * Список платежей (payments.view): филиал (по умолчанию — из шапки), назначение, способ, провайдер,
 * статус, период создания, объект оплаты. Строка открывает карточку платежа.
 */
export function PaymentsListTab({ onOpen }: { onOpen: (paymentId: string) => void }) {
  const { t, i18n } = useTranslation();
  const { branchesWith } = useCan();
  const { selectedBranchId, branchName } = useBranch();
  const scope = branchesWith(Permission.PaymentsView);
  const initialBranch = selectedBranchId && (scope === 'all' || scope.includes(selectedBranchId)) ? selectedBranchId : null;
  const [filters, setFilters] = useState<PaymentFilters>(() => emptyPaymentFilters(initialBranch));
  const [reference, setReference] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  const query = useMemo(() => toPaymentListQuery(filters, page, perPage), [filters, page, perPage]);
  const list = useApiQuery(paymentKeys.list(query), () => paymentsApi.list(query), { keepPrevious: true });

  const update = (patch: Partial<PaymentFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };

  return (
    <>
      <Flex gap={8} wrap style={{ marginBottom: 16 }}>
        <BranchSelect
          allowAll={scope === 'all'}
          allowClear={scope !== 'all'}
          onlyIds={scope === 'all' ? undefined : scope}
          placeholder={t('payments.filters.allBranches')}
          style={{ width: 220 }}
          value={filters.branchId}
          onChange={(branchId) => update({ branchId })}
        />
        <Select<PaymentPurpose>
          allowClear
          placeholder={t('payments.filters.purpose')}
          style={{ width: 200 }}
          value={filters.purpose}
          onChange={(purpose) => update({ purpose })}
          options={PAYMENT_PURPOSES.map((value) => ({ value, label: t(`payments.purpose.${value}`) }))}
        />
        <Select<PaymentMethod>
          allowClear
          placeholder={t('payments.filters.method')}
          style={{ width: 190 }}
          value={filters.method}
          onChange={(method) => update({ method })}
          options={PAYMENT_METHODS.map((value) => ({ value, label: t(`payments.method.${value}`) }))}
        />
        <AutoComplete
          allowClear
          placeholder={t('payments.filters.provider')}
          style={{ width: 180 }}
          value={filters.provider}
          onChange={(provider: string | undefined) => update({ provider: provider || undefined })}
          options={PAYMENT_PROVIDERS.map((value) => ({ value, label: t(`payments.provider.${value}`) }))}
        />
        <Select<PaymentStatus>
          allowClear
          placeholder={t('payments.filters.status')}
          style={{ width: 190 }}
          value={filters.status}
          onChange={(status) => update({ status })}
          options={PAYMENT_STATUSES.map((value) => ({ value, label: t(`statuses.payment.${value}`) }))}
        />
        <DateRangeFilter value={filters.range} onChange={(range) => update({ range })} />
        <Input.Search
          allowClear
          placeholder={t('payments.filters.reference')}
          style={{ width: 320 }}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          onSearch={(value) => update({ referenceId: value.trim() })}
        />
        <Button
          onClick={() => {
            setFilters(emptyPaymentFilters(initialBranch));
            setReference('');
            setPage(1);
          }}
        >
          {t('common.reset')}
        </Button>
      </Flex>
      {list.error ? <ErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : null}
      <PaginatedTable<Payment>
        rowKey="id"
        data={list.data}
        loading={list.isLoading || list.isPlaceholderData}
        page={page}
        perPage={perPage}
        onPageChange={(p, pp) => {
          setPage(p);
          setPerPage(pp);
        }}
        onRow={(payment) => ({ onClick: () => onOpen(payment.id), style: { cursor: 'pointer' } })}
        columns={[
          {
            title: t('payments.columns.createdAt'),
            key: 'createdAt',
            render: (_, p) => (
              <Space direction="vertical" size={0}>
                <span style={{ whiteSpace: 'nowrap' }}>{formatDateTime(p.createdAt)}</span>
                {p.paidAt ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {t('payments.list.paidAt', { date: formatDateTime(p.paidAt) })}
                  </Typography.Text>
                ) : null}
              </Space>
            ),
          },
          {
            title: t('payments.columns.payment'),
            key: 'payment',
            render: (_, p) => (
              <div style={{ maxWidth: 320 }}>
                <Typography.Link strong onClick={() => onOpen(p.id)}>
                  {p.description}
                </Typography.Link>
                <div>
                  <Space size={4} wrap>
                    <PurposeTag purpose={p.purpose} />
                    <ReferenceLink purpose={p.purpose} referenceId={p.referenceId} />
                  </Space>
                </div>
              </div>
            ),
          },
          { title: t('payments.columns.method'), key: 'method', render: (_, p) => <MethodText method={p.method} provider={p.provider} /> },
          {
            title: t('payments.columns.amount'),
            key: 'amount',
            align: 'right',
            render: (_, p) => (
              <Space direction="vertical" size={0} align="end">
                <MoneyText value={p.amount} strong />
                {p.refundedAmount.amount > 0 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {t('payments.list.refunded', { amount: formatMoney(p.refundedAmount, i18n.language) })}
                  </Typography.Text>
                ) : null}
              </Space>
            ),
          },
          {
            title: t('payments.columns.status'),
            key: 'status',
            render: (_, p) => (
              <Space size={4}>
                <StatusTag domain="payment" status={p.status} />
                {p.amountMismatch ? (
                  <Tooltip title={t('payments.list.mismatch')}>
                    <WarningOutlined style={{ color: '#d48806' }} aria-label={t('payments.list.mismatch')} />
                  </Tooltip>
                ) : null}
              </Space>
            ),
          },
          {
            title: t('payments.columns.branch'),
            key: 'branch',
            render: (_, p) => (p.branchId ? branchName(p.branchId) : <Typography.Text type="secondary">{t('payments.list.noBranch')}</Typography.Text>),
          },
          {
            title: t('payments.columns.customer'),
            key: 'customer',
            render: (_, p) => (
              <Space direction="vertical" size={0}>
                {p.customer.name ? <span>{p.customer.name}</span> : null}
                {p.customer.phone ? <Typography.Text type="secondary">{p.customer.phone}</Typography.Text> : null}
                {!p.customer.name && !p.customer.phone ? '—' : null}
              </Space>
            ),
          },
        ]}
      />
    </>
  );
}
