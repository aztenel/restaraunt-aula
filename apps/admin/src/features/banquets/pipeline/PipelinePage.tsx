import { AppstoreOutlined, PlusOutlined, ReloadOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { Alert, Badge, Button, Checkbox, DatePicker, Flex, Input, Segmented, Select, Space } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useApiQuery } from '@/shared/api/hooks';
import { useBranch } from '@/shared/branch/BranchProvider';
import { useAdminFeed } from '@/shared/feed/FeedProvider';
import { dayjs } from '@/shared/lib/dates';
import { useStoredState } from '@/shared/lib/storage';
import { BranchSelect } from '@/shared/ui/BranchSelect';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { useSectionAbilities } from '../abilities';
import { banquetsApi, banquetsKeys } from '../api';
import { ManagerSelect } from '../common/ManagerSelect';
import { useNow } from '../common/ui';
import { RequestFormDrawer } from '../request/RequestFormDrawer';
import { BANQUET_STATUSES, type BanquetRequestSummary, type BanquetStatus } from '../types';
import { PipelineBoard } from './PipelineBoard';
import { activeFilterCount, EMPTY_FILTERS, toListQuery, toPipelineQuery, type PipelineFilters, type PlaceFilter } from './pipeline-utils';
import { RequestsTable } from './RequestsTable';
import { useNewRequestHighlights } from './useNewRequestHighlights';

type ViewMode = 'board' | 'list';

/** Воронка банкетных заявок: доска по статусам или список, фильтры, новые заявки из ленты (звук и подсветка). */
export function PipelinePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { selectedBranchId, canSelectAll } = useBranch();
  const { items: feedItems, status: feedStatus, unread, markRead } = useAdminFeed();
  const abilities = useSectionAbilities();
  const [view, setView] = useStoredState<ViewMode>('aula_admin_banquets_view', 'board');
  const [filters, setFilters] = useState<PipelineFilters>({ ...EMPTY_FILTERS, branchId: selectedBranchId });
  const [search, setSearch] = useState('');
  const [statuses, setStatuses] = useState<BanquetStatus[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [creating, setCreating] = useState(false);

  // Филиал в шапке сменили — фильтр филиала следует за ним.
  useEffect(() => {
    setFilters((f) => ({ ...f, branchId: selectedBranchId }));
    setPage(1);
  }, [selectedBranchId]);

  const update = (patch: Partial<PipelineFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const pipelineParams = toPipelineQuery(filters);
  const board = useApiQuery(banquetsKeys.pipeline(pipelineParams), () => banquetsApi.pipeline(pipelineParams), {
    enabled: view === 'board',
    refetchInterval: 60_000,
    keepPrevious: true,
  });
  const listParams = toListQuery(filters, { status: statuses, page, perPage });
  const list = useApiQuery(banquetsKeys.list(listParams), () => banquetsApi.list(listParams), {
    enabled: view === 'list',
    refetchInterval: 60_000,
    keepPrevious: true,
  });

  const needsTicking = useMemo(() => {
    if (view === 'board') return (board.data ?? []).some((c) => c.status === 'new' && c.items.length > 0);
    return (list.data?.items ?? []).some((r) => r.status === 'new');
  }, [view, board.data, list.data]);
  const now = useNow(1000, needsTicking);

  const { highlighted, acknowledge } = useNewRequestHighlights(view === 'board' ? board.data : undefined, feedItems, {
    soundOnPoll: feedStatus !== 'open',
  });

  // Заявки видны на экране — счётчик непрочитанного в меню сбрасывается.
  useEffect(() => {
    if (unread.banquets > 0) markRead('banquets');
  }, [unread.banquets, markRead]);

  const open = (request: BanquetRequestSummary) => {
    acknowledge(request.id);
    navigate(`/banquets/${request.id}`);
  };

  const defaults = { ...EMPTY_FILTERS, branchId: selectedBranchId };
  const filterCount = activeFilterCount(filters, defaults) + (view === 'list' && statuses.length > 0 ? 1 : 0);
  const error = view === 'board' ? board.error : list.error;

  return (
    <>
      <Flex justify="space-between" align="center" gap={8} wrap style={{ marginBottom: 12 }}>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder={t('banquets.pipeline.filters.search')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!e.target.value) update({ q: '' });
            }}
            onSearch={(value) => update({ q: value })}
            style={{ width: 240 }}
          />
          <BranchSelect
            allowAll={canSelectAll}
            value={filters.branchId}
            onChange={(branchId) => update({ branchId })}
            style={{ width: 200 }}
            aria-label={t('banquets.pipeline.filters.branch')}
          />
          <ManagerSelect
            allowClear
            showLoad={false}
            value={filters.managerId}
            onChange={(managerId) => update({ managerId })}
            style={{ width: 200 }}
            aria-label={t('banquets.pipeline.filters.manager')}
          />
          <DatePicker.RangePicker
            format="DD.MM.YYYY"
            placeholder={[t('dateRange.from'), t('dateRange.to')]}
            value={filters.dateFrom && filters.dateTo ? [dayjs(filters.dateFrom), dayjs(filters.dateTo)] : null}
            onChange={(range) =>
              update({
                dateFrom: range?.[0] ? range[0].format('YYYY-MM-DD') : null,
                dateTo: range?.[1] ? range[1].format('YYYY-MM-DD') : null,
              })
            }
            aria-label={t('banquets.pipeline.filters.eventDates')}
          />
          <Select<PlaceFilter>
            value={filters.place}
            onChange={(place) => update({ place })}
            options={(['all', 'branch', 'offsite'] as const).map((place) => ({ value: place, label: t(`banquets.pipeline.filters.places.${place}`) }))}
            style={{ width: 170 }}
            aria-label={t('banquets.pipeline.filters.place')}
          />
          {view === 'list' ? (
            <Select<BanquetStatus[]>
              mode="multiple"
              allowClear
              maxTagCount="responsive"
              placeholder={t('banquets.pipeline.filters.status')}
              value={statuses}
              onChange={(next) => {
                setStatuses(next);
                setPage(1);
              }}
              options={BANQUET_STATUSES.map((s) => ({ value: s, label: t(`statuses.banquet.${s}`) }))}
              style={{ minWidth: 200 }}
            />
          ) : null}
          <Checkbox checked={filters.slaBreached} onChange={(e) => update({ slaBreached: e.target.checked })}>
            {t('banquets.pipeline.filters.slaBreached')}
          </Checkbox>
          {filterCount > 0 ? (
            <Badge count={filterCount} size="small">
              <Button
                onClick={() => {
                  setFilters(defaults);
                  setSearch('');
                  setStatuses([]);
                  setPage(1);
                }}
              >
                {t('banquets.pipeline.filters.reset')}
              </Button>
            </Badge>
          ) : null}
        </Space>
        <Space wrap>
          <Segmented<ViewMode>
            value={view}
            onChange={setView}
            options={[
              { value: 'board', label: t('banquets.pipeline.board'), icon: <AppstoreOutlined /> },
              { value: 'list', label: t('banquets.pipeline.list'), icon: <UnorderedListOutlined /> },
            ]}
          />
          <Button
            icon={<ReloadOutlined />}
            loading={view === 'board' ? board.isFetching : list.isFetching}
            onClick={() => void (view === 'board' ? board.refetch() : list.refetch())}
            aria-label={t('common.refresh')}
          />
          {abilities.create ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              {t('banquets.pipeline.newRequest')}
            </Button>
          ) : null}
        </Space>
      </Flex>
      {feedStatus === 'unavailable' ? <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('banquets.pipeline.feedOff')} /> : null}
      {error ? <ErrorAlert error={error} onRetry={() => void (view === 'board' ? board.refetch() : list.refetch())} /> : null}
      {view === 'board' ? (
        <PipelineBoard columns={board.data ?? []} now={now} highlighted={highlighted} onOpen={open} />
      ) : (
        <RequestsTable
          data={list.data}
          loading={list.isFetching}
          page={page}
          perPage={perPage}
          now={now}
          highlighted={new Set(feedItems.filter((i) => i.stream === 'banquets' && i.kind === 'created').map((i) => i.entityId))}
          onPageChange={(p, size) => {
            setPage(p);
            setPerPage(size);
          }}
          onOpen={open}
        />
      )}
      <RequestFormDrawer
        open={creating}
        request={null}
        onClose={() => setCreating(false)}
        onSaved={(detail) => {
          setCreating(false);
          navigate(`/banquets/${detail.id}`);
        }}
      />
    </>
  );
}
