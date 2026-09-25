import { DownloadOutlined, EditOutlined, PlusOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Empty, Flex, Space, Table, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Permission } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { useCan } from '@/shared/auth/useCan';
import { formatDateTime } from '@/shared/lib/dates';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { customerKeys, customersApi } from './api';
import { FilterSummary } from './CustomerTags';
import { ExportModal } from './ExportModal';
import { SaveSegmentModal } from './SaveSegmentModal';
import type { Segment } from './types';

/** Число гостей в сегменте — по запросу (GET /customer-segments/{id} считает на сервере). */
function SegmentCount({ segment }: { segment: Segment }) {
  const { t } = useTranslation();
  const notifyError = useNotifyError();
  const queryClient = useQueryClient();
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  if (count !== null) return <Typography.Text strong>{count}</Typography.Text>;
  return (
    <Button
      size="small"
      loading={loading}
      onClick={async (e) => {
        e.stopPropagation();
        setLoading(true);
        try {
          const detail = await queryClient.fetchQuery({ queryKey: customerKeys.segment(segment.id), queryFn: () => customersApi.segment(segment.id) });
          setCount(detail.customersCount);
        } catch (error) {
          notifyError(error);
        } finally {
          setLoading(false);
        }
      }}
    >
      {t('customers.segments.count')}
    </Button>
  );
}

/**
 * Сегменты гостей — сохранённые фильтры для выгрузок (просмотр — customers.view, правка — customers.manage,
 * выгрузка — customers.export). Новый сегмент создаётся из текущих фильтров списка гостей.
 */
export function SegmentsTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canSomewhere } = useCan();
  const canManage = canSomewhere(Permission.CustomersManage);
  const canExport = canSomewhere(Permission.CustomersExport);
  const segments = useApiQuery(customerKeys.segments, customersApi.segments);
  const [editing, setEditing] = useState<Segment | null>(null);
  const [exporting, setExporting] = useState<Segment | null>(null);

  return (
    <>
      {canManage ? (
        <Flex justify="flex-end" style={{ marginBottom: 16 }}>
          <Button icon={<PlusOutlined />} onClick={() => navigate('/customers')}>
            {t('customers.segments.create')}
          </Button>
        </Flex>
      ) : null}
      {segments.error ? <ErrorAlert error={segments.error} onRetry={() => void segments.refetch()} /> : null}
      <Table<Segment>
        rowKey="id"
        loading={segments.isLoading}
        dataSource={segments.data ?? []}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('customers.segments.empty')} /> }}
        columns={[
          {
            title: t('customers.segments.columns.name'),
            key: 'name',
            render: (_, s) => (
              <div style={{ maxWidth: 280 }}>
                <Typography.Link strong onClick={() => navigate(`/customers?segment=${s.id}`)}>
                  {s.name}
                </Typography.Link>
                {s.description ? (
                  <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }} ellipsis={{ rows: 2 }}>
                    {s.description}
                  </Typography.Paragraph>
                ) : null}
              </div>
            ),
          },
          {
            title: t('customers.segments.columns.filter'),
            key: 'filter',
            render: (_, s) => (
              <div style={{ maxWidth: 420 }}>
                <FilterSummary filter={s.filter} />
              </div>
            ),
          },
          { title: t('customers.segments.columns.count'), key: 'count', render: (_, s) => <SegmentCount segment={s} /> },
          { title: t('customers.segments.columns.updatedAt'), key: 'updatedAt', render: (_, s) => formatDateTime(s.updatedAt) },
          {
            title: t('common.actions'),
            key: 'actions',
            render: (_, s) => (
              <Space size={4} wrap>
                <Tooltip title={t('customers.segments.open')}>
                  <Button size="small" icon={<UnorderedListOutlined />} aria-label={t('customers.segments.open')} onClick={() => navigate(`/customers?segment=${s.id}`)} />
                </Tooltip>
                {canExport ? (
                  <Tooltip title={t('customers.segments.export')}>
                    <Button size="small" icon={<DownloadOutlined />} aria-label={t('customers.segments.export')} onClick={() => setExporting(s)} />
                  </Tooltip>
                ) : null}
                {canManage ? (
                  <>
                    <Tooltip title={t('common.edit')}>
                      <Button size="small" icon={<EditOutlined />} aria-label={t('common.edit')} onClick={() => setEditing(s)} />
                    </Tooltip>
                    <ConfirmAction
                      danger
                      title={t('customers.segments.deleteConfirm', { name: s.name })}
                      description={t('customers.segments.deleteHint')}
                      buttonProps={{ size: 'small' }}
                      successMessage={t('customers.segments.deleted')}
                      onConfirm={async () => {
                        await customersApi.deleteSegment(s.id);
                        await queryClient.invalidateQueries({ queryKey: customerKeys.segments });
                      }}
                    >
                      {t('common.delete')}
                    </ConfirmAction>
                  </>
                ) : null}
              </Space>
            ),
          },
        ]}
      />
      {editing ? <SaveSegmentModal editOnly currentSegment={editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} /> : null}
      {exporting ? (
        <ExportModal refinements={{}} segmentId={exporting.id} segmentName={exporting.name} effectiveFilter={exporting.filter} onClose={() => setExporting(null)} />
      ) : null}
    </>
  );
}
