/**
 * Измеримые цели ТЗ за период: доля заказов мимо агрегаторов (цель уточняется), ответ на банкетную заявку
 * за 30 минут (95%), потерянные заявки (0), накладки по залам (0), дневной отчёт — автоматически.
 * Статус — значок и подпись, не только цвет.
 */
import { CheckCircleFilled, CloseCircleFilled, MinusCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { Table, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { reportsApi } from '../api';
import { goalRows, percent, type GoalRow, type GoalStatus } from '../chart-data';
import { ReportCard, useReport } from '../report-ui';

const STATUS_TAG: Record<GoalStatus, { color: string; icon: ReactNode }> = {
  met: { color: 'success', icon: <CheckCircleFilled /> },
  not_met: { color: 'error', icon: <CloseCircleFilled /> },
  no_target: { color: 'default', icon: <QuestionCircleOutlined /> },
  no_data: { color: 'default', icon: <MinusCircleOutlined /> },
};

export function GoalsTab() {
  const { t, i18n } = useTranslation();
  const query = useReport('goals', reportsApi.goals);
  const data = query.data;

  const valueText = (row: GoalRow) => {
    if (row.value === null) return '—';
    if (row.kind === 'ratio') return percent(row.value, i18n.language);
    if (row.kind === 'progress') return t('reports.goals.progress', { done: row.value, expected: row.expected ?? 0 });
    return String(row.value);
  };
  const targetText = (row: GoalRow) => {
    if (row.key === 'ownChannel') return t('reports.goals.targetTbd');
    if (row.key === 'dailyReports') return t('reports.goals.targetAutomatic');
    if (row.kind === 'ratio' && row.target !== null) return `≥ ${percent(row.target, i18n.language)}`;
    return String(row.target ?? '—');
  };

  return (
    <ReportCard title={t('reports.tabs.goals')} exportKey="goals" query={query}>
      {data ? (
        <>
          <Table<GoalRow>
            rowKey="key"
            size="middle"
            pagination={false}
            dataSource={goalRows(data)}
            columns={[
              {
                title: t('reports.goals.goal'),
                key: 'goal',
                render: (_, row) => (
                  <div>
                    <Typography.Text strong>{t(`reports.goals.names.${row.key}`)}</Typography.Text>
                    <div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {t(`reports.goals.metrics.${row.key}`)}
                      </Typography.Text>
                    </div>
                  </div>
                ),
              },
              { title: t('reports.goals.value'), key: 'value', align: 'right', render: (_, row) => <strong>{valueText(row)}</strong> },
              { title: t('reports.goals.target'), key: 'target', align: 'right', render: (_, row) => targetText(row) },
              {
                title: t('reports.goals.status'),
                key: 'status',
                render: (_, row) => (
                  <Tag color={STATUS_TAG[row.status].color} icon={STATUS_TAG[row.status].icon}>
                    {t(`reports.goals.statuses.${row.status}`)}
                  </Tag>
                ),
              },
            ]}
          />
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
            {t('reports.goals.details', {
              own: data.ownOrders,
              aggregators: data.aggregatorOrders ?? '—',
              banquets: data.banquetRequests,
            })}
          </Typography.Paragraph>
        </>
      ) : null}
    </ReportCard>
  );
}
