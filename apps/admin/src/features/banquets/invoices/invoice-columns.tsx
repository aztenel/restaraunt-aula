import { Space, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { tx } from '@/shared/i18n/tx';
import { formatDateTime } from '@/shared/lib/dates';
import { MoneyText } from '@/shared/ui/MoneyText';
import { formatIsoDate } from '../common/format';
import { InvoiceStatusTag } from '../common/ui';
import type { Invoice } from '../types';

/** Колонки таблицы счетов (в карточке заявки и в общем списке). */
export function invoiceColumns<T extends Invoice>(
  t: TFunction,
  options: { onOpen: (invoice: T) => void; requestColumn?: (invoice: T) => ReactNode; branchColumn?: (invoice: T) => ReactNode },
): ColumnsType<T> {
  return [
    {
      title: t('banquets.invoices.number'),
      dataIndex: 'number',
      render: (number: string, inv) => (
        <Space direction="vertical" size={0}>
          <Typography.Link onClick={() => options.onOpen(inv)}>{number}</Typography.Link>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {formatDateTime(inv.issuedAt)}
          </Typography.Text>
        </Space>
      ),
    },
    ...(options.requestColumn ? [{ title: t('banquets.invoices.request'), key: 'request', render: (_: unknown, inv: T) => options.requestColumn!(inv) }] : []),
    ...(options.branchColumn ? [{ title: t('banquets.common.branch'), key: 'branch', render: (_: unknown, inv: T) => options.branchColumn!(inv) }] : []),
    {
      title: t('banquets.invoices.payer'),
      key: 'payer',
      render: (_, inv) => (
        <Space direction="vertical" size={0}>
          <span>{inv.buyer.name}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {tx(t, `banquets.invoices.payerShort.${inv.payerType}`, inv.payerType)} · {tx(t, `banquets.invoices.purposes.${inv.purpose}`, inv.purpose)}
          </Typography.Text>
        </Space>
      ),
    },
    { title: t('banquets.invoices.amount'), dataIndex: 'amount', align: 'right', render: (v: Invoice['amount']) => <MoneyText value={v} strong /> },
    { title: t('banquets.invoices.paid'), dataIndex: 'paid', align: 'right', render: (v: Invoice['paid']) => <MoneyText value={v} type="success" /> },
    {
      title: t('banquets.invoices.remaining'),
      dataIndex: 'remaining',
      align: 'right',
      render: (v: Invoice['remaining']) => <MoneyText value={v} type={v.amount > 0 ? 'danger' : undefined} />,
    },
    {
      title: t('banquets.invoices.dueDate'),
      dataIndex: 'dueDate',
      render: (v: string, inv) => <Typography.Text type={inv.overdue ? 'danger' : undefined}>{formatIsoDate(v)}</Typography.Text>,
    },
    { title: t('banquets.common.status'), dataIndex: 'status', render: (s: string, inv) => <InvoiceStatusTag status={s} overdue={inv.overdue} /> },
  ];
}
