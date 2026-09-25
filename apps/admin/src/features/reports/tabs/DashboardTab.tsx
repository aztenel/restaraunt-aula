/** Панель показателей: сегодня, вчера и последние 7 дней (выручка, заказы, средний чек, брони, банкеты, витрина). */
import { Card, Col, Descriptions, Row, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/dates';
import { useApiQuery } from '@/shared/api/hooks';
import { reportKeys, reportsApi } from '../api';
import { percent } from '../chart-data';
import { ReportCard, useMoney, useReportContext } from '../report-ui';
import type { PeriodKpis } from '../types';

const PERIODS = ['today', 'yesterday', 'last7Days'] as const;

export function DashboardTab() {
  const { t } = useTranslation();
  const { params } = useReportContext();
  // Периоды панели фиксированы (сегодня, вчера, 7 дней) — ключ не зависит от выбранного периода.
  const query = useApiQuery(reportKeys.report('dashboard', { branchId: params.branchId }), () => reportsApi.dashboard(params.branchId), {
    keepPrevious: true,
    refetchInterval: 60_000,
  });
  return (
    <ReportCard
      title={t('reports.tabs.dashboard')}
      exportKey="dashboard"
      exportQuery={params.branchId ? { branchId: params.branchId } : {}}
      query={query}
    >
      {query.data ? (
        <>
          <Row gutter={[16, 16]}>
            {PERIODS.map((key) => (
              <Col key={key} xs={24} lg={8}>
                <KpiCard title={t(`reports.dashboard.${key}`)} kpis={query.data![key]} />
              </Col>
            ))}
          </Row>
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
            {t('reports.dashboard.generatedAt', { date: formatDateTime(query.data.generatedAt) })}
          </Typography.Text>
        </>
      ) : null}
    </ReportCard>
  );
}

function KpiCard({ title, kpis }: { title: string; kpis: PeriodKpis }) {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  return (
    <Card size="small" title={title} extra={<Typography.Text type="secondary">{kpis.from === kpis.to ? kpis.from : `${kpis.from} — ${kpis.to}`}</Typography.Text>}>
      <Typography.Title level={3} style={{ margin: '0 0 8px' }}>
        {money(kpis.revenue)}
      </Typography.Title>
      <Typography.Text type="secondary">{t('reports.kpi.revenue')}</Typography.Text>
      <Descriptions size="small" column={1} style={{ marginTop: 12 }}>
        <Descriptions.Item label={t('reports.kpi.completedOrders')}>{kpis.completedOrders}</Descriptions.Item>
        <Descriptions.Item label={t('reports.kpi.averageCheck')}>{money(kpis.averageCheck)}</Descriptions.Item>
        <Descriptions.Item label={t('reports.kpi.placedOrders')}>
          {kpis.placedOrders} · {t('reports.kpi.cancelledShort', { count: kpis.cancelledOrders })}
        </Descriptions.Item>
        <Descriptions.Item label={t('reports.kpi.reservations')}>
          {kpis.reservations} · {t('reports.kpi.guestsShort', { count: kpis.guests })}
        </Descriptions.Item>
        <Descriptions.Item label={t('reports.kpi.banquetRequests')}>
          {kpis.banquetRequests} · {t('reports.kpi.slaShort', { value: percent(kpis.banquetAnsweredWithinSlaShare, i18n.language) })}
        </Descriptions.Item>
        <Descriptions.Item label={t('reports.kpi.sessions')}>
          {kpis.sessions} · {t('reports.kpi.conversionShort', { value: percent(kpis.conversion, i18n.language) })}
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}
