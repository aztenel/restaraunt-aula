/**
 * Продажи: выручка по дням и каналам (столбцы с накоплением по каналам + таблица и итоги, возвраты),
 * средний чек по каналам, доля своего канала (с помесячными итогами агрегаторов — ручной ввод).
 */
import { Alert, Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Row, Table, Tag, Typography, type TableColumnsType } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import type { Dayjs } from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { useAuth } from '@/shared/auth/AuthProvider';
import { useBranch } from '@/shared/branch/BranchProvider';
import { dayjs, formatDateTime } from '@/shared/lib/dates';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { reportKeys, reportsApi } from '../api';
import { activeChannels, amountOf, compactMoney, moneyText, percent, revenueChartRows, type RevenueChartRow } from '../chart-data';
import { monthsOf } from '../period';
import { AXIS_PROPS, CHANNEL_COLORS, GRID_PROPS, MoneyTooltip, ReportCard, StatRow, useMoney, useReport, useReportContext } from '../report-ui';
import { canEditAggregators } from '../scope';
import { SALES_CHANNELS, type AggregatorVolume, type ChannelAmounts, type SalesChannel } from '../types';

// ---------------------------------------------------------------- выручка

export function RevenueTab() {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const { params } = useReportContext();
  const { branchName } = useBranch();
  const query = useReport('revenue', reportsApi.revenue);
  const data = query.data;
  const rows = data ? revenueChartRows(data.days) : [];
  const channels = activeChannels(rows);
  const names = Object.fromEntries(SALES_CHANNELS.map((c) => [c, t(`reports.channels.${c}`)])) as Record<SalesChannel, string>;

  const dayColumns: TableColumnsType<RevenueChartRow> = [
    { title: t('reports.fields.date'), dataIndex: 'date', fixed: 'left' },
    ...SALES_CHANNELS.map((channel) => ({
      title: names[channel],
      dataIndex: channel,
      align: 'right' as const,
      render: (value: number) => moneyText(value, i18n.language),
    })),
    {
      title: t('reports.fields.refunds'),
      dataIndex: 'refunds',
      align: 'right',
      render: (value: number) => (value !== 0 ? <Typography.Text type="danger">{moneyText(value, i18n.language)}</Typography.Text> : moneyText(0, i18n.language)),
    },
    { title: t('reports.fields.total'), dataIndex: 'total', align: 'right', render: (value: number) => <strong>{moneyText(value, i18n.language)}</strong> },
  ];

  return (
    <ReportCard title={t('reports.tabs.revenue')} exportKey="revenue" query={query}>
      {data ? (
        <>
          <StatRow
            span={4}
            stats={[
              { key: 'total', label: t('reports.fields.total'), value: money(data.totals.total), hint: t('reports.revenue.totalHint') },
              ...SALES_CHANNELS.map((channel) => ({
                key: channel,
                label: names[channel],
                value: money(data.totals[channel]),
                hint: t('reports.revenue.countHint', { count: data.counts[channel] }),
              })),
              { key: 'refunds', label: t('reports.fields.refunds'), value: money(data.totals.refunds), hint: t('reports.revenue.refundsHint') },
            ]}
          />
          <div style={{ width: '100%', height: 320 }} role="img" aria-label={t('reports.revenue.chartLabel')}>
            <ResponsiveContainer>
              <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barCategoryGap="20%">
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" {...AXIS_PROPS} minTickGap={12} />
                <YAxis {...AXIS_PROPS} axisLine={false} width={84} tickFormatter={(value: number) => compactMoney(value, i18n.language)} />
                <Tooltip
                  cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                  content={(props) => (
                    <MoneyTooltip
                      {...(props as object)}
                      names={names}
                      extraRows={(row) => [
                        { label: t('reports.fields.refunds'), value: moneyText(Number(row.refunds ?? 0), i18n.language) },
                        { label: t('reports.fields.total'), value: moneyText(Number(row.total ?? 0), i18n.language) },
                      ]}
                    />
                  )}
                />
                <Legend formatter={(value: string) => <span style={{ color: '#52514e' }}>{names[value as SalesChannel] ?? value}</span>} />
                {channels.map((channel, index) => (
                  <Bar
                    key={channel}
                    dataKey={channel}
                    stackId="revenue"
                    fill={CHANNEL_COLORS[channel]}
                    stroke="#ffffff"
                    strokeWidth={1}
                    maxBarSize={40}
                    radius={index === channels.length - 1 ? [4, 4, 0, 0] : 0}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Table<RevenueChartRow>
            rowKey="date"
            size="small"
            style={{ marginTop: 16 }}
            columns={dayColumns}
            dataSource={rows}
            pagination={rows.length > 31 ? { pageSize: 31 } : false}
            scroll={{ x: 'max-content' }}
            summary={() => <AmountsSummary totals={data.totals} label={t('reports.fields.total')} />}
          />
          {params.branchId === null && data.byBranch.length > 0 ? (
            <>
              <Typography.Title level={5} style={{ marginTop: 24 }}>
                {t('reports.revenue.byBranch')}
              </Typography.Title>
              <Table
                rowKey={(r) => r.branchId ?? 'none'}
                size="small"
                pagination={false}
                scroll={{ x: 'max-content' }}
                dataSource={data.byBranch}
                columns={[
                  {
                    title: t('reports.fields.branch'),
                    key: 'branch',
                    render: (_, r) => (r.branchId ? branchName(r.branchId) : <Typography.Text type="secondary">{t('reports.revenue.noBranch')}</Typography.Text>),
                  },
                  ...SALES_CHANNELS.map((channel) => ({ title: names[channel], key: channel, align: 'right' as const, render: (_: unknown, r: ChannelAmounts) => money(r[channel]) })),
                  { title: t('reports.fields.refunds'), key: 'refunds', align: 'right', render: (_, r) => money(r.refunds) },
                  { title: t('reports.fields.total'), key: 'total', align: 'right', render: (_, r) => <strong>{money(r.total)}</strong> },
                ]}
              />
            </>
          ) : null}
        </>
      ) : null}
    </ReportCard>
  );
}

function AmountsSummary({ totals, label }: { totals: ChannelAmounts; label: string }) {
  const money = useMoney();
  return (
    <Table.Summary.Row>
      <Table.Summary.Cell index={0}>
        <strong>{label}</strong>
      </Table.Summary.Cell>
      {SALES_CHANNELS.map((channel, index) => (
        <Table.Summary.Cell key={channel} index={index + 1} align="right">
          <strong>{money(totals[channel])}</strong>
        </Table.Summary.Cell>
      ))}
      <Table.Summary.Cell index={5} align="right">
        <strong>{money(totals.refunds)}</strong>
      </Table.Summary.Cell>
      <Table.Summary.Cell index={6} align="right">
        <strong>{money(totals.total)}</strong>
      </Table.Summary.Cell>
    </Table.Summary.Row>
  );
}

// ---------------------------------------------------------------- средний чек

export function AverageCheckTab() {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const query = useReport('average-check', reportsApi.averageCheck);
  const data = query.data;
  const chartRows = (data?.channels ?? []).map((row) => ({
    channel: row.channel,
    name: t(`reports.channels.${row.channel}`),
    average: amountOf(row.average),
  }));
  return (
    <ReportCard title={t('reports.tabs.averageCheck')} exportKey="averageCheck" query={query}>
      {data ? (
        <>
          <StatRow
            stats={[
              { key: 'avg', label: t('reports.averageCheck.orders'), value: money(data.orders.average), hint: t('reports.averageCheck.ordersHint') },
              { key: 'count', label: t('reports.averageCheck.ordersCount'), value: data.orders.count },
              { key: 'revenue', label: t('reports.averageCheck.ordersRevenue'), value: money(data.orders.revenue) },
            ]}
            span={8}
          />
          <Row gutter={[24, 16]}>
            <Col xs={24} lg={12}>
              <div style={{ width: '100%', height: 260 }} role="img" aria-label={t('reports.averageCheck.chartLabel')}>
                <ResponsiveContainer>
                  <BarChart data={chartRows} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
                    <XAxis type="number" {...AXIS_PROPS} tickFormatter={(value: number) => compactMoney(value, i18n.language)} />
                    <YAxis type="category" dataKey="name" {...AXIS_PROPS} width={110} />
                    <Tooltip
                      cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                      content={(props) => <MoneyTooltip {...(props as object)} names={{ average: t('reports.fields.averageCheck') }} />}
                    />
                    <Bar dataKey="average" fill={CHANNEL_COLORS.delivery} maxBarSize={28} radius={[0, 4, 4, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Col>
            <Col xs={24} lg={12}>
              <Table
                rowKey="channel"
                size="small"
                pagination={false}
                dataSource={data.channels}
                columns={[
                  { title: t('reports.fields.channel'), dataIndex: 'channel', render: (c: SalesChannel) => t(`reports.channels.${c}`) },
                  { title: t('reports.fields.count'), dataIndex: 'count', align: 'right' },
                  { title: t('reports.fields.revenueGross'), key: 'revenue', align: 'right', render: (_, r) => money(r.revenue) },
                  { title: t('reports.fields.averageCheck'), key: 'average', align: 'right', render: (_, r) => <strong>{money(r.average)}</strong> },
                ]}
              />
            </Col>
          </Row>
        </>
      ) : null}
    </ReportCard>
  );
}

// ---------------------------------------------------------------- доля своего канала

export function OwnChannelTab() {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const query = useReport('own-channel', reportsApi.ownChannel);
  const data = query.data;
  return (
    <>
      <ReportCard title={t('reports.tabs.ownChannel')} exportKey="ownChannel" query={query}>
        {data ? (
          <>
            <StatRow
              stats={[
                {
                  key: 'share',
                  label: t('reports.ownChannel.share'),
                  value: percent(data.totals.ownShare, i18n.language),
                  hint: data.totals.ownShare === null ? t('reports.ownChannel.noAggregatorData') : t('reports.ownChannel.shareHint'),
                },
                { key: 'own', label: t('reports.ownChannel.ownOrders'), value: data.totals.ownOrders },
                { key: 'aggr', label: t('reports.ownChannel.aggregatorOrders'), value: data.totals.aggregatorOrders ?? '—' },
                { key: 'rev', label: t('reports.ownChannel.ownRevenue'), value: money(data.totals.ownRevenue) },
              ]}
            />
            <Table
              rowKey="month"
              size="small"
              pagination={false}
              scroll={{ x: 'max-content' }}
              dataSource={data.months}
              columns={[
                { title: t('reports.fields.month'), dataIndex: 'month' },
                { title: t('reports.ownChannel.webOrders'), dataIndex: 'webOrders', align: 'right' },
                { title: t('reports.ownChannel.adminOrders'), dataIndex: 'adminOrders', align: 'right' },
                { title: t('reports.ownChannel.ownOrders'), dataIndex: 'ownOrders', align: 'right' },
                { title: t('reports.ownChannel.ownRevenue'), key: 'ownRevenue', align: 'right', render: (_, r) => money(r.ownRevenue) },
                { title: t('reports.ownChannel.aggregatorOrders'), key: 'ao', align: 'right', render: (_, r) => r.aggregatorOrders ?? '—' },
                { title: t('reports.ownChannel.aggregatorRevenue'), key: 'ar', align: 'right', render: (_, r) => money(r.aggregatorRevenue) },
                { title: t('reports.ownChannel.share'), key: 'share', align: 'right', render: (_, r) => <strong>{percent(r.ownShare, i18n.language)}</strong> },
              ]}
            />
          </>
        ) : null}
      </ReportCard>
      <AggregatorVolumes />
    </>
  );
}

interface VolumeFormValues {
  month: Dayjs | null;
  source: string;
  sourceName: string;
  orders: number | null;
  revenue: number | null;
}

/** Помесячные итоги агрегаторов (заказы агрегаторов в систему не попадают) — ручной ввод, записывается в журнал. */
function AggregatorVolumes() {
  const { t } = useTranslation();
  const money = useMoney();
  const { me } = useAuth();
  const { params } = useReportContext();
  const { branchName } = useBranch();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const months = monthsOf(params);
  const canEdit = canEditAggregators(me, params.branchId);
  const [editing, setEditing] = useState<AggregatorVolume | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<VolumeFormValues>();
  const query = useApiQuery(reportKeys.aggregators({ ...months, branchId: params.branchId }), () =>
    reportsApi.aggregatorVolumes({ ...months, branchId: params.branchId }),
  );

  const open = (row: AggregatorVolume | 'new') => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue(
      row === 'new'
        ? { month: dayjs(`${months.toMonth}-01`), source: '', sourceName: '', orders: null, revenue: null }
        : { month: dayjs(`${row.month}-01`), source: row.source, sourceName: row.sourceName, orders: row.orders, revenue: row.revenue.amount },
    );
  };

  const save = async () => {
    if (!params.branchId) return;
    let values: VolumeFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      await reportsApi.saveAggregatorVolume({
        branchId: params.branchId,
        month: values.month!.format('YYYY-MM'),
        source: values.source.trim(),
        sourceName: values.sourceName.trim(),
        orders: values.orders ?? 0,
        ...(values.revenue !== null && values.revenue !== undefined ? { revenue: { amount: values.revenue, currency: 'KZT' } } : {}),
      });
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['reports', 'aggregators'] });
      void queryClient.invalidateQueries({ queryKey: ['reports', 'own-channel'] });
      void queryClient.invalidateQueries({ queryKey: ['reports', 'goals'] });
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      style={{ marginTop: 16 }}
      title={t('reports.aggregators.title')}
      extra={
        canEdit ? (
          <Button type="primary" onClick={() => open('new')}>
            {t('reports.aggregators.add')}
          </Button>
        ) : null
      }
    >
      <Typography.Paragraph type="secondary">{t('reports.aggregators.hint')}</Typography.Paragraph>
      {!params.branchId ? <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('reports.aggregators.branchRequired')} /> : null}
      <Table<AggregatorVolume>
        rowKey="id"
        size="small"
        loading={query.isLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        dataSource={query.data ?? []}
        locale={{ emptyText: t('reports.aggregators.empty') }}
        columns={[
          { title: t('reports.fields.month'), dataIndex: 'month' },
          ...(params.branchId ? [] : [{ title: t('reports.fields.branch'), key: 'branch', render: (_: unknown, r: AggregatorVolume) => branchName(r.branchId) }]),
          { title: t('reports.aggregators.source'), key: 'source', render: (_, r) => <span>{r.sourceName} <Tag>{r.source}</Tag></span> },
          { title: t('reports.aggregators.orders'), dataIndex: 'orders', align: 'right' },
          { title: t('reports.aggregators.revenue'), key: 'revenue', align: 'right', render: (_, r) => money(r.revenue) },
          { title: t('reports.aggregators.updatedAt'), key: 'updatedAt', render: (_, r) => formatDateTime(r.updatedAt) },
          ...(canEdit
            ? [
                {
                  key: 'edit',
                  render: (_: unknown, r: AggregatorVolume) => (
                    <Button size="small" onClick={() => open(r)}>
                      {t('common.edit')}
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Modal
        open={editing !== null}
        title={editing === 'new' ? t('reports.aggregators.add') : t('reports.aggregators.edit')}
        onCancel={() => setEditing(null)}
        onOk={() => void save()}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          {t('reports.aggregators.formHint', { branch: params.branchId ? branchName(params.branchId) : '' })}
        </Typography.Paragraph>
        <Form<VolumeFormValues> form={form} layout="vertical">
          <Form.Item name="month" label={t('reports.fields.month')} rules={[{ required: true, message: t('common.required') }]}>
            <DatePicker picker="month" format="MM.YYYY" style={{ width: '100%' }} disabled={editing !== 'new'} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="source"
                label={t('reports.aggregators.sourceCode')}
                extra={t('reports.aggregators.sourceCodeHint')}
                rules={[{ required: true, pattern: /^[A-Za-z0-9_]{2,32}$/, message: t('reports.aggregators.sourceCodeHint') }]}
              >
                <Input maxLength={32} disabled={editing !== 'new'} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sourceName" label={t('reports.aggregators.sourceName')} rules={[{ required: true, whitespace: true, message: t('common.required') }]}>
                <Input maxLength={120} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="orders" label={t('reports.aggregators.orders')} rules={[{ required: true, type: 'integer', min: 0, max: 1_000_000 }]}>
                <InputNumber min={0} max={1_000_000} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="revenue" label={t('reports.aggregators.revenue')} extra={t('reports.aggregators.revenueHint')}>
                <MoneyInput />
              </Form.Item>
            </Col>
          </Row>
        </Form>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('reports.aggregators.audited')}
        </Typography.Text>
      </Modal>
    </Card>
  );
}

