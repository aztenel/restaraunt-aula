import { Checkbox, Flex, Select, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useApiQuery } from '@/shared/api/hooks';
import { useBranch } from '@/shared/branch/BranchProvider';
import { BranchSelect } from '@/shared/ui/BranchSelect';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PaginatedTable } from '@/shared/ui/PaginatedTable';
import { banquetsApi, banquetsKeys } from '../api';
import { INVOICE_STATUSES, type InvoiceListItem, type InvoiceStatus } from '../types';
import { invoiceColumns } from './invoice-columns';

/** Счета по банкетам всех заявок (финансы): фильтры по филиалу, статусу и просрочке. */
export function InvoicesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { selectedBranchId, canSelectAll, branchName } = useBranch();
  const [branchId, setBranchId] = useState<string | null>(selectedBranchId);
  const [statuses, setStatuses] = useState<InvoiceStatus[]>([]);
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  useEffect(() => {
    setBranchId(selectedBranchId);
    setPage(1);
  }, [selectedBranchId]);

  const params = { branchId: branchId ?? undefined, status: statuses, overdue, page, perPage };
  const invoices = useApiQuery(banquetsKeys.invoices(params), () => banquetsApi.invoices(params), { keepPrevious: true });
  const open = (inv: InvoiceListItem) => navigate(`/banquets/invoices/${inv.id}`);

  return (
    <>
      <Flex justify="space-between" gap={12} wrap style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={0}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t('banquets.invoices.title')}
          </Typography.Title>
          <Typography.Text type="secondary">{t('banquets.invoices.subtitle')}</Typography.Text>
        </Space>
        <Space wrap>
          <BranchSelect
            allowAll={canSelectAll}
            value={branchId}
            onChange={(next) => {
              setBranchId(next);
              setPage(1);
            }}
            style={{ width: 200 }}
          />
          <Select<InvoiceStatus[]>
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            placeholder={t('banquets.invoices.filters.status')}
            value={statuses}
            onChange={(next) => {
              setStatuses(next);
              setPage(1);
            }}
            options={INVOICE_STATUSES.map((s) => ({ value: s, label: t(`banquets.invoices.statuses.${s}`) }))}
            style={{ minWidth: 220 }}
          />
          <Checkbox
            checked={overdue}
            onChange={(e) => {
              setOverdue(e.target.checked);
              setPage(1);
            }}
          >
            {t('banquets.invoices.filters.overdue')}
          </Checkbox>
        </Space>
      </Flex>
      {invoices.error ? <ErrorAlert error={invoices.error} onRetry={() => void invoices.refetch()} /> : null}
      <PaginatedTable<InvoiceListItem>
        rowKey="id"
        data={invoices.data}
        loading={invoices.isFetching}
        page={page}
        perPage={perPage}
        onPageChange={(p, size) => {
          setPage(p);
          setPerPage(size);
        }}
        locale={{ emptyText: t('banquets.invoices.empty') }}
        onRow={(inv) => ({ onDoubleClick: () => open(inv) })}
        columns={invoiceColumns<InvoiceListItem>(t, {
          onOpen: open,
          requestColumn: (inv) => <Link to={`/banquets/${inv.requestId}?tab=invoices`}>{inv.requestNumber}</Link>,
          branchColumn: (inv) => (inv.branchId ? branchName(inv.branchId) : t('banquets.common.offsite')),
        })}
      />
    </>
  );
}
