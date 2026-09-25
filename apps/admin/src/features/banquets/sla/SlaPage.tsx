import { Card, Col, DatePicker, Empty, Flex, Row, Space, Statistic, Table, Tooltip, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/shared/api/hooks';
import { useBranch } from '@/shared/branch/BranchProvider';
import { dayjs } from '@/shared/lib/dates';
import { BranchSelect } from '@/shared/ui/BranchSelect';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { banquetsApi, banquetsKeys } from '../api';
import { todayLocal } from '../calendar-layout';
import { bpToPercentText, slaShareTone } from '../sla';
import { SlaShare, TONE_COLORS } from './SlaShare';
import type { BanquetManager, ManagerSla } from '../types';

/** SLA первого ответа (цель 95% за 30 минут, ноль потерянных) и нагрузка менеджеров. */
export function SlaPage() {
  const { t, i18n } = useTranslation();
  const { selectedBranchId, canSelectAll } = useBranch();
  const today = todayLocal();
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs(today).startOf('month'), dayjs(today)]);
  const [branchId, setBranchId] = useState<string | null>(selectedBranchId);
  useEffect(() => setBranchId(selectedBranchId), [selectedBranchId]);

  const params = { from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD'), ...(branchId ? { branchId } : {}) };
  const stats = useApiQuery(banquetsKeys.sla(params), () => banquetsApi.sla(params), { keepPrevious: true });
  const managers = useApiQuery(banquetsKeys.managers, banquetsApi.managers);
  const data = stats.data;
  const minutes = (value: number | null) => (value === null ? '—' : t('banquets.sla.minutes', { count: value }));

  return (
    <>
      <Flex justify="space-between" gap={12} wrap style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={0}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t('banquets.sla.title')}
          </Typography.Title>
          <Typography.Text type="secondary">{t('banquets.sla.subtitle')}</Typography.Text>
        </Space>
        <Space wrap>
          <BranchSelect allowAll={canSelectAll} value={branchId} onChange={setBranchId} style={{ width: 200 }} />
          <DatePicker.RangePicker
            format="DD.MM.YYYY"
            allowClear={false}
            value={range}
            onChange={(next) => {
              if (next?.[0] && next[1]) setRange([next[0], next[1]]);
            }}
            aria-label={t('banquets.sla.period')}
          />
        </Space>
      </Flex>
      {stats.error ? <ErrorAlert error={stats.error} onRetry={() => void stats.refetch()} /> : null}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8} xl={6}>
          <Card size="small" title={t('banquets.sla.share')} loading={stats.isLoading} style={{ height: '100%' }}>
            {data ? <SlaShare stats={data} /> : null}
          </Card>
        </Col>
        <Col xs={24} md={16} xl={18}>
          <Card size="small" loading={stats.isLoading} style={{ height: '100%' }}>
            {data ? (
              <Row gutter={[16, 16]}>
                <Col xs={12} sm={8} lg={6}>
                  <Statistic title={t('banquets.sla.total')} value={data.total} />
                </Col>
                <Col xs={12} sm={8} lg={6}>
                  <Statistic title={t('banquets.sla.answeredCount')} value={data.answered} />
                </Col>
                <Col xs={12} sm={8} lg={6}>
                  <Statistic title={t('banquets.sla.within')} value={data.answeredWithinSla} valueStyle={{ color: TONE_COLORS.success }} />
                </Col>
                <Col xs={12} sm={8} lg={6}>
                  <Statistic title={t('banquets.sla.breachedCount')} value={data.breached} valueStyle={data.breached > 0 ? { color: TONE_COLORS.danger } : undefined} />
                </Col>
                <Col xs={12} sm={8} lg={6}>
                  <Statistic title={t('banquets.sla.unanswered')} value={data.unanswered} />
                </Col>
                <Col xs={12} sm={8} lg={6}>
                  <Tooltip title={t('banquets.sla.lostHint')}>
                    <Statistic title={t('banquets.sla.lost')} value={data.lost} valueStyle={{ color: data.lost > 0 ? TONE_COLORS.danger : TONE_COLORS.success }} />
                  </Tooltip>
                </Col>
                <Col xs={24} sm={16} lg={12}>
                  <Statistic title={t('banquets.sla.avgResponse')} value={minutes(data.averageFirstResponseMinutes)} />
                </Col>
              </Row>
            ) : null}
          </Card>
        </Col>
        <Col xs={24} xl={14}>
          <Card size="small" title={t('banquets.sla.byManager')}>
            <Table<ManagerSla>
              size="small"
              rowKey="managerId"
              pagination={false}
              loading={stats.isFetching}
              dataSource={data?.byManager ?? []}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('banquets.sla.noData')} /> }}
              scroll={{ x: 'max-content' }}
              columns={[
                { title: t('banquets.common.manager'), dataIndex: 'managerName' },
                { title: t('banquets.sla.total'), dataIndex: 'total', align: 'right' },
                {
                  title: t('banquets.sla.share'),
                  dataIndex: 'withinSlaShareBp',
                  align: 'right',
                  render: (bp: number | null) => (
                    <Typography.Text style={{ color: TONE_COLORS[slaShareTone(bp, data?.targetShareBp ?? 9500)] }}>
                      {bp === null ? '—' : `${bpToPercentText(bp, i18n.language)}%`}
                    </Typography.Text>
                  ),
                },
                { title: t('banquets.sla.breachedCount'), dataIndex: 'breached', align: 'right' },
                {
                  title: t('banquets.sla.lost'),
                  dataIndex: 'lost',
                  align: 'right',
                  render: (v: number) => <Typography.Text type={v > 0 ? 'danger' : undefined}>{v}</Typography.Text>,
                },
                { title: t('banquets.sla.avgResponse'), dataIndex: 'averageFirstResponseMinutes', align: 'right', render: (v: number | null) => minutes(v) },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card size="small" title={t('banquets.sla.managers')} extra={<Typography.Text type="secondary">{t('banquets.sla.load')}</Typography.Text>}>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              {t('banquets.sla.managersHint')}
            </Typography.Paragraph>
            {managers.error ? <ErrorAlert error={managers.error} onRetry={() => void managers.refetch()} /> : null}
            <Table<BanquetManager>
              size="small"
              rowKey="id"
              pagination={false}
              loading={managers.isLoading}
              dataSource={[...(managers.data ?? [])].sort((a, b) => b.openRequests - a.openRequests)}
              columns={[
                {
                  title: t('banquets.common.manager'),
                  dataIndex: 'name',
                  render: (name: string, m) => (
                    <Space direction="vertical" size={0}>
                      <span>{name}</span>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {[m.phone, m.email].filter(Boolean).join(' · ')}
                      </Typography.Text>
                    </Space>
                  ),
                },
                { title: t('banquets.sla.load'), dataIndex: 'openRequests', align: 'right', render: (v: number) => <Typography.Text strong>{v}</Typography.Text> },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}
