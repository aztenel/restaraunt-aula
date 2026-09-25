/**
 * Деньги: движение денег (поступления и возвраты по способам / провайдерам, назначениям и дням) и
 * сертификаты (выпущено, погашено, возвращено, просрочено, остаток обязательств — только сводный).
 */
import { Alert, Col, Row, Table, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { tx } from '@/shared/i18n/tx';
import { reportsApi } from '../api';
import { amountOf, compactMoney } from '../chart-data';
import { shortDate } from '../period';
import { AXIS_PROPS, GRID_PROPS, MoneyTooltip, ReportCard, SERIES_COLORS, StatRow, useMoney, useReport, useReportContext } from '../report-ui';

export function PaymentsTab() {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const query = useReport('payments', reportsApi.payments);
  const data = query.data;
  const days = (data?.days ?? []).map((d) => ({ date: d.date, label: shortDate(d.date), received: amountOf(d.received), refunded: amountOf(d.refunded) }));
  const names = { received: t('reports.payments.received'), refunded: t('reports.payments.refunded') };
  const amountColumns = [
    { title: t('reports.payments.received'), key: 'received', align: 'right' as const, render: (_: unknown, r: { received: { amount: number; currency: 'KZT' } }) => money(r.received) },
    { title: t('reports.payments.refunded'), key: 'refunded', align: 'right' as const, render: (_: unknown, r: { refunded: { amount: number; currency: 'KZT' } }) => money(r.refunded) },
    {
      title: t('reports.payments.net'),
      key: 'net',
      align: 'right' as const,
      render: (_: unknown, r: { net: { amount: number; currency: 'KZT' } }) => <strong>{money(r.net)}</strong>,
    },
  ];
  return (
    <ReportCard title={t('reports.tabs.payments')} exportKey="payments" query={query}>
      {data ? (
        <>
          <StatRow
            span={4}
            stats={[
              { key: 'received', label: t('reports.payments.received'), value: money(data.totals.received) },
              { key: 'refunded', label: t('reports.payments.refunded'), value: money(data.totals.refunded) },
              { key: 'net', label: t('reports.payments.net'), value: money(data.totals.net) },
              { key: 'money', label: t('reports.payments.moneyReceived'), value: money(data.totals.moneyReceived), hint: t('reports.payments.moneyReceivedHint') },
              {
                key: 'cert',
                label: t('reports.payments.certificateRedemptions'),
                value: money(data.totals.certificateRedemptions),
                hint: t('reports.payments.certificateRedemptionsHint'),
              },
            ]}
          />
          <div style={{ width: '100%', height: 280 }} role="img" aria-label={t('reports.payments.chartLabel')}>
            <ResponsiveContainer>
              <BarChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barGap={2}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" {...AXIS_PROPS} minTickGap={12} />
                <YAxis {...AXIS_PROPS} axisLine={false} width={84} tickFormatter={(value: number) => compactMoney(value, i18n.language)} />
                <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} content={(props) => <MoneyTooltip {...(props as object)} names={names} />} />
                <Legend formatter={(value: string) => <span style={{ color: '#52514e' }}>{names[value as keyof typeof names] ?? value}</span>} />
                <Bar dataKey="received" fill={SERIES_COLORS[0]} maxBarSize={20} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="refunded" fill={SERIES_COLORS[1]} maxBarSize={20} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Row gutter={[24, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} xl={14}>
              <Typography.Title level={5}>{t('reports.payments.byMethod')}</Typography.Title>
              <Table
                rowKey={(r) => `${r.method}:${r.provider}`}
                size="small"
                pagination={false}
                scroll={{ x: 'max-content' }}
                dataSource={data.methods}
                locale={{ emptyText: t('reports.empty') }}
                columns={[
                  { title: t('reports.payments.method'), key: 'method', render: (_, r) => tx(t, `reports.payments.methods.${r.method}`, r.method) },
                  { title: t('reports.payments.provider'), dataIndex: 'provider' },
                  { title: t('reports.payments.receivedCount'), dataIndex: 'receivedCount', align: 'right' },
                  { title: t('reports.payments.refundedCount'), dataIndex: 'refundedCount', align: 'right' },
                  ...amountColumns,
                ]}
              />
            </Col>
            <Col xs={24} xl={10}>
              <Typography.Title level={5}>{t('reports.payments.byPurpose')}</Typography.Title>
              <Table
                rowKey="purpose"
                size="small"
                pagination={false}
                scroll={{ x: 'max-content' }}
                dataSource={data.purposes}
                locale={{ emptyText: t('reports.empty') }}
                columns={[{ title: t('reports.payments.purpose'), key: 'purpose', render: (_, r) => tx(t, `reports.payments.purposes.${r.purpose}`, r.purpose) }, ...amountColumns]}
              />
            </Col>
          </Row>
        </>
      ) : null}
    </ReportCard>
  );
}

export function CertificatesTab() {
  const { t } = useTranslation();
  const money = useMoney();
  const { params } = useReportContext();
  const query = useReport('certificates', reportsApi.certificates);
  const data = query.data;
  return (
    <ReportCard title={t('reports.tabs.certificates')} exportKey="certificates" query={query}>
      {data ? (
        <>
          <StatRow
            stats={[
              {
                key: 'issued',
                label: t('reports.certificates.issued'),
                value: data.issued.count,
                hint: t('reports.certificates.issuedHint', { nominal: money(data.issued.nominal), price: money(data.issued.price) }),
              },
              { key: 'redeemed', label: t('reports.certificates.redeemed'), value: money(data.redeemed.amount), hint: t('reports.certificates.countHint', { count: data.redeemed.count }) },
              {
                key: 'expired',
                label: t('reports.certificates.expired'),
                value: data.expired ? money(data.expired.balance) : '—',
                hint: data.expired ? t('reports.certificates.countHint', { count: data.expired.count }) : t('reports.certificates.consolidatedOnly'),
              },
              {
                key: 'outstanding',
                label: t('reports.certificates.outstanding'),
                value: data.outstanding ? money(data.outstanding.balance) : '—',
                hint: data.outstanding
                  ? t('reports.certificates.outstandingHint', { count: data.outstanding.count, date: data.outstanding.asOf })
                  : t('reports.certificates.consolidatedOnly'),
              },
            ]}
          />
          {params.branchId ? <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('reports.certificates.branchNote')} /> : null}
          <Row gutter={[24, 16]}>
            <Col xs={24} lg={12}>
              <Typography.Title level={5}>{t('reports.certificates.byKind')}</Typography.Title>
              <Table
                rowKey="kind"
                size="small"
                pagination={false}
                dataSource={data.issuedByKind}
                locale={{ emptyText: t('reports.empty') }}
                columns={[
                  { title: t('reports.certificates.kind'), key: 'kind', render: (_, r) => tx(t, `reports.certificates.kinds.${r.kind}`, r.kind) },
                  { title: t('reports.fields.count'), dataIndex: 'count', align: 'right' },
                  { title: t('reports.certificates.nominal'), key: 'nominal', align: 'right', render: (_, r) => money(r.nominal) },
                  { title: t('reports.certificates.price'), key: 'price', align: 'right', render: (_, r) => money(r.price) },
                ]}
              />
            </Col>
            <Col xs={24} lg={12}>
              <Typography.Title level={5}>{t('reports.certificates.byChannel')}</Typography.Title>
              <Table
                rowKey="channel"
                size="small"
                pagination={false}
                dataSource={[...data.redeemedByChannel, { channel: 'returned', count: data.returned.count, amount: data.returned.amount }]}
                columns={[
                  { title: t('reports.fields.channel'), key: 'channel', render: (_, r) => tx(t, `reports.certificates.channels.${r.channel}`, r.channel) },
                  { title: t('reports.fields.count'), dataIndex: 'count', align: 'right' },
                  { title: t('reports.certificates.amount'), key: 'amount', align: 'right', render: (_, r) => money(r.amount) },
                ]}
              />
            </Col>
          </Row>
        </>
      ) : null}
    </ReportCard>
  );
}
