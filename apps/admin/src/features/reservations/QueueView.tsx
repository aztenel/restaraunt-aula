/**
 * Очереди оператора: ждут подтверждения (места с ручным подтверждением), ждут депозит (онлайн-оплата)
 * — с отсчётом до автоматического снятия; требуют отметки «пришли / не пришли». Новые брони из ленты
 * подсвечиваются до просмотра. Действия — в карточке брони (разрешённые переходы отдаёт сервер).
 */
import { Badge, Card, Col, Empty, Flex, Row, Space, Tag, Typography } from 'antd';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ApiError, Page } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useBranch } from '@/shared/branch/BranchProvider';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { queueQuery, reservationKeys, reservationsApi, type QueueKind } from './api';
import { formatInTz, formatLocalDate, venueTitle } from './format';
import { byHoldExpiry } from './hold-countdown';
import { useReservationsUi } from './hooks';
import { DepositTag, HoldCountdownTag } from './parts';
import type { ReservationSummary } from './types';

export const QUEUE_KINDS: QueueKind[] = ['pending', 'awaiting_deposit', 'needs_mark'];
const QUEUE_PAGE = 50;

export type QueueQueries = Record<QueueKind, UseQueryResult<Page<ReservationSummary>, ApiError>>;

/** Три очереди броней филиала (или всех доступных филиалов); обновляются лентой событий и раз в минуту. */
export function useReservationQueues(branchId: string | null, enabled = true): QueueQueries {
  const options = { enabled, refetchInterval: 60_000 };
  const pending = useApiQuery(reservationKeys.queue(branchId, 'pending'), () => reservationsApi.list(queueQuery(branchId, 'pending', QUEUE_PAGE)), options);
  const awaiting = useApiQuery(
    reservationKeys.queue(branchId, 'awaiting_deposit'),
    () => reservationsApi.list(queueQuery(branchId, 'awaiting_deposit', QUEUE_PAGE)),
    options,
  );
  const needsMark = useApiQuery(
    reservationKeys.queue(branchId, 'needs_mark'),
    () => reservationsApi.list(queueQuery(branchId, 'needs_mark', QUEUE_PAGE)),
    options,
  );
  return { pending, awaiting_deposit: awaiting, needs_mark: needsMark };
}

export function QueueView({ queues }: { queues: QueueQueries }) {
  return (
    <Row gutter={[16, 16]}>
      {QUEUE_KINDS.map((kind) => (
        <Col key={kind} xs={24} lg={8}>
          <QueueColumn kind={kind} query={queues[kind]} />
        </Col>
      ))}
    </Row>
  );
}

function QueueColumn({ kind, query }: { kind: QueueKind; query: QueueQueries[QueueKind] }) {
  const { t } = useTranslation();
  const items = [...(query.data?.items ?? [])];
  if (kind === 'needs_mark') items.sort((a, b) => a.start.localeCompare(b.start));
  else items.sort(byHoldExpiry);
  const total = query.data?.total ?? 0;
  return (
    <Card
      size="small"
      title={
        <Space>
          {t(`reservations.queue.${kind}`)}
          <Badge count={total} showZero color={total > 0 ? (kind === 'needs_mark' ? '#cf1322' : '#d97706') : '#bfbfbf'} />
        </Space>
      }
      styles={{ body: { padding: 12 } }}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
        {t(`reservations.queue.${kind}Hint`)}
      </Typography.Paragraph>
      {query.error ? <ErrorAlert error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data && items.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('reservations.queue.empty')} /> : null}
      <Flex vertical gap={8}>
        {items.map((r) => (
          <QueueCard key={r.id} reservation={r} kind={kind} />
        ))}
      </Flex>
      {total > items.length ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          {t('reservations.queue.more', { shown: items.length, total })}
        </Typography.Text>
      ) : null}
    </Card>
  );
}

function QueueCard({ reservation: r, kind }: { reservation: ReservationSummary; kind: QueueKind }) {
  const { t, i18n } = useTranslation();
  const { selectedBranchId, branchName, getBranch } = useBranch();
  const ui = useReservationsUi();
  const tz = getBranch(r.branchId)?.timezone ?? 'Asia/Almaty';
  const isNew = ui.newIds.has(r.id);
  const open = () => ui.openReservation(r.id);
  return (
    <div
      className={`rsv-queue-card${isNew ? ' rsv-new' : ''}`}
      role="button"
      tabIndex={0}
      title={t('reservations.queue.openHint')}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
    >
      <Flex justify="space-between" align="flex-start" gap={8}>
        <Space size={4} wrap>
          <Typography.Text strong>{r.number}</Typography.Text>
          {isNew ? <Tag color="volcano">{t('reservations.newTag')}</Tag> : null}
        </Space>
        <Typography.Text strong style={{ whiteSpace: 'nowrap' }}>
          {formatLocalDate(r.date, 'DD.MM')} {r.time}
        </Typography.Text>
      </Flex>
      <div style={{ fontSize: 13 }}>
        {venueTitle(r.venue, i18n.language)} · {t('reservations.guestsCount', { count: r.guests })}
        {!selectedBranchId ? <Typography.Text type="secondary"> · {branchName(r.branchId)}</Typography.Text> : null}
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {[r.customer.name, r.customer.phone].filter(Boolean).join(' · ') || '—'}
      </Typography.Text>
      <Flex gap={6} wrap style={{ marginTop: 6 }}>
        {kind === 'needs_mark' ? (
          <Tag color="red">{t('reservations.queue.started', { time: formatInTz(r.start, tz, 'HH:mm') })}</Tag>
        ) : (
          <HoldCountdownTag holdExpiresAt={r.holdExpiresAt} />
        )}
        {r.deposit ? <DepositTag state={r.depositState} amount={r.deposit} /> : null}
      </Flex>
    </div>
  );
}
