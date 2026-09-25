/**
 * Список броней с фильтрами (даты, статусы, вид, источник, зал, место, поиск, «требуют отметки») и
 * серверной пагинацией. Даты — локальные даты филиала; «Все филиалы» — по филиалам с правом просмотра.
 */
import { Card, DatePicker, Flex, Input, Select, Space, Switch, Tag, Typography, type TableColumnsType } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { translate } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useBranch } from '@/shared/branch/BranchProvider';
import { dayjs } from '@/shared/lib/dates';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PaginatedTable } from '@/shared/ui/PaginatedTable';
import { StatusTag } from '@/shared/ui/StatusTag';
import { venueKeys, venueConfigApi } from '../venues/api';
import { reservationKeys, reservationsApi } from './api';
import { formatInTz, formatLocalDate, venueTitle } from './format';
import { useBranchTimezone, useReservationsUi } from './hooks';
import { DepositTag, HoldCountdownTag, KindTag } from './parts';
import { shiftDate, todayIn } from './timeline-layout';
import {
  RESERVATION_KINDS,
  RESERVATION_SOURCES,
  RESERVATION_STATUSES,
  type ReservationKind,
  type ReservationSource,
  type ReservationStatus,
  type ReservationSummary,
  type ReservationsListQuery,
} from './types';

interface Filters {
  dateFrom: string | null;
  dateTo: string | null;
  status: ReservationStatus[];
  kind: ReservationKind | null;
  source: ReservationSource | null;
  hallId: string | null;
  venueId: string | null;
  q: string;
  needsMark: boolean;
}

export function ReservationListView() {
  const { t, i18n } = useTranslation();
  const { selectedBranchId, branchName, getBranch } = useBranch();
  const tz = useBranchTimezone(selectedBranchId);
  const ui = useReservationsUi();
  const today = todayIn(tz);
  const [filters, setFilters] = useState<Filters>({
    dateFrom: today,
    dateTo: shiftDate(today, 7),
    status: [],
    kind: null,
    source: null,
    hallId: null,
    venueId: null,
    q: '',
    needsMark: false,
  });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState({ page: 1, perPage: 20 });

  const halls = useApiQuery(venueKeys.halls(selectedBranchId ?? ''), () => venueConfigApi.halls(selectedBranchId!), {
    enabled: Boolean(selectedBranchId),
    staleTime: 5 * 60_000,
  });
  const venues = useApiQuery(venueKeys.venues(selectedBranchId ?? ''), () => venueConfigApi.venues(selectedBranchId!), {
    enabled: Boolean(selectedBranchId),
    staleTime: 5 * 60_000,
  });

  const query: ReservationsListQuery = useMemo(
    () => ({
      branchId: selectedBranchId ?? undefined,
      dateFrom: filters.needsMark ? undefined : (filters.dateFrom ?? undefined),
      dateTo: filters.needsMark ? undefined : (filters.dateTo ?? undefined),
      status: filters.status,
      kind: filters.kind ?? undefined,
      source: filters.source ?? undefined,
      hallId: selectedBranchId ? (filters.hallId ?? undefined) : undefined,
      venueId: selectedBranchId ? (filters.venueId ?? undefined) : undefined,
      q: filters.q || undefined,
      needsMark: filters.needsMark || undefined,
      page: page.page,
      perPage: page.perPage,
    }),
    [filters, page, selectedBranchId],
  );
  const list = useApiQuery(reservationKeys.list(query), () => reservationsApi.list(query), { keepPrevious: true });

  const update = (patch: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage((p) => ({ ...p, page: 1 }));
  };

  const venueOptions = (venues.data ?? [])
    .filter((v) => !filters.hallId || v.hallId === filters.hallId)
    .map((v) => ({ value: v.id, label: venueTitle(v, i18n.language) }));

  const columns: TableColumnsType<ReservationSummary> = [
    {
      title: t('reservations.fields.number'),
      dataIndex: 'number',
      render: (_, r) => (
        <Space size={4} wrap>
          <Typography.Link onClick={() => ui.openReservation(r.id)}>{r.number}</Typography.Link>
          {ui.newIds.has(r.id) ? <Tag color="volcano">{t('reservations.newTag')}</Tag> : null}
        </Space>
      ),
    },
    {
      title: t('reservations.fields.when'),
      key: 'when',
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{formatLocalDate(r.date)}</Typography.Text>
          <Typography.Text type="secondary">
            {r.time}–{formatInTz(r.end, getBranch(r.branchId)?.timezone ?? tz, 'HH:mm')} ·{' '}
            {t('reservations.minutes', { count: r.durationMinutes })}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('reservations.fields.venue'),
      key: 'venue',
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <span>{venueTitle(r.venue, i18n.language)}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {translate(r.venue.hallName, i18n.language)}
            {!selectedBranchId ? ` · ${branchName(r.branchId)}` : ''}
          </Typography.Text>
        </Space>
      ),
    },
    { title: t('reservations.fields.guests'), dataIndex: 'guests', align: 'right' },
    {
      title: t('reservations.fields.customer'),
      key: 'customer',
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <span>{r.customer.name ?? '—'}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {r.customer.phone ?? ''}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('reservations.fields.status'),
      key: 'status',
      render: (_, r) => (
        <Space direction="vertical" size={4}>
          <Space size={4} wrap>
            <StatusTag domain="reservation" status={r.status} />
            <KindTag kind={r.kind} />
          </Space>
          {r.needsMark ? <Tag color="red">{t('reservations.needsMark')}</Tag> : null}
          {r.status === 'pending' || r.status === 'awaiting_deposit' ? <HoldCountdownTag holdExpiresAt={r.holdExpiresAt} /> : null}
        </Space>
      ),
    },
    { title: t('reservations.fields.deposit'), key: 'deposit', render: (_, r) => <DepositTag state={r.depositState} amount={r.deposit} /> },
    { title: t('reservations.fields.source'), dataIndex: 'source', render: (source: ReservationSource) => t(`reservations.sources.${source}`) },
  ];

  return (
    <Card styles={{ body: { padding: 16 } }}>
      <Flex gap={8} wrap style={{ marginBottom: 12 }}>
        <Input.Search
          allowClear
          placeholder={t('reservations.list.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={(value) => update({ q: value.trim() })}
          style={{ width: 240 }}
        />
        <DatePicker.RangePicker
          format="DD.MM.YYYY"
          disabled={filters.needsMark}
          value={filters.dateFrom && filters.dateTo ? [dayjs(filters.dateFrom), dayjs(filters.dateTo)] : null}
          onChange={(range) =>
            update({
              dateFrom: range?.[0] ? range[0].format('YYYY-MM-DD') : null,
              dateTo: range?.[1] ? range[1].format('YYYY-MM-DD') : null,
            })
          }
        />
        <Select<ReservationStatus[]>
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          placeholder={t('reservations.list.allStatuses')}
          value={filters.status}
          onChange={(status) => update({ status })}
          options={RESERVATION_STATUSES.map((s) => ({ value: s, label: t(`statuses.reservation.${s}`) }))}
          style={{ minWidth: 200 }}
        />
        <Select<ReservationKind | null>
          allowClear
          placeholder={t('reservations.list.allKinds')}
          value={filters.kind}
          onChange={(kind) => update({ kind: kind ?? null })}
          options={RESERVATION_KINDS.map((k) => ({ value: k, label: t(`reservations.kinds.${k}`) }))}
          style={{ width: 140 }}
        />
        <Select<ReservationSource | null>
          allowClear
          placeholder={t('reservations.list.allSources')}
          value={filters.source}
          onChange={(source) => update({ source: source ?? null })}
          options={RESERVATION_SOURCES.map((s) => ({ value: s, label: t(`reservations.sources.${s}`) }))}
          style={{ width: 150 }}
        />
        {selectedBranchId ? (
          <>
            <Select<string | null>
              allowClear
              placeholder={t('reservations.list.allHalls')}
              value={filters.hallId}
              onChange={(hallId) => update({ hallId: hallId ?? null, venueId: null })}
              options={(halls.data ?? []).map((h) => ({ value: h.id, label: translate(h.name, i18n.language) || h.code }))}
              style={{ width: 160 }}
            />
            <Select<string | null>
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('reservations.list.allVenues')}
              value={filters.venueId}
              onChange={(venueId) => update({ venueId: venueId ?? null })}
              options={venueOptions}
              style={{ width: 180 }}
            />
          </>
        ) : null}
        <Space>
          <Switch checked={filters.needsMark} onChange={(needsMark) => update({ needsMark })} />
          <span>{t('reservations.list.needsMark')}</span>
        </Space>
      </Flex>
      {list.error ? <ErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : null}
      <PaginatedTable<ReservationSummary>
        rowKey="id"
        data={list.data}
        loading={list.isFetching}
        page={page.page}
        perPage={page.perPage}
        onPageChange={(p, perPage) => setPage({ page: perPage === page.perPage ? p : 1, perPage })}
        columns={columns}
        rowClassName={(r) => (ui.newIds.has(r.id) ? 'rsv-row-new' : '')}
        onRow={(r) => ({ onDoubleClick: () => ui.openReservation(r.id) })}
        locale={{ emptyText: t('reservations.list.empty') }}
      />
    </Card>
  );
}
