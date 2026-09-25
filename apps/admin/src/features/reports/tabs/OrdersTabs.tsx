/**
 * Витрина и заказы: конверсия витрины (воронка сессий → заказ, по дням), топ блюд (по выручке или количеству),
 * отменённые заказы и причины (график причин + постраничный список).
 */
import { Col, Flex, Progress, Row, Segmented, Select, Space, Table, Tag, Tooltip as AntTooltip, Typography } from 'antd';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { translate } from '@aula/api-client';
import { useBranch } from '@/shared/branch/BranchProvider';
import { formatDateTime } from '@/shared/lib/dates';
import { tx } from '@/shared/i18n/tx';
import { reportQuery, reportsApi } from '../api';
import { conversionFunnel, percent, type FunnelRow } from '../chart-data';
import { shortDate } from '../period';
import { AXIS_PROPS, GRID_PROPS, ReportCard, SERIES_COLORS, StatRow, useMoney, useReport, useReportContext } from '../report-ui';
import type { CancelledOrder } from '../types';

/** Упорядоченная шкала одного оттенка для ступеней воронки (от светлой к тёмной, не светлее 2:1 к фону). */
export const FUNNEL_RAMP = ['#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab'] as const;

/** Воронка: горизонтальные полосы (доля от первой ступени), число и конверсия шага подписаны. */
export function FunnelBars<K extends string>({ rows, label, extra }: { rows: Array<FunnelRow<K>>; label: (key: K) => string; extra?: (row: FunnelRow<K>) => ReactNode }) {
  const { t, i18n } = useTranslation();
  return (
    <Flex vertical gap={8} role="list">
      {rows.map((row, index) => (
        <div key={row.key} role="listitem">
          <Flex justify="space-between" gap={8} style={{ fontSize: 13 }}>
            <span>{label(row.key)}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              <strong>{row.value}</strong>
              {row.ofPrevious !== null ? (
                <Typography.Text type="secondary"> · {t('reports.funnel.ofPrevious', { value: percent(row.ofPrevious, i18n.language) })}</Typography.Text>
              ) : null}
              {extra ? extra(row) : null}
            </span>
          </Flex>
          <div style={{ height: 14, background: '#f3f1ec', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.max(row.value > 0 ? 1 : 0, (row.ofFirst ?? 0) * 100)}%`,
                height: '100%',
                background: FUNNEL_RAMP[Math.min(index, FUNNEL_RAMP.length - 1)],
                borderRadius: 4,
              }}
            />
          </div>
        </div>
      ))}
    </Flex>
  );
}

// ---------------------------------------------------------------- конверсия витрины

export function ConversionTab() {
  const { t, i18n } = useTranslation();
  const query = useReport('conversion', reportsApi.conversion);
  const data = query.data;
  const days = (data?.days ?? []).map((d) => ({ ...d, label: shortDate(d.date) }));
  const names: Record<string, string> = { sessions: t('reports.conversion.sessions'), orderedSessions: t('reports.conversion.orderedSessions') };
  return (
    <ReportCard title={t('reports.tabs.conversion')} exportKey="conversion" query={query}>
      {data ? (
        <>
          <StatRow
            stats={[
              { key: 'conv', label: t('reports.conversion.conversion'), value: percent(data.conversion, i18n.language), hint: t('reports.conversion.conversionHint') },
              { key: 'sessions', label: t('reports.conversion.sessions'), value: data.sessions },
              { key: 'ordered', label: t('reports.conversion.orderedSessions'), value: data.orderedSessions },
              { key: 'web', label: t('reports.conversion.webOrders'), value: data.webOrders },
            ]}
          />
          <Row gutter={[24, 24]}>
            <Col xs={24} lg={10}>
              <Typography.Title level={5}>{t('reports.conversion.funnel')}</Typography.Title>
              <FunnelBars rows={conversionFunnel(data)} label={(key) => t(`reports.conversion.steps.${key}`)} />
            </Col>
            <Col xs={24} lg={14}>
              <Typography.Title level={5}>{t('reports.conversion.byDay')}</Typography.Title>
              <div style={{ width: '100%', height: 260 }} role="img" aria-label={t('reports.conversion.byDay')}>
                <ResponsiveContainer>
                  <LineChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="label" {...AXIS_PROPS} minTickGap={12} />
                    <YAxis {...AXIS_PROPS} axisLine={false} allowDecimals={false} width={48} />
                    <Tooltip
                      formatter={(value, name) => [String(value), names[String(name)] ?? String(name)]}
                      labelFormatter={(label) => String(label)}
                    />
                    <Legend formatter={(value: string) => <span style={{ color: '#52514e' }}>{names[value] ?? value}</span>} />
                    <Line type="monotone" dataKey="sessions" stroke={SERIES_COLORS[0]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                    <Line type="monotone" dataKey="orderedSessions" stroke={SERIES_COLORS[1]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Col>
          </Row>
          <Table
            rowKey="date"
            size="small"
            style={{ marginTop: 16 }}
            pagination={days.length > 31 ? { pageSize: 31 } : false}
            dataSource={data.days}
            columns={[
              { title: t('reports.fields.date'), dataIndex: 'date' },
              { title: t('reports.conversion.sessions'), dataIndex: 'sessions', align: 'right' },
              { title: t('reports.conversion.orderedSessions'), dataIndex: 'orderedSessions', align: 'right' },
              { title: t('reports.conversion.conversion'), key: 'conv', align: 'right', render: (_, r) => percent(r.conversion, i18n.language) },
            ]}
          />
        </>
      ) : null}
    </ReportCard>
  );
}

// ---------------------------------------------------------------- топ блюд

const LIMITS = [10, 20, 50, 100];

export function TopDishesTab() {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const { params } = useReportContext();
  const [sort, setSort] = useState<'revenue' | 'quantity'>('revenue');
  const [limit, setLimit] = useState(20);
  const query = useReport('top-dishes', (p) => reportsApi.topDishes(p, sort, limit), { sort, limit });
  const data = query.data;
  const maxQuantity = Math.max(1, ...(data?.items ?? []).map((i) => i.quantity));
  return (
    <ReportCard
      title={t('reports.tabs.topDishes')}
      exportKey="topDishes"
      exportQuery={{ ...reportQuery(params), sort, limit }}
      query={query}
      extra={
        <Space wrap>
          <Segmented
            value={sort}
            onChange={(value) => setSort(value as 'revenue' | 'quantity')}
            options={[
              { value: 'revenue', label: t('reports.topDishes.byRevenue') },
              { value: 'quantity', label: t('reports.topDishes.byQuantity') },
            ]}
          />
          <Select value={limit} onChange={setLimit} options={LIMITS.map((value) => ({ value, label: t('reports.topDishes.limit', { count: value }) }))} style={{ width: 110 }} />
        </Space>
      }
    >
      {data ? (
        <>
          <StatRow
            span={8}
            stats={[
              { key: 'qty', label: t('reports.topDishes.totalQuantity'), value: data.totalQuantity },
              { key: 'rev', label: t('reports.topDishes.totalRevenue'), value: money(data.totalRevenue) },
            ]}
          />
          <Table
            rowKey="dishId"
            size="small"
            pagination={false}
            scroll={{ x: 'max-content' }}
            dataSource={data.items}
            locale={{ emptyText: t('reports.empty') }}
            columns={[
              { title: '#', dataIndex: 'rank', width: 48 },
              { title: t('reports.fields.dish'), key: 'name', render: (_, r) => translate(r.name, i18n.language) || r.dishId },
              {
                title: t('reports.fields.quantity'),
                key: 'quantity',
                align: 'right',
                render: (_, r) => (
                  <Flex align="center" gap={8} justify="flex-end">
                    {sort === 'quantity' ? <Progress percent={(r.quantity / maxQuantity) * 100} showInfo={false} size="small" style={{ width: 80, margin: 0 }} /> : null}
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.quantity}</span>
                  </Flex>
                ),
              },
              { title: t('reports.fields.orders'), dataIndex: 'orders', align: 'right' },
              {
                title: t('reports.fields.revenue'),
                key: 'revenue',
                align: 'right',
                render: (_, r) => (
                  <Flex align="center" gap={8} justify="flex-end">
                    {sort === 'revenue' ? <Progress percent={(r.revenueShare ?? 0) * 100} showInfo={false} size="small" style={{ width: 80, margin: 0 }} /> : null}
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(r.revenue)}</span>
                  </Flex>
                ),
              },
              { title: t('reports.fields.share'), key: 'share', align: 'right', render: (_, r) => percent(r.revenueShare, i18n.language) },
            ]}
          />
        </>
      ) : null}
    </ReportCard>
  );
}

// ---------------------------------------------------------------- отменённые заказы

export function CancelledOrdersTab() {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const { params } = useReportContext();
  const { branchName } = useBranch();
  const [page, setPage] = useState({ page: 1, perPage: 50 });
  const query = useReport('cancelled-orders', (p) => reportsApi.cancelledOrders(p, page.page, page.perPage), page);
  const data = query.data;
  const reasonName = (code: string) => tx(t, `reports.cancelReasons.${code}`, code);
  const chartRows = (data?.reasons ?? []).map((r) => ({ reason: reasonName(r.reasonCode), count: r.count, paidCount: r.paidCount }));
  return (
    <ReportCard title={t('reports.tabs.cancelledOrders')} exportKey="cancelledOrders" query={query}>
      {data ? (
        <>
          <StatRow
            stats={[
              { key: 'placed', label: t('reports.cancelled.placed'), value: data.placed },
              { key: 'cancelled', label: t('reports.cancelled.cancelled'), value: data.cancelled },
              { key: 'share', label: t('reports.cancelled.share'), value: percent(data.cancelledShare, i18n.language) },
              { key: 'total', label: t('reports.cancelled.total'), value: money(data.cancelledTotal) },
            ]}
          />
          <Row gutter={[24, 16]}>
            <Col xs={24} lg={12}>
              <div style={{ width: '100%', height: Math.max(160, chartRows.length * 44 + 40) }} role="img" aria-label={t('reports.cancelled.byReason')}>
                <ResponsiveContainer>
                  <BarChart data={chartRows} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
                    <XAxis type="number" {...AXIS_PROPS} allowDecimals={false} />
                    <YAxis type="category" dataKey="reason" {...AXIS_PROPS} width={160} />
                    <Tooltip formatter={(value, name) => [String(value), name === 'paidCount' ? t('reports.cancelled.paidCount') : t('reports.cancelled.count')]} />
                    <Legend formatter={(value: string) => <span style={{ color: '#52514e' }}>{value === 'paidCount' ? t('reports.cancelled.paidCount') : t('reports.cancelled.count')}</span>} />
                    <Bar dataKey="count" fill={SERIES_COLORS[0]} maxBarSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                    <Bar dataKey="paidCount" fill={SERIES_COLORS[1]} maxBarSize={18} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Col>
            <Col xs={24} lg={12}>
              <Table
                rowKey="reasonCode"
                size="small"
                pagination={false}
                dataSource={data.reasons}
                locale={{ emptyText: t('reports.empty') }}
                columns={[
                  { title: t('reports.cancelled.reason'), key: 'reason', render: (_, r) => reasonName(r.reasonCode) },
                  { title: t('reports.cancelled.count'), dataIndex: 'count', align: 'right' },
                  { title: t('reports.cancelled.paidCount'), dataIndex: 'paidCount', align: 'right' },
                  { title: t('reports.fields.total'), key: 'total', align: 'right', render: (_, r) => money(r.total) },
                ]}
              />
            </Col>
          </Row>
          <Typography.Title level={5} style={{ marginTop: 24 }}>
            {t('reports.cancelled.orders')}
          </Typography.Title>
          <Table<CancelledOrder>
            rowKey="orderId"
            size="small"
            scroll={{ x: 'max-content' }}
            loading={query.isFetching}
            dataSource={data.orders.items}
            pagination={{
              current: page.page,
              pageSize: page.perPage,
              total: data.orders.total,
              showSizeChanger: true,
              pageSizeOptions: [20, 50, 100, 200],
              onChange: (p, perPage) => setPage({ page: perPage === page.perPage ? p : 1, perPage }),
            }}
            columns={[
              { title: t('reports.fields.orderNumber'), dataIndex: 'number', render: (n: string, r) => <Link to={`/orders/${r.orderId}`}>{n}</Link> },
              ...(params.branchId ? [] : [{ title: t('reports.fields.branch'), key: 'branch', render: (_: unknown, r: CancelledOrder) => branchName(r.branchId) }]),
              { title: t('reports.cancelled.type'), key: 'type', render: (_, r) => tx(t, `reports.orderTypes.${r.type}`, r.type) },
              { title: t('reports.fields.channel'), key: 'channel', render: (_, r) => tx(t, `reports.orderChannels.${r.channel}`, r.channel) },
              { title: t('reports.fields.total'), key: 'total', align: 'right', render: (_, r) => money(r.total) },
              {
                title: t('reports.cancelled.reason'),
                key: 'reason',
                render: (_, r) => (
                  <AntTooltip title={r.reason}>
                    <span>{reasonName(r.reasonCode)}</span>
                  </AntTooltip>
                ),
              },
              { title: t('reports.cancelled.wasPaid'), key: 'paid', render: (_, r) => (r.wasPaid ? <Tag color="orange">{t('reports.cancelled.paidTag')}</Tag> : null) },
              { title: t('reports.cancelled.placedAt'), key: 'placedAt', render: (_, r) => formatDateTime(r.placedAt) },
              { title: t('reports.cancelled.cancelledAt'), key: 'cancelledAt', render: (_, r) => formatDateTime(r.cancelledAt) },
            ]}
          />
        </>
      ) : null}
    </ReportCard>
  );
}
