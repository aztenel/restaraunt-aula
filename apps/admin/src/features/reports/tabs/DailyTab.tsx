/**
 * Дневной отчёт: формируется автоматически в 23:30 (Asia/Almaty) и отправляется собственнику; до этого
 * показываются текущие данные дня. XLSX — подписанная ссылка сохранённого отчёта (1 час) или выгрузка.
 * История сохранённых отчётов за выбранный период.
 */
import { DownloadOutlined } from '@ant-design/icons';
import { Button, Card, Col, DatePicker, Descriptions, Row, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { translate } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useBranch } from '@/shared/branch/BranchProvider';
import { dayjs, formatDateTime } from '@/shared/lib/dates';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageLoader } from '@/shared/ui/PageLoader';
import { reportKeys, reportsApi } from '../api';
import { percent } from '../chart-data';
import { reportingToday } from '../period';
import { ExportButton, useMoney, useReportContext } from '../report-ui';
import { SALES_CHANNELS, type DailyReport } from '../types';

export function DailyTab() {
  const { t } = useTranslation();
  const { params, scopeLabel } = useReportContext();
  const [date, setDate] = useState(() => (params.to < reportingToday() ? params.to : reportingToday()));
  const query = useApiQuery(reportKeys.daily(date, params.branchId), () => reportsApi.daily(date, params.branchId), { keepPrevious: true });
  const report = query.data?.date === date ? query.data : undefined;

  return (
    <>
      <Card
        title={
          <div>
            <div>{t('reports.tabs.daily')}</div>
            <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              {scopeLabel}
            </Typography.Text>
          </div>
        }
        extra={
          <Space wrap>
            <DatePicker
              value={dayjs(date)}
              allowClear={false}
              format="DD.MM.YYYY"
              disabledDate={(d) => d.format('YYYY-MM-DD') > reportingToday()}
              onChange={(value) => value && setDate(value.format('YYYY-MM-DD'))}
            />
            {report?.fileUrl ? (
              <Button icon={<DownloadOutlined />} href={report.fileUrl} target="_blank" rel="noreferrer">
                {t('reports.daily.download')}
              </Button>
            ) : (
              <ExportButton report="daily" query={{ date, ...(params.branchId ? { branchId: params.branchId } : {}) }} disabled={!report} />
            )}
          </Space>
        }
      >
        {query.error ? <ErrorAlert error={query.error} onRetry={() => void query.refetch()} /> : null}
        {!report && query.isLoading ? <PageLoader /> : null}
        {report ? <DailySummary report={report} /> : null}
      </Card>
      <DailyHistory onOpen={setDate} />
    </>
  );
}

function DailySummary({ report }: { report: DailyReport }) {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const s = report.summary;
  return (
    <>
      <Space wrap style={{ marginBottom: 16 }}>
        {report.isFinal ? <Tag color="success">{t('reports.daily.final')}</Tag> : <Tag color="processing">{t('reports.daily.live')}</Tag>}
        {report.generatedAt ? <Typography.Text type="secondary">{t('reports.daily.generatedAt', { date: formatDateTime(report.generatedAt) })}</Typography.Text> : null}
        {report.notifiedAt ? <Typography.Text type="secondary">{t('reports.daily.notifiedAt', { date: formatDateTime(report.notifiedAt) })}</Typography.Text> : null}
      </Space>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card size="small" title={t('reports.daily.revenue')}>
            <Typography.Title level={3} style={{ marginTop: 0 }}>
              {money(s.revenue.total)}
            </Typography.Title>
            <Descriptions size="small" column={1}>
              {SALES_CHANNELS.map((channel) => (
                <Descriptions.Item key={channel} label={t(`reports.channels.${channel}`)}>
                  {money(s.revenue[channel])}
                </Descriptions.Item>
              ))}
              <Descriptions.Item label={t('reports.fields.refunds')}>{money(s.revenue.refunds)}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title={t('reports.daily.operations')}>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label={t('reports.kpi.placedOrders')}>{s.orders.placed}</Descriptions.Item>
              <Descriptions.Item label={t('reports.kpi.completedOrders')}>{s.orders.completed}</Descriptions.Item>
              <Descriptions.Item label={t('reports.cancelled.cancelled')}>{s.orders.cancelled}</Descriptions.Item>
              <Descriptions.Item label={t('reports.kpi.averageCheck')}>{money(s.orders.averageCheck)}</Descriptions.Item>
              <Descriptions.Item label={t('reports.daily.reservationsCreated')}>
                {s.reservations.created} · {t('reports.kpi.guestsShort', { count: s.reservations.guests })}
              </Descriptions.Item>
              <Descriptions.Item label={t('reports.daily.reservationsStarting')}>{s.reservations.starting}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title={t('reports.daily.banquetsAndMoney')}>
            <Descriptions size="small" column={1}>
              <Descriptions.Item label={t('reports.daily.banquetRequests')}>{s.banquets.newRequests}</Descriptions.Item>
              <Descriptions.Item label={t('reports.daily.banquetsAnswered')}>{s.banquets.answeredWithinSla}</Descriptions.Item>
              <Descriptions.Item label={t('reports.daily.banquetsOverdue')}>{s.banquets.unansweredOverdue}</Descriptions.Item>
              <Descriptions.Item label={t('reports.banquets.held')}>
                {s.banquets.held} · {money(s.banquets.heldTotal)}
              </Descriptions.Item>
              <Descriptions.Item label={t('reports.payments.received')}>{money(s.payments.received)}</Descriptions.Item>
              <Descriptions.Item label={t('reports.payments.refunded')}>{money(s.payments.refunded)}</Descriptions.Item>
              <Descriptions.Item label={t('reports.kpi.sessions')}>
                {s.storefront.sessions} · {t('reports.kpi.conversionShort', { value: percent(s.storefront.conversion, i18n.language) })}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>
      <Typography.Title level={5} style={{ marginTop: 16 }}>
        {t('reports.daily.topDishes')}
      </Typography.Title>
      <Table
        rowKey="dishId"
        size="small"
        pagination={false}
        dataSource={s.topDishes}
        locale={{ emptyText: t('reports.empty') }}
        columns={[
          { title: t('reports.fields.dish'), key: 'name', render: (_, r) => translate(r.name, i18n.language) || r.dishId },
          { title: t('reports.fields.quantity'), dataIndex: 'quantity', align: 'right' },
          { title: t('reports.fields.revenue'), key: 'revenue', align: 'right', render: (_, r) => money(r.revenue) },
        ]}
      />
    </>
  );
}

function DailyHistory({ onOpen }: { onOpen: (date: string) => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  const { params } = useReportContext();
  const { branchName } = useBranch();
  const [page, setPage] = useState({ page: 1, perPage: 20 });
  const query = useApiQuery(reportKeys.dailyHistory({ ...params, ...page }), () => reportsApi.dailyHistory(params, page.page, page.perPage), {
    keepPrevious: true,
  });
  return (
    <Card title={t('reports.daily.history')} style={{ marginTop: 16 }}>
      {query.error ? <ErrorAlert error={query.error} onRetry={() => void query.refetch()} /> : null}
      <Table<DailyReport>
        rowKey={(r) => r.id ?? `${r.date}:${r.branchId ?? 'all'}`}
        size="small"
        loading={query.isFetching}
        dataSource={query.data?.items ?? []}
        locale={{ emptyText: t('reports.daily.historyEmpty') }}
        scroll={{ x: 'max-content' }}
        pagination={{
          current: page.page,
          pageSize: page.perPage,
          total: query.data?.total ?? 0,
          onChange: (p, perPage) => setPage({ page: perPage === page.perPage ? p : 1, perPage }),
        }}
        columns={[
          { title: t('reports.fields.date'), dataIndex: 'date', render: (date: string) => <Typography.Link onClick={() => onOpen(date)}>{date}</Typography.Link> },
          { title: t('reports.fields.branch'), key: 'branch', render: (_, r) => (r.branchId ? branchName(r.branchId) : t('reports.scope.consolidatedShort')) },
          { title: t('reports.fields.total'), key: 'total', align: 'right', render: (_, r) => money(r.summary.revenue.total) },
          { title: t('reports.kpi.completedOrders'), key: 'orders', align: 'right', render: (_, r) => r.summary.orders.completed },
          { title: t('reports.daily.generatedAtShort'), key: 'generatedAt', render: (_, r) => formatDateTime(r.generatedAt) },
          { title: t('reports.daily.notifiedAtShort'), key: 'notifiedAt', render: (_, r) => formatDateTime(r.notifiedAt) },
          {
            key: 'file',
            render: (_, r) =>
              r.fileUrl ? (
                <Button size="small" icon={<DownloadOutlined />} href={r.fileUrl} target="_blank" rel="noreferrer">
                  XLSX
                </Button>
              ) : null,
          },
        ]}
      />
    </Card>
  );
}
