import { CheckCircleTwoTone, DownloadOutlined, FilterOutlined, MinusCircleTwoTone, SaveOutlined } from '@ant-design/icons';
import { Alert, Badge, Button, Card, Col, DatePicker, Flex, Input, Row, Select, Space, Switch, Tag, Tooltip, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { Permission } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useCan } from '@/shared/auth/useCan';
import { dayjs, formatDate, formatDateTime } from '@/shared/lib/dates';
import { BranchSelect } from '@/shared/ui/BranchSelect';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { MoneyText } from '@/shared/ui/MoneyText';
import { PaginatedTable } from '@/shared/ui/PaginatedTable';
import { customerKeys, customersApi } from './api';
import {
  activeFilterCount,
  mergeSegmentFilter,
  parseListState,
  patchListState,
  serializeListState,
  toFilterDto,
  toListQuery,
  validateListState,
  DEFAULT_CUSTOMER_LIST,
  type CustomerListState,
} from './customer-filter';
import { CustomerTags, tagLabel } from './CustomerTags';
import { ExportModal } from './ExportModal';
import { SaveSegmentModal } from './SaveSegmentModal';
import { CUSTOMER_SORTS, type Customer, type CustomerSort } from './types';

type TriState = 'any' | 'yes' | 'no';

function toTri(value: boolean | null): TriState {
  return value === null ? 'any' : value ? 'yes' : 'no';
}

function fromTri(value: TriState): boolean | null {
  return value === 'any' ? null : value === 'yes';
}

function ConsentIcon({ granted, label }: { granted: boolean; label: string }) {
  return (
    <Tooltip title={label}>
      <Space size={4}>
        {granted ? <CheckCircleTwoTone twoToneColor="#52c41a" /> : <MinusCircleTwoTone twoToneColor="#bfbfbf" />}
        <Typography.Text type={granted ? undefined : 'secondary'} style={{ fontSize: 12 }}>
          {label}
        </Typography.Text>
      </Space>
    </Tooltip>
  );
}

/**
 * Список гостей (customers.view): поиск по телефону/имени/email, теги, сумма покупок, последняя
 * активность, филиал, банкеты, согласие на рассылки, сегмент. Условия — в адресной строке.
 * Сохранить выборку как сегмент — customers.manage, выгрузка — customers.export.
 */
export function CustomersListTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canSomewhere } = useCan();
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseListState(params), [params]);
  const [search, setSearch] = useState(state.q);
  const [spentDraft, setSpentDraft] = useState<{ min: number | null; max: number | null }>({ min: state.spentMin, max: state.spentMax });
  const [showFilters, setShowFilters] = useState(() => activeFilterCount(state) > 0);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const canManage = canSomewhere(Permission.CustomersManage);
  const canExport = canSomewhere(Permission.CustomersExport);

  // Адрес изменили извне (назад/вперёд, ссылка из сегментов) — синхронизировать черновики полей.
  useEffect(() => {
    setSearch(state.q);
    setSpentDraft({ min: state.spentMin, max: state.spentMax });
  }, [state.q, state.spentMin, state.spentMax]);

  const issues = validateListState(state);
  const valid = Object.keys(issues).length === 0;
  const query = useMemo(() => toListQuery(state), [state]);
  const list = useApiQuery(customerKeys.list(query), () => customersApi.list(query), { keepPrevious: true, enabled: valid });
  const tags = useApiQuery(customerKeys.tags, customersApi.tags, { staleTime: 60_000 });
  const segments = useApiQuery(customerKeys.segments, customersApi.segments, { staleTime: 60_000 });
  const segment = useApiQuery(customerKeys.segment(state.segmentId ?? ''), () => customersApi.segment(state.segmentId ?? ''), {
    enabled: Boolean(state.segmentId),
  });

  const update = (patch: Partial<CustomerListState>) => setParams(serializeListState(patchListState(state, patch)));
  const open = (id: string) => {
    const search = params.toString();
    navigate(`/customers/${id}`, { state: { from: search ? `/customers?${search}` : '/customers' } });
  };
  const refinements = toFilterDto(state);
  const segmentFilter = state.segmentId && segment.data ? segment.data.filter : null;
  const effectiveFilter = segmentFilter ? mergeSegmentFilter(segmentFilter, refinements) : refinements;
  const segmentName = state.segmentId ? (segments.data?.find((s) => s.id === state.segmentId)?.name ?? segment.data?.name ?? null) : null;
  const filtersCount = activeFilterCount(state);

  const tagOptions = (tags.data ?? []).map((stat) => ({ value: stat.tag, label: `${tagLabel(t, stat.tag)} (${stat.count})` }));
  const commitSpent = () => {
    if (spentDraft.min !== state.spentMin || spentDraft.max !== state.spentMax) update({ spentMin: spentDraft.min, spentMax: spentDraft.max });
  };

  return (
    <>
      <Flex gap={8} wrap justify="space-between" style={{ marginBottom: 12 }}>
        <Flex gap={8} wrap>
          <Input.Search
            allowClear
            placeholder={t('customers.filters.search')}
            style={{ width: 260 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={(value) => update({ q: value.trim() })}
          />
          <Select<string[]>
            mode="tags"
            allowClear
            maxTagCount="responsive"
            placeholder={t('customers.filters.tags')}
            style={{ minWidth: 200, maxWidth: 360 }}
            value={state.tags}
            onChange={(value) => update({ tags: value.map((tag) => tag.trim().toLowerCase()).filter(Boolean) })}
            options={tagOptions}
          />
          <Select<string>
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={t('customers.filters.segment')}
            style={{ width: 220 }}
            loading={segments.isLoading}
            value={state.segmentId ?? undefined}
            onChange={(value) => update({ segmentId: value ?? null })}
            options={(segments.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
          <Badge count={filtersCount} size="small">
            <Button icon={<FilterOutlined />} type={showFilters ? 'primary' : 'default'} ghost={showFilters} onClick={() => setShowFilters((v) => !v)}>
              {t('customers.filters.more')}
            </Button>
          </Badge>
          <Button
            onClick={() => {
              setParams(serializeListState({ ...DEFAULT_CUSTOMER_LIST, perPage: state.perPage, sort: state.sort, order: state.order }));
              setSearch('');
            }}
          >
            {t('common.reset')}
          </Button>
        </Flex>
        <Flex gap={8} wrap>
          {canManage ? (
            <Button icon={<SaveOutlined />} disabled={Boolean(state.segmentId) && !segment.data} onClick={() => setSaving(true)}>
              {t('customers.actions.saveSegment')}
            </Button>
          ) : null}
          {canExport ? (
            <Button icon={<DownloadOutlined />} disabled={!valid || (Boolean(state.segmentId) && !segment.data)} onClick={() => setExporting(true)}>
              {t('customers.actions.export')}
            </Button>
          ) : null}
        </Flex>
      </Flex>

      {showFilters ? (
        <Card size="small" style={{ marginBottom: 12 }}>
          <Row gutter={[12, 12]}>
            <Col xs={24} md={12} xl={8}>
              <Typography.Text type="secondary">{t('customers.filters.spent')}</Typography.Text>
              <Flex gap={8} align="center">
                <MoneyInput
                  placeholder={t('customers.filters.spentFrom')}
                  value={spentDraft.min}
                  onChange={(min) => setSpentDraft((d) => ({ ...d, min }))}
                  onBlur={commitSpent}
                  onPressEnter={commitSpent}
                  status={issues.spent ? 'error' : undefined}
                />
                <MoneyInput
                  placeholder={t('customers.filters.spentTo')}
                  value={spentDraft.max}
                  onChange={(max) => setSpentDraft((d) => ({ ...d, max }))}
                  onBlur={commitSpent}
                  onPressEnter={commitSpent}
                  status={issues.spent ? 'error' : undefined}
                />
              </Flex>
            </Col>
            <Col xs={24} md={12} xl={8}>
              <Typography.Text type="secondary">{t('customers.filters.activity')}</Typography.Text>
              <DatePicker.RangePicker
                style={{ width: '100%' }}
                format="DD.MM.YYYY"
                allowEmpty={[true, true]}
                status={issues.activity ? 'error' : undefined}
                value={[state.lastActivityFrom ? dayjs(state.lastActivityFrom) : null, state.lastActivityTo ? dayjs(state.lastActivityTo) : null]}
                onChange={(range) =>
                  update({
                    lastActivityFrom: range?.[0] ? range[0].format('YYYY-MM-DD') : null,
                    lastActivityTo: range?.[1] ? range[1].format('YYYY-MM-DD') : null,
                  })
                }
              />
            </Col>
            <Col xs={24} md={12} xl={8}>
              <Typography.Text type="secondary">{t('customers.filters.branch')}</Typography.Text>
              <BranchSelect allowClear style={{ width: '100%' }} value={state.branchId} onChange={(branchId) => update({ branchId })} />
            </Col>
            <Col xs={24} md={12} xl={8}>
              <Select<TriState>
                style={{ width: '100%' }}
                value={toTri(state.hasBanquet)}
                onChange={(value) => update({ hasBanquet: fromTri(value) })}
                options={(['any', 'yes', 'no'] as const).map((value) => ({ value, label: t(`customers.filters.banquet.${value}`) }))}
              />
            </Col>
            <Col xs={24} md={12} xl={8}>
              <Select<TriState>
                style={{ width: '100%' }}
                value={toTri(state.marketingConsent)}
                onChange={(value) => update({ marketingConsent: fromTri(value) })}
                options={(['any', 'yes', 'no'] as const).map((value) => ({ value, label: t(`customers.filters.marketing.${value}`) }))}
              />
            </Col>
            <Col xs={24} md={12} xl={8}>
              <Flex gap={8} align="center" style={{ height: '100%' }}>
                <Switch checked={state.includeAnonymized} onChange={(includeAnonymized) => update({ includeAnonymized })} />
                <Typography.Text>{t('customers.filters.anonymized')}</Typography.Text>
              </Flex>
            </Col>
          </Row>
        </Card>
      ) : null}

      {state.segmentId ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            <Space wrap>
              <Typography.Text strong>{segmentName ?? '…'}</Typography.Text>
              {segment.data ? <Tag>{t('customers.filters.segmentCount', { count: segment.data.customersCount })}</Tag> : null}
              {filtersCount > 0 || state.q ? <Typography.Text type="secondary">{t('customers.filters.segmentRefined')}</Typography.Text> : null}
            </Space>
          }
        />
      ) : null}
      {segment.error ? <ErrorAlert error={segment.error} /> : null}
      {!valid ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={Object.values(issues)
            .map((issue) => t(`customers.filters.issues.${issue}`))
            .join('; ')}
        />
      ) : null}
      {list.error ? <ErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : null}

      <Flex gap={8} wrap justify="flex-end" style={{ marginBottom: 8 }}>
        <Select<CustomerSort>
          size="small"
          style={{ width: 230 }}
          value={state.sort}
          onChange={(sort) => update({ sort })}
          options={CUSTOMER_SORTS.map((value) => ({ value, label: t(`customers.filters.sort.${value}`) }))}
        />
        <Select<'asc' | 'desc'>
          size="small"
          style={{ width: 160 }}
          value={state.order}
          onChange={(order) => update({ order })}
          options={(['desc', 'asc'] as const).map((value) => ({ value, label: t(`customers.filters.order.${value}`) }))}
        />
      </Flex>

      <PaginatedTable<Customer>
        rowKey="id"
        data={valid ? list.data : undefined}
        loading={list.isLoading || list.isPlaceholderData}
        page={state.page}
        perPage={state.perPage}
        onPageChange={(page, perPage) => update({ page, perPage })}
        onRow={(customer) => ({
          onClick: () => open(customer.id),
          style: { cursor: 'pointer', opacity: customer.anonymizedAt ? 0.6 : 1 },
        })}
        columns={[
          {
            title: t('customers.columns.customer'),
            key: 'customer',
            render: (_, c) => (
              <div>
                {c.anonymizedAt ? (
                  <Tag>{t('customers.list.anonymized')}</Tag>
                ) : (
                  <Typography.Link strong style={{ whiteSpace: 'nowrap' }} onClick={() => open(c.id)}>
                    {c.phone}
                  </Typography.Link>
                )}
                <Typography.Text type="secondary" style={{ display: 'block' }}>
                  {c.name || t('customers.list.noName')}
                </Typography.Text>
                {c.email ? (
                  <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                    {c.email}
                  </Typography.Text>
                ) : null}
              </div>
            ),
          },
          { title: t('customers.columns.tags'), key: 'tags', render: (_, c) => <CustomerTags tags={c.tags} /> },
          { title: t('customers.columns.spent'), key: 'spent', align: 'right', render: (_, c) => <MoneyText value={c.totalSpent} strong /> },
          {
            title: t('customers.columns.orders'),
            key: 'orders',
            render: (_, c) => t('customers.list.ordersValue', { completed: c.completedOrdersCount, total: c.ordersCount }),
          },
          {
            title: t('customers.columns.reservations'),
            key: 'reservations',
            render: (_, c) => (
              <Space direction="vertical" size={0}>
                <span>{c.reservationsCount}</span>
                {c.noShowCount > 0 ? (
                  <Typography.Text type="danger" style={{ fontSize: 12 }}>
                    {t('customers.list.noShows', { count: c.noShowCount })}
                  </Typography.Text>
                ) : null}
              </Space>
            ),
          },
          { title: t('customers.columns.banquets'), key: 'banquets', render: (_, c) => c.banquetsCount },
          {
            title: t('customers.columns.consents'),
            key: 'consents',
            render: (_, c) => (
              <Space direction="vertical" size={0}>
                <ConsentIcon granted={c.personalDataConsent} label={t('customers.list.pd')} />
                <ConsentIcon granted={c.marketingConsent} label={t('customers.list.marketing')} />
              </Space>
            ),
          },
          {
            title: t('customers.columns.lastActivity'),
            key: 'lastActivity',
            render: (_, c) => (
              <Space direction="vertical" size={0}>
                <span style={{ whiteSpace: 'nowrap' }}>{formatDateTime(c.lastActivityAt)}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {t('customers.list.firstSeen', { date: formatDate(c.firstSeenAt) })}
                </Typography.Text>
              </Space>
            ),
          },
        ]}
      />
      {saving ? (
        <SaveSegmentModal
          filter={effectiveFilter}
          currentSegment={state.segmentId && segment.data ? segment.data : null}
          onClose={() => setSaving(false)}
          onSaved={(saved) => {
            setSaving(false);
            setParams(serializeListState({ ...DEFAULT_CUSTOMER_LIST, perPage: state.perPage, sort: state.sort, order: state.order, segmentId: saved.id }));
          }}
        />
      ) : null}
      {exporting ? (
        <ExportModal
          refinements={refinements}
          segmentId={state.segmentId}
          segmentName={segmentName}
          effectiveFilter={effectiveFilter}
          onClose={() => setExporting(false)}
        />
      ) : null}
    </>
  );
}
