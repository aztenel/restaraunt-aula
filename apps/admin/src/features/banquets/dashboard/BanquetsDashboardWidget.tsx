import { CrownOutlined } from '@ant-design/icons';
import { Card, Col, Flex, Row, Statistic, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Permission } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useCan } from '@/shared/auth/useCan';
import { useBranch } from '@/shared/branch/BranchProvider';
import { dayjs } from '@/shared/lib/dates';
import { banquetsApi, banquetsKeys } from '../api';
import { todayLocal } from '../calendar-layout';
import { breachedCount, columnOf } from '../pipeline/pipeline-utils';
import { SlaShare } from '../sla/SlaShare';

/**
 * Виджет «Очередей»: новые банкетные заявки и просроченные (без ответа > 30 минут), доля ответов
 * за 30 минут и потерянные заявки за текущий месяц. Ключи 'banquets' обновляет лента событий.
 */
export function BanquetsDashboardWidget() {
  const { canSomewhere } = useCan();
  if (!canSomewhere(Permission.BanquetsView)) return null;
  return <BanquetsWidgetCard />;
}

function BanquetsWidgetCard() {
  const { t } = useTranslation();
  const { selectedBranchId } = useBranch();
  const today = todayLocal();
  const branch = selectedBranchId ? { branchId: selectedBranchId } : {};
  const pipelineParams = { ...branch };
  const slaParams = { from: dayjs(today).startOf('month').format('YYYY-MM-DD'), to: today, ...branch };
  const pipeline = useApiQuery(banquetsKeys.pipeline(pipelineParams), () => banquetsApi.pipeline(pipelineParams), { refetchInterval: 60_000 });
  const sla = useApiQuery(banquetsKeys.sla(slaParams), () => banquetsApi.sla(slaParams), { staleTime: 60_000 });
  const fresh = columnOf(pipeline.data, 'new');
  const breached = breachedCount(fresh);

  return (
    <Card
      title={
        <Flex gap={8} align="center">
          <CrownOutlined />
          {t('banquets.widget.title')}
        </Flex>
      }
      extra={<Link to="/banquets/pipeline">{t('banquets.widget.open')}</Link>}
      loading={pipeline.isLoading && sla.isLoading}
      style={{ marginTop: 16 }}
    >
      <Row gutter={[16, 16]} align="middle">
        <Col xs={12} md={6}>
          <Statistic title={t('banquets.widget.newCount')} value={fresh.count} valueStyle={fresh.count > 0 ? { color: '#b5452c' } : undefined} />
        </Col>
        <Col xs={12} md={6}>
          <Statistic title={t('banquets.widget.breachedNow')} value={breached} valueStyle={breached > 0 ? { color: '#b5452c' } : { color: '#2f7d4f' }} />
        </Col>
        <Col xs={12} md={6}>
          {sla.data ? (
            <Flex vertical align="center">
              <Typography.Text type="secondary">{t('banquets.widget.share')}</Typography.Text>
              <SlaShare stats={sla.data} size={72} />
            </Flex>
          ) : null}
        </Col>
        <Col xs={12} md={6}>
          <Tooltip title={t('banquets.sla.lostHint')}>
            <Statistic
              title={t('banquets.widget.lost')}
              value={sla.data?.lost ?? '—'}
              valueStyle={sla.data ? { color: sla.data.lost > 0 ? '#b5452c' : '#2f7d4f' } : undefined}
            />
          </Tooltip>
        </Col>
      </Row>
    </Card>
  );
}
