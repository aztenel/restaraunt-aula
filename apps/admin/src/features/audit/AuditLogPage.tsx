import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AutoComplete, Button, Descriptions, Flex, Input, Select, Space, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Permission, type AuditRecord } from '@aula/api-client';
import { systemApi, usersApi, type AuditQuery } from '@/shared/api/endpoints';
import { queryKeys } from '@/shared/api/query-keys';
import { useCan } from '@/shared/auth/useCan';
import { useBranch } from '@/shared/branch/BranchProvider';
import { formatDateTimeSeconds } from '@/shared/lib/dates';
import { BranchSelect } from '@/shared/ui/BranchSelect';
import { DateRangeFilter, dateRangeToQuery, type DateRangeValue } from '@/shared/ui/DateRangeFilter';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { JsonBlock } from '@/shared/ui/JsonBlock';
import { JsonDiff } from '@/shared/ui/JsonDiff';
import { PageHeader } from '@/shared/ui/PageHeader';
import { PaginatedTable } from '@/shared/ui/PaginatedTable';

/** Типы объектов журнала (подсказки; список дополняется модулями). */
const ENTITY_TYPES = ['user', 'branch', 'legal_entity', 'integration', 'failed_job', 'order', 'reservation', 'banquet', 'quote', 'invoice', 'payment', 'certificate', 'dish', 'category', 'price', 'delivery_zone', 'promocode', 'venue', 'customer'];

const ACTOR_COLORS: Record<string, string> = { staff: 'blue', system: 'purple', guest: 'default' };

interface Filters {
  actorUserId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  branchId: string | null;
  range: DateRangeValue;
}

/** Журнал действий (право audit.view): кто, когда, что изменил; «было → стало». */
export function AuditLogPage() {
  const { t } = useTranslation();
  const { canSomewhere } = useCan();
  const { branchName } = useBranch();
  const canListUsers = canSomewhere(Permission.UsersManage);
  const [filters, setFilters] = useState<Filters>({ branchId: null, range: null });
  const [draft, setDraft] = useState<Filters>(filters);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [userSearch, setUserSearch] = useState('');

  const params: AuditQuery = useMemo(
    () => ({
      actorUserId: filters.actorUserId,
      action: filters.action?.trim() || undefined,
      entityType: filters.entityType?.trim() || undefined,
      entityId: filters.entityId?.trim() || undefined,
      branchId: filters.branchId ?? undefined,
      ...dateRangeToQuery(filters.range),
      page,
      perPage,
    }),
    [filters, page, perPage],
  );
  const log = useQuery({ queryKey: queryKeys.auditLog(params), queryFn: () => systemApi.auditLog(params), placeholderData: keepPreviousData });
  const users = useQuery({
    queryKey: queryKeys.users({ q: userSearch, perPage: 20 }),
    queryFn: () => usersApi.list({ q: userSearch || undefined, perPage: 20 }),
    enabled: canListUsers,
    staleTime: 60_000,
  });

  const apply = () => {
    setFilters(draft);
    setPage(1);
  };
  const reset = () => {
    const empty: Filters = { branchId: null, range: null };
    setDraft(empty);
    setFilters(empty);
    setPage(1);
  };

  return (
    <>
      <PageHeader title={t('nav.auditLog')} subtitle={t('sections.auditLog')} />
      <Flex gap={8} wrap style={{ marginBottom: 16 }}>
        {canListUsers ? (
          <Select
            allowClear
            showSearch
            filterOption={false}
            onSearch={setUserSearch}
            placeholder={t('audit.user')}
            style={{ width: 240 }}
            value={draft.actorUserId}
            onChange={(actorUserId) => setDraft({ ...draft, actorUserId })}
            loading={users.isFetching}
            options={(users.data?.items ?? []).map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` }))}
          />
        ) : (
          <Input allowClear placeholder={t('audit.userId')} style={{ width: 240 }} value={draft.actorUserId} onChange={(e) => setDraft({ ...draft, actorUserId: e.target.value || undefined })} />
        )}
        <Input allowClear placeholder={t('audit.actionPrefix')} style={{ width: 200 }} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} />
        <AutoComplete
          allowClear
          placeholder={t('audit.entityType')}
          style={{ width: 180 }}
          value={draft.entityType}
          onChange={(entityType) => setDraft({ ...draft, entityType })}
          options={ENTITY_TYPES.map((v) => ({ value: v }))}
          filterOption={(input, option) => String(option?.value ?? '').includes(input.toLowerCase())}
        />
        <Input allowClear placeholder={t('audit.entityId')} style={{ width: 240 }} value={draft.entityId} onChange={(e) => setDraft({ ...draft, entityId: e.target.value })} />
        <BranchSelect allowClear style={{ width: 200 }} value={draft.branchId} onChange={(branchId) => setDraft({ ...draft, branchId })} />
        <DateRangeFilter value={draft.range} onChange={(range) => setDraft({ ...draft, range })} />
        <Space>
          <Button type="primary" onClick={apply}>
            {t('common.apply')}
          </Button>
          <Button onClick={reset}>{t('common.reset')}</Button>
        </Space>
      </Flex>
      {log.error ? <ErrorAlert error={log.error} onRetry={() => void log.refetch()} /> : null}
      <PaginatedTable<AuditRecord>
        rowKey="id"
        size="small"
        data={log.data}
        loading={log.isLoading || log.isPlaceholderData}
        page={page}
        perPage={perPage}
        onPageChange={(p, pp) => {
          setPage(p);
          setPerPage(pp);
        }}
        expandable={{
          expandedRowRender: (record) => (
            <Space direction="vertical" style={{ width: '100%' }}>
              <JsonDiff before={record.before} after={record.after} />
              {record.meta && Object.keys(record.meta).length > 0 ? (
                <div>
                  <Typography.Text type="secondary">{t('audit.meta')}</Typography.Text>
                  <JsonBlock value={record.meta} maxHeight={200} />
                </div>
              ) : null}
              <Descriptions size="small" column={{ xs: 1, md: 3 }}>
                <Descriptions.Item label="ID">{record.id}</Descriptions.Item>
                <Descriptions.Item label="requestId">{record.requestId ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="IP">{record.ip ?? '—'}</Descriptions.Item>
              </Descriptions>
            </Space>
          ),
        }}
        columns={[
          { title: t('audit.time'), dataIndex: 'occurredAt', render: (v: string) => formatDateTimeSeconds(v), width: 170, fixed: 'left' },
          {
            title: t('audit.actor'),
            key: 'actor',
            render: (_, r) => (
              <Space size={4}>
                <Tag color={ACTOR_COLORS[r.actorKind] ?? 'default'}>{t(`audit.actorKinds.${r.actorKind === 'staff' || r.actorKind === 'system' ? r.actorKind : 'guest'}`)}</Tag>
                <span>{r.actorName}</span>
              </Space>
            ),
          },
          { title: t('audit.action'), dataIndex: 'action', render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
          {
            title: t('audit.entity'),
            key: 'entity',
            render: (_, r) => (
              <span>
                <Typography.Text>{r.entityType}</Typography.Text>{' '}
                <Typography.Text type="secondary" copyable={{ text: r.entityId }}>
                  {r.entityId.length > 12 ? `${r.entityId.slice(0, 8)}…` : r.entityId}
                </Typography.Text>
              </span>
            ),
          },
          { title: t('layout.branch'), dataIndex: 'branchId', render: (id: string | null) => (id ? branchName(id) : '—') },
        ]}
      />
    </>
  );
}
