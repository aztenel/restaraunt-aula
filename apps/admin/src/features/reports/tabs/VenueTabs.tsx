/**
 * Залы и банкеты: загрузка залов по дням недели × тип места (тепловая таблица, одна шкала синего),
 * накладки броней (цель — 0); воронка банкетов — стадии, конверсия, доля ответов за 30 минут
 * против цели 95%, потерянные заявки и причины отмен.
 */
import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import { Alert, Col, Flex, Progress, Row, Table, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { translate } from '@aula/api-client';
import { useBranch } from '@/shared/branch/BranchProvider';
import { formatDateTime } from '@/shared/lib/dates';
import { reportsApi } from '../api';
import { banquetFunnelRows, GOAL_TARGETS, hallLoadMatrix, LOAD_RAMP, loadStep, loadTextColor, percent } from '../chart-data';
import { ReportCard, StatRow, useMoney, useReport, useReportContext } from '../report-ui';
import { WEEKDAYS, type HallLoadRow } from '../types';
import { FunnelBars } from './OrdersTabs';

// ---------------------------------------------------------------- загрузка залов

function LoadCell({ row, label }: { row: { load: number | null; bookedHours: number; openHours: number; reservations: number; guests: number } | undefined; label: string }) {
  const { t, i18n } = useTranslation();
  if (!row) return <div style={{ padding: '10px 8px', color: '#b5b3ad', textAlign: 'center' }}>—</div>;
  const step = loadStep(row.load);
  return (
    <Tooltip
      title={
        <div>
          <div>
            <strong>{label}</strong>
          </div>
          <div>{t('reports.hallLoad.hours', { booked: row.bookedHours, open: row.openHours })}</div>
          <div>{t('reports.hallLoad.reservations', { count: row.reservations, guests: row.guests })}</div>
        </div>
      }
    >
      <div
        style={{
          padding: '10px 8px',
          textAlign: 'center',
          background: step === null ? '#f3f1ec' : LOAD_RAMP[step],
          color: loadTextColor(step),
          borderRadius: 4,
          fontVariantNumeric: 'tabular-nums',
          fontWeight: 500,
        }}
      >
        {percent(row.load, i18n.language, 0)}
      </div>
    </Tooltip>
  );
}

export function HallLoadTab() {
  const { t, i18n } = useTranslation();
  const { branchName } = useBranch();
  const { params } = useReportContext();
  const query = useReport('hall-load', reportsApi.hallLoad);
  const data = query.data;
  const matrix = hallLoadMatrix(data?.rows ?? []);
  const weekdayTotals = new Map((data?.weekdays ?? []).map((w) => [w.weekday, w]));
  const tableRows = WEEKDAYS.map((weekday) => ({ weekday }));
  return (
    <ReportCard title={t('reports.tabs.hallLoad')} exportKey="hallLoad" query={query}>
      {data ? (
        <>
          {data.overbookingCount > 0 ? (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
              message={t('reports.hallLoad.overbookings', { count: data.overbookingCount })}
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {data.overbookings.slice(0, 10).map((o) => (
                    <li key={`${o.first.reservationId}-${o.second.reservationId}`}>
                      {params.branchId ? '' : `${branchName(o.branchId)} · `}
                      {o.venueTypeCode}:{' '}
                      <Link to={`/reservations/${o.first.reservationId}`}>{o.first.number}</Link> ({formatDateTime(o.first.start)}) ×{' '}
                      <Link to={`/reservations/${o.second.reservationId}`}>{o.second.number}</Link> ({formatDateTime(o.second.start)})
                    </li>
                  ))}
                </ul>
              }
            />
          ) : (
            <Alert type="success" showIcon style={{ marginBottom: 16 }} message={t('reports.hallLoad.noOverbookings')} />
          )}
          {matrix.types.length === 0 ? (
            <Typography.Text type="secondary">{t('reports.empty')}</Typography.Text>
          ) : (
            <Table
              rowKey="weekday"
              size="small"
              pagination={false}
              scroll={{ x: 'max-content' }}
              dataSource={tableRows}
              columns={[
                { title: t('reports.hallLoad.weekday'), dataIndex: 'weekday', width: 110, render: (d: string) => t(`weekdays.${d as (typeof WEEKDAYS)[number]}`) },
                ...matrix.types.map((type) => ({
                  title: translate(type.name, i18n.language) || type.code,
                  key: type.code,
                  width: 120,
                  render: (_: unknown, r: { weekday: (typeof WEEKDAYS)[number] }) => (
                    <LoadCell row={matrix.cells[r.weekday][type.code] as HallLoadRow | undefined} label={translate(type.name, i18n.language) || type.code} />
                  ),
                })),
                {
                  title: t('reports.hallLoad.allTypes'),
                  key: 'total',
                  width: 120,
                  render: (_: unknown, r: { weekday: (typeof WEEKDAYS)[number] }) => <LoadCell row={weekdayTotals.get(r.weekday)} label={t('reports.hallLoad.allTypes')} />,
                },
              ]}
            />
          )}
          <Flex gap={4} align="center" style={{ marginTop: 12, fontSize: 12, color: '#52514e' }} aria-hidden>
            <span>0%</span>
            {LOAD_RAMP.map((color) => (
              <span key={color} style={{ width: 24, height: 10, background: color, borderRadius: 2, display: 'inline-block' }} />
            ))}
            <span>100%</span>
            <span style={{ marginLeft: 12 }}>{t('reports.hallLoad.legend')}</span>
          </Flex>
        </>
      ) : null}
    </ReportCard>
  );
}

// ---------------------------------------------------------------- воронка банкетов

export function BanquetFunnelTab() {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const query = useReport('banquet-funnel', reportsApi.banquetFunnel);
  const data = query.data;
  const slaShare = data?.answeredWithinSlaShare ?? null;
  const slaMet = slaShare !== null && slaShare >= GOAL_TARGETS.banquetSla;
  return (
    <ReportCard title={t('reports.tabs.banquetFunnel')} exportKey="banquetFunnel" query={query}>
      {data ? (
        <>
          <StatRow
            stats={[
              { key: 'total', label: t('reports.banquets.total'), value: data.total },
              { key: 'held', label: t('reports.banquets.held'), value: `${data.held} · ${money(data.heldTotal)}` },
              { key: 'conv', label: t('reports.banquets.conversion'), value: percent(data.conversion, i18n.language), hint: t('reports.banquets.conversionHint') },
              {
                key: 'lost',
                label: t('reports.banquets.lost'),
                value: (
                  <span style={{ color: data.lost > 0 ? '#b5452c' : undefined }}>
                    {data.lost}
                  </span>
                ),
                hint: t('reports.banquets.lostHint'),
              },
            ]}
          />
          <Row gutter={[24, 24]}>
            <Col xs={24} lg={12}>
              <Typography.Title level={5}>{t('reports.banquets.funnel')}</Typography.Title>
              <FunnelBars
                rows={banquetFunnelRows(data.stages)}
                label={(key) => t(`reports.banquets.stages.${key}`)}
                extra={(row) => {
                  const current = data.stages.find((s) => s.status === row.key)?.current ?? 0;
                  return current > 0 ? <Typography.Text type="secondary"> · {t('reports.banquets.current', { count: current })}</Typography.Text> : null;
                }}
              />
            </Col>
            <Col xs={24} lg={12}>
              <Typography.Title level={5}>{t('reports.banquets.sla', { minutes: data.slaMinutes })}</Typography.Title>
              <Flex align="center" gap={16}>
                <Progress
                  type="dashboard"
                  percent={Math.round((slaShare ?? 0) * 1000) / 10}
                  strokeColor={slaMet ? '#2f7d4f' : '#c8962e'}
                  format={() => percent(slaShare, i18n.language)}
                />
                <div>
                  <div>
                    {slaShare === null ? (
                      <Typography.Text type="secondary">{t('reports.goals.noData')}</Typography.Text>
                    ) : slaMet ? (
                      <Typography.Text type="success">
                        <CheckCircleFilled /> {t('reports.goals.statuses.met')}
                      </Typography.Text>
                    ) : (
                      <Typography.Text type="warning">
                        <CloseCircleFilled /> {t('reports.goals.statuses.not_met')}
                      </Typography.Text>
                    )}
                  </div>
                  <Typography.Text type="secondary">{t('reports.banquets.slaTarget', { value: percent(GOAL_TARGETS.banquetSla, i18n.language) })}</Typography.Text>
                  <div>{t('reports.banquets.answered', { answered: data.answeredWithinSla, due: data.answerDue })}</div>
                  <div>{t('reports.banquets.unansweredOverdue', { count: data.unansweredOverdue })}</div>
                  <div>
                    {t('reports.banquets.responseTime', {
                      avg: data.averageFirstResponseMinutes ?? '—',
                      median: data.medianFirstResponseMinutes ?? '—',
                    })}
                  </div>
                </div>
              </Flex>
              <Typography.Title level={5} style={{ marginTop: 16 }}>
                {t('reports.banquets.cancelReasons', { cancelled: data.cancelled, before: data.cancelledBeforeAgreement })}
              </Typography.Title>
              <Table
                rowKey="reason"
                size="small"
                pagination={false}
                dataSource={data.cancelReasons}
                locale={{ emptyText: t('reports.empty') }}
                columns={[
                  { title: t('reports.cancelled.reason'), dataIndex: 'reason' },
                  { title: t('reports.cancelled.count'), dataIndex: 'count', align: 'right' },
                ]}
              />
            </Col>
          </Row>
        </>
      ) : null}
    </ReportCard>
  );
}
