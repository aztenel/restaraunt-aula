import { Space, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Page } from '@aula/api-client';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/dates';
import { MoneyText } from '@/shared/ui/MoneyText';
import { PaginatedTable } from '@/shared/ui/PaginatedTable';
import { StatusTag } from '@/shared/ui/StatusTag';
import { formatEventDate } from '../common/format';
import { EventTypeLabel, PlaceTag, SlaTimer } from '../common/ui';
import type { BanquetRequestSummary } from '../types';

/** Список заявок (альтернатива доске) с серверной пагинацией. */
export function RequestsTable({
  data,
  loading,
  page,
  perPage,
  now,
  highlighted,
  onPageChange,
  onOpen,
}: {
  data: Page<BanquetRequestSummary> | undefined;
  loading: boolean;
  page: number;
  perPage: number;
  now: number;
  highlighted: ReadonlySet<string>;
  onPageChange: (page: number, perPage: number) => void;
  onOpen: (request: BanquetRequestSummary) => void;
}) {
  const { t } = useTranslation();
  const columns: ColumnsType<BanquetRequestSummary> = [
    {
      title: t('banquets.common.number'),
      dataIndex: 'number',
      fixed: 'left',
      render: (number: string, r) => (
        <Space direction="vertical" size={2}>
          <Typography.Link onClick={() => onOpen(r)}>{number}</Typography.Link>
          <SlaTimer subject={r} now={now} />
        </Space>
      ),
    },
    { title: t('banquets.common.status'), dataIndex: 'status', render: (s: string) => <StatusTag domain="banquet" status={s} /> },
    {
      title: t('banquets.common.eventDate'),
      dataIndex: 'eventDate',
      render: (_: string, r) => (
        <Space direction="vertical" size={0}>
          <span>{formatEventDate(r.eventDate, r.eventTime)}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            <EventTypeLabel type={r.eventType} />
          </Typography.Text>
        </Space>
      ),
    },
    { title: t('banquets.common.guests'), dataIndex: 'guests', align: 'right' },
    {
      title: t('banquets.common.contact'),
      key: 'contact',
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <span>{r.contact.name}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {r.contact.phone}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('banquets.common.branch'),
      key: 'place',
      render: (_, r) => <PlaceTag isOffsite={r.isOffsite} branchName={r.branchName} offsiteAddress={r.offsiteAddress} />,
    },
    { title: t('banquets.common.manager'), dataIndex: 'managerName' },
    { title: t('banquets.common.budget'), dataIndex: 'budget', align: 'right', render: (v: BanquetRequestSummary['budget']) => <MoneyText value={v} /> },
    {
      title: t('banquets.common.quoteTotal'),
      dataIndex: 'quoteTotal',
      align: 'right',
      render: (v: BanquetRequestSummary['quoteTotal'], r) => (v ? <span>v{r.quoteVersion} · <MoneyText value={v} /></span> : '—'),
    },
    { title: t('banquets.common.createdAt'), dataIndex: 'createdAt', render: (v: string) => formatDateTime(v) },
  ];

  return (
    <PaginatedTable<BanquetRequestSummary>
      rowKey="id"
      columns={columns}
      data={data}
      loading={loading}
      page={page}
      perPage={perPage}
      onPageChange={onPageChange}
      rowClassName={(r) => (highlighted.has(r.id) ? 'aula-bq-row--fresh' : '')}
      onRow={(r) => ({ onDoubleClick: () => onOpen(r) })}
      locale={{ emptyText: t('banquets.pipeline.empty') }}
    />
  );
}
