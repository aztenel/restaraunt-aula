/**
 * Передачи заказов в POS: очередь неудач (по умолчанию — не переданные), причины, блюда без сопоставления,
 * ручной повтор (только когда сервер разрешает — canRetry).
 */
import { ReloadOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Flex, Input, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { useBranch } from '@/shared/branch/BranchProvider';
import { tx } from '@/shared/i18n/tx';
import { formatDateTime } from '@/shared/lib/dates';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { ORDER_EXPORT_STATUSES, posApi, posKeys, type OrderExport, type OrderExportStatus } from './api';
import { usePosAbilities } from './abilities';

const STATUS_COLORS: Record<OrderExportStatus, string> = { pending: 'processing', sent: 'success', failed: 'error', skipped: 'default' };
const UUID_RE = /^[0-9a-f-]{36}$/i;

export function PosExportsTab() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const abilities = usePosAbilities();
  const { selectedBranchId, branchName } = useBranch();
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get('status');
  const status: OrderExportStatus | undefined = (ORDER_EXPORT_STATUSES as readonly string[]).includes(rawStatus ?? '')
    ? (rawStatus as OrderExportStatus)
    : rawStatus === 'all'
      ? undefined
      : 'failed';
  const [orderId, setOrderId] = useState('');
  const [page, setPage] = useState({ page: 1, perPage: 20 });
  const [retrying, setRetrying] = useState<string | null>(null);
  const query = {
    branchId: selectedBranchId ?? undefined,
    status,
    orderId: UUID_RE.test(orderId.trim()) ? orderId.trim() : undefined,
    ...page,
  };
  const list = useApiQuery(posKeys.exports(query), () => posApi.exports(query), { keepPrevious: true, refetchInterval: 30_000 });

  const setStatus = (value: OrderExportStatus | 'all') => {
    setParams(
      (prev) => {
        const copy = new URLSearchParams(prev);
        copy.set('status', value);
        return copy;
      },
      { replace: true },
    );
    setPage((p) => ({ ...p, page: 1 }));
  };

  const retry = async (row: OrderExport) => {
    setRetrying(row.id);
    try {
      await posApi.retryExport(row.id);
      void message.success(t('pos.exports.retried', { number: row.orderNumber }));
      void queryClient.invalidateQueries({ queryKey: posKeys.all });
    } catch (error) {
      notifyError(error);
    } finally {
      setRetrying(null);
    }
  };

  return (
    <Card>
      <Flex gap={8} wrap style={{ marginBottom: 12 }} justify="space-between">
        <Space wrap>
          <Select<OrderExportStatus | 'all'>
            value={status ?? 'all'}
            onChange={setStatus}
            style={{ width: 200 }}
            options={[
              { value: 'all', label: t('pos.exports.allStatuses') },
              ...ORDER_EXPORT_STATUSES.map((s) => ({ value: s, label: t(`pos.exports.statuses.${s}`) })),
            ]}
          />
          <Input.Search allowClear placeholder={t('pos.exports.orderIdPlaceholder')} onSearch={setOrderId} style={{ width: 320 }} />
        </Space>
        <Button icon={<ReloadOutlined />} onClick={() => void list.refetch()} aria-label={t('common.refresh')} />
      </Flex>
      {list.error ? <ErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : null}
      <Table<OrderExport>
        rowKey="id"
        size="small"
        loading={list.isFetching}
        dataSource={list.data?.items ?? []}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('pos.exports.empty') }}
        pagination={{
          current: page.page,
          pageSize: page.perPage,
          total: list.data?.total ?? 0,
          showSizeChanger: true,
          onChange: (p, perPage) => setPage({ page: perPage === page.perPage ? p : 1, perPage }),
        }}
        expandable={{
          rowExpandable: (r) => r.missingMappings.length > 0 || Boolean(r.lastError),
          expandedRowRender: (r) => (
            <Space direction="vertical" size={4}>
              {r.lastError ? <Typography.Text type="danger">{r.lastError}</Typography.Text> : null}
              {r.missingMappings.length > 0 ? (
                <>
                  <Typography.Text strong>{t('pos.exports.missingMappings')}</Typography.Text>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {r.missingMappings.map((m) => (
                      <li key={m.dishId}>
                        {m.dishName}
                        {m.dishMissing ? ` — ${t('pos.exports.dishMissing')}` : ''}
                        {m.options.length > 0 ? ` — ${t('pos.exports.optionsMissing', { names: m.options.map((o) => o.name).join(', ') })}` : ''}
                      </li>
                    ))}
                  </ul>
                  {abilities.canConfigure(r.branchId) ? <Link to="/pos/mappings">{t('pos.exports.openMappings')}</Link> : null}
                </>
              ) : null}
            </Space>
          ),
        }}
        columns={[
          { title: t('pos.exports.order'), key: 'order', render: (_, r) => <Link to={`/orders/${r.orderId}`}>{r.orderNumber}</Link> },
          ...(selectedBranchId ? [] : [{ title: t('pos.fields.branch'), key: 'branch', render: (_: unknown, r: OrderExport) => branchName(r.branchId) }]),
          { title: t('pos.fields.provider'), dataIndex: 'provider' },
          {
            title: t('pos.exports.status'),
            key: 'status',
            render: (_, r) => (
              <Space size={4} wrap>
                <Tag color={STATUS_COLORS[r.status]}>{t(`pos.exports.statuses.${r.status}`)}</Tag>
                {r.status === 'sent' && !r.confirmedAt ? (
                  <Tooltip title={t('pos.exports.awaitingConfirmationHint')}>
                    <Tag>{t('pos.exports.awaitingConfirmation')}</Tag>
                  </Tooltip>
                ) : null}
              </Space>
            ),
          },
          {
            title: t('pos.exports.reason'),
            key: 'reason',
            render: (_, r) =>
              r.failureReason ? (
                <Tag color="volcano">{tx(t, `pos.exports.failureReasons.${r.failureReason}`, r.failureReason)}</Tag>
              ) : r.skipReason ? (
                <Tag>{tx(t, `pos.exports.skipReasons.${r.skipReason}`, r.skipReason)}</Tag>
              ) : null,
          },
          { title: t('pos.exports.posOrderId'), key: 'posOrderId', render: (_, r) => r.posOrderId ?? '—' },
          { title: t('pos.exports.attempts'), key: 'attempts', align: 'right', render: (_, r) => `${r.attempts}${r.manualRetries > 0 ? ` (+${r.manualRetries})` : ''}` },
          { title: t('pos.exports.lastAttemptAt'), key: 'lastAttemptAt', render: (_, r) => formatDateTime(r.lastAttemptAt) },
          { title: t('pos.exports.createdAt'), key: 'createdAt', render: (_, r) => formatDateTime(r.createdAt) },
          {
            key: 'actions',
            render: (_, r) =>
              r.canRetry && abilities.canOperate(r.branchId) ? (
                <Button size="small" loading={retrying === r.id} onClick={() => void retry(r)}>
                  {t('pos.exports.retry')}
                </Button>
              ) : null,
          },
        ]}
      />
    </Card>
  );
}
