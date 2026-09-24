import { ReloadOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Flex, Segmented, Space, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FailedJob } from '@aula/api-client';
import { systemApi } from '@/shared/api/endpoints';
import { queryKeys } from '@/shared/api/query-keys';
import { formatDateTime } from '@/shared/lib/dates';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { JsonBlock } from '@/shared/ui/JsonBlock';
import { PaginatedTable } from '@/shared/ui/PaginatedTable';
import { StatusTag } from '@/shared/ui/StatusTag';

function jobStatus(job: FailedJob): 'open' | 'retried' | 'resolved' {
  if (job.resolvedAt) return 'resolved';
  if (job.retriedAt) return 'retried';
  return 'open';
}

/** Очередь неудач: задачи, исчерпавшие повторы (внешние API, уведомления) — повтор или закрытие. */
export function FailedJobsTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(true);
  const [page, setPage] = useState(1);
  const params = { open, page };
  const jobs = useQuery({ queryKey: queryKeys.failedJobs(params), queryFn: () => systemApi.failedJobs(params), placeholderData: keepPreviousData });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['system', 'failed-jobs'] });

  return (
    <>
      <Flex justify="space-between" gap={8} wrap style={{ marginBottom: 12 }}>
        <Segmented
          value={open ? 'open' : 'all'}
          onChange={(v) => {
            setOpen(v === 'open');
            setPage(1);
          }}
          options={[
            { value: 'open', label: t('system.jobs.open') },
            { value: 'all', label: t('system.jobs.all') },
          ]}
        />
        <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
          {t('common.refresh')}
        </Button>
      </Flex>
      {jobs.error ? <ErrorAlert error={jobs.error} onRetry={() => void jobs.refetch()} /> : null}
      <PaginatedTable<FailedJob>
        rowKey="id"
        size="small"
        data={jobs.data}
        loading={jobs.isFetching}
        page={page}
        perPage={jobs.data?.perPage ?? 50}
        pageSizeOptions={[50]}
        onPageChange={(p) => setPage(p)}
        expandable={{
          expandedRowRender: (job) => (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Typography.Text type="secondary">{t('system.jobs.error')}</Typography.Text>
              <JsonBlock value={job.error} maxHeight={200} />
              <Typography.Text type="secondary">{t('system.jobs.payload')}</Typography.Text>
              <JsonBlock value={job.payload} />
            </Space>
          ),
        }}
        columns={[
          { title: t('system.jobs.failedAt'), dataIndex: 'failedAt', render: (v: string) => formatDateTime(v), width: 150 },
          { title: t('system.jobs.topic'), key: 'topic', render: (_, j) => (<div><Typography.Text code>{j.topic}</Typography.Text><br /><Typography.Text type="secondary">{j.kind}{j.handler ? ` · ${j.handler}` : ''}</Typography.Text></div>) },
          { title: t('system.jobs.attempts'), dataIndex: 'attempts', width: 90 },
          { title: t('system.jobs.error'), dataIndex: 'error', render: (v: string) => <Typography.Text type="danger" ellipsis={{ tooltip: v }} style={{ maxWidth: 360 }}>{v}</Typography.Text> },
          { title: t('users.status'), key: 'status', render: (_, j) => <StatusTag domain="job" status={jobStatus(j)} /> },
          {
            title: t('common.actions'),
            key: 'actions',
            render: (_, j) =>
              j.resolvedAt ? null : (
                <Space size={4}>
                  <ConfirmAction title={t('system.jobs.retryConfirm')} buttonProps={{ size: 'small' }} successMessage={t('system.jobs.retried')} onConfirm={async () => { await systemApi.retryJob(j.id); await refresh(); }}>
                    {t('system.jobs.retry')}
                  </ConfirmAction>
                  <ConfirmAction title={t('system.jobs.resolveConfirm')} buttonProps={{ size: 'small' }} successMessage={t('system.jobs.resolved')} onConfirm={async () => { await systemApi.resolveJob(j.id); await refresh(); }}>
                    {t('system.jobs.resolve')}
                  </ConfirmAction>
                </Space>
              ),
          },
        ]}
      />
    </>
  );
}
