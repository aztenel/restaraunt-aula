import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Col, Flex, Input, Row, Select, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IntegrationLogRecord } from '@aula/api-client';
import { systemApi, type IntegrationLogsQuery } from '@/shared/api/endpoints';
import { queryKeys } from '@/shared/api/query-keys';
import { formatDateTimeSeconds } from '@/shared/lib/dates';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { JsonBlock } from '@/shared/ui/JsonBlock';
import { PaginatedTable } from '@/shared/ui/PaginatedTable';

/** Журнал обменов с внешними системами (запросы/ответы с маскированием платёжных данных). */
export function IntegrationLogsTab() {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<IntegrationLogsQuery>({});
  const [filters, setFilters] = useState<IntegrationLogsQuery>({});
  const [page, setPage] = useState(1);
  const params = { ...filters, page };
  const logs = useQuery({ queryKey: queryKeys.integrationLogs(params), queryFn: () => systemApi.integrationLogs(params), placeholderData: keepPreviousData });

  return (
    <>
      <Flex gap={8} wrap style={{ marginBottom: 12 }}>
        <Input allowClear placeholder={t('system.logs.integration')} style={{ width: 200 }} value={draft.integration} onChange={(e) => setDraft({ ...draft, integration: e.target.value || undefined })} />
        <Input allowClear placeholder={t('system.logs.correlationId')} style={{ width: 240 }} value={draft.correlationId} onChange={(e) => setDraft({ ...draft, correlationId: e.target.value || undefined })} />
        <Select
          allowClear
          placeholder={t('system.logs.result')}
          style={{ width: 160 }}
          value={draft.success}
          onChange={(success) => setDraft({ ...draft, success })}
          options={[
            { value: 'true', label: t('system.logs.success') },
            { value: 'false', label: t('system.logs.failure') },
          ]}
        />
        <Space>
          <Button type="primary" onClick={() => { setFilters(draft); setPage(1); }}>
            {t('common.apply')}
          </Button>
          <Button onClick={() => { setDraft({}); setFilters({}); setPage(1); }}>{t('common.reset')}</Button>
        </Space>
      </Flex>
      {logs.error ? <ErrorAlert error={logs.error} onRetry={() => void logs.refetch()} /> : null}
      <PaginatedTable<IntegrationLogRecord>
        rowKey="id"
        size="small"
        data={logs.data}
        loading={logs.isLoading || logs.isPlaceholderData}
        page={page}
        perPage={logs.data?.perPage ?? 50}
        pageSizeOptions={[50]}
        onPageChange={(p) => setPage(p)}
        expandable={{
          expandedRowRender: (r) => (
            <Row gutter={12}>
              <Col xs={24} lg={12}>
                <Typography.Text type="secondary">{t('system.logs.request')}</Typography.Text>
                <JsonBlock value={r.request} />
              </Col>
              <Col xs={24} lg={12}>
                <Typography.Text type="secondary">{t('system.logs.response')}</Typography.Text>
                <JsonBlock value={r.response} />
              </Col>
            </Row>
          ),
        }}
        columns={[
          { title: t('audit.time'), dataIndex: 'occurred_at', render: (v: string) => formatDateTimeSeconds(v), width: 170, fixed: 'left' },
          { title: t('system.logs.integration'), dataIndex: 'integration', render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
          { title: t('system.logs.direction'), dataIndex: 'direction', render: (v: string) => <Tag>{t(`system.logs.directions.${v === 'inbound' ? 'inbound' : 'outbound'}`)}</Tag> },
          { title: t('system.logs.operation'), dataIndex: 'operation' },
          { title: 'HTTP', dataIndex: 'status_code', render: (v: number | null) => v ?? '—' },
          { title: t('system.logs.result'), dataIndex: 'success', render: (v: boolean) => <Tag color={v ? 'success' : 'error'}>{v ? t('system.logs.success') : t('system.logs.failure')}</Tag> },
          { title: t('system.logs.duration'), dataIndex: 'duration_ms', render: (v: number | null) => (v === null ? '—' : `${v} ms`) },
          { title: t('system.jobs.error'), dataIndex: 'error', render: (v: string | null) => (v ? <Typography.Text type="danger" ellipsis={{ tooltip: v }} style={{ maxWidth: 280 }}>{v}</Typography.Text> : null) },
        ]}
      />
    </>
  );
}
