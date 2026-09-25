/**
 * Виджет «Очереди» для стартового экрана: сколько броней ждут подтверждения, депозита и отметки прихода
 * в выбранном филиале, ближайшие к автоматическому снятию — с отсчётом. Новые брони из ленты подсвечиваются.
 * Данные — те же запросы очередей (ключи 'reservations' обновляет лента событий).
 */
import { Badge, Card, Col, Empty, Flex, Row, Space, Statistic, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Permission } from '@aula/api-client';
import { useCan } from '@/shared/auth/useCan';
import { useBranch } from '@/shared/branch/BranchProvider';
import { formatLocalDate, venueTitle } from './format';
import { byHoldExpiry } from './hold-countdown';
import { useNewReservations } from './hooks';
import { HoldCountdownTag } from './parts';
import { QUEUE_KINDS, useReservationQueues } from './QueueView';
import './reservations.css';

const SOONEST_LIMIT = 5;

export function ReservationsQueueWidget() {
  const { canSomewhere } = useCan();
  if (!canSomewhere(Permission.ReservationsView)) return null;
  return <Widget />;
}

function Widget() {
  const { t, i18n } = useTranslation();
  const { selectedBranchId, branchName } = useBranch();
  const queues = useReservationQueues(selectedBranchId);
  const news = useNewReservations();
  const holds = [...(queues.pending.data?.items ?? []), ...(queues.awaiting_deposit.data?.items ?? [])].sort(byHoldExpiry).slice(0, SOONEST_LIMIT);
  const total = QUEUE_KINDS.reduce((sum, kind) => sum + (queues[kind].data?.total ?? 0), 0);
  const loaded = QUEUE_KINDS.every((kind) => queues[kind].data !== undefined);

  return (
    <Card
      style={{ marginTop: 16 }}
      title={
        <Space>
          {t('reservations.widget.title')}
          {news.count > 0 ? <Badge count={news.count} title={t('reservations.newCount', { count: news.count })} /> : null}
        </Space>
      }
      extra={<Link to="/reservations/queue">{t('reservations.widget.open')}</Link>}
    >
      <Row gutter={[16, 16]}>
        {QUEUE_KINDS.map((kind) => (
          <Col key={kind} xs={24} sm={8}>
            <Link to="/reservations/queue">
              <Statistic
                title={t(`reservations.queue.${kind}`)}
                value={queues[kind].data?.total ?? 0}
                loading={queues[kind].isLoading}
                valueStyle={{ color: (queues[kind].data?.total ?? 0) > 0 ? (kind === 'needs_mark' ? '#cf1322' : '#b45309') : undefined }}
              />
            </Link>
          </Col>
        ))}
      </Row>
      {loaded && total === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('reservations.widget.empty')} /> : null}
      {holds.length > 0 ? (
        <>
          <Typography.Text strong style={{ display: 'block', margin: '16px 0 8px' }}>
            {t('reservations.widget.soonest')}
          </Typography.Text>
          <Flex vertical gap={6}>
            {holds.map((r) => (
              <Link key={r.id} to={`/reservations/queue?open=${r.id}`}>
                <Flex
                  className={`rsv-queue-card${news.newIds.has(r.id) ? ' rsv-new' : ''}`}
                  justify="space-between"
                  align="center"
                  gap={8}
                  wrap
                >
                  <Space size={6} wrap>
                    <Typography.Text strong>{r.number}</Typography.Text>
                    {news.newIds.has(r.id) ? <Tag color="volcano">{t('reservations.newTag')}</Tag> : null}
                    <Typography.Text type="secondary">
                      {formatLocalDate(r.date, 'DD.MM')} {r.time} · {venueTitle(r.venue, i18n.language)} ·{' '}
                      {t('reservations.guestsCount', { count: r.guests })}
                      {!selectedBranchId ? ` · ${branchName(r.branchId)}` : ''}
                    </Typography.Text>
                  </Space>
                  <HoldCountdownTag holdExpiresAt={r.holdExpiresAt} />
                </Flex>
              </Link>
            ))}
          </Flex>
        </>
      ) : null}
    </Card>
  );
}
