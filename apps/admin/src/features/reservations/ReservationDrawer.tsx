/**
 * Карточка брони: время и место, гость и контакты, депозит и платёж (с объяснением правила отмены
 * по данным сервера), правила брони, история. Кнопки — только разрешённые сервером переходы
 * (allowedTransitions, canReschedule) и при праве reservations.manage в филиале брони.
 */
import {
  CalendarOutlined,
  CopyOutlined,
  CrownOutlined,
  LinkOutlined,
  MessageOutlined,
  PhoneOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Flex,
  Popconfirm,
  Space,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { formatMoney, Permission, translate } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { useCan } from '@/shared/auth/useCan';
import { tx } from '@/shared/i18n/tx';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageLoader } from '@/shared/ui/PageLoader';
import { StatusTag } from '@/shared/ui/StatusTag';
import { reservationKeys, reservationsApi } from './api';
import { formatInTz, formatLocalDate, telLink, venueTitle, whatsappLink } from './format';
import { holdCountdown } from './hold-countdown';
import { useBranchTimezone, useNow } from './hooks';
import { DepositTag, KindTag } from './parts';
import { cancelDepositPolicy, reservationActions, type ReservationActionKey } from './reservation-actions';
import { CancelReservationModal, RescheduleModal, useApplyDetail, WaiveDepositModal } from './ReservationDialogs';
import type { ReservationDetail } from './types';

type Dialog = 'cancel' | 'waive' | 'reschedule' | null;

export function ReservationDrawer({ id, onClose, onViewed }: { id: string | null; onClose: () => void; onViewed?: (id: string) => void }) {
  const { t } = useTranslation();
  const detail = useApiQuery(reservationKeys.detail(id ?? ''), () => reservationsApi.get(id!), { enabled: Boolean(id) });
  const data = detail.data?.id === id ? detail.data : undefined;

  useEffect(() => {
    if (id) onViewed?.(id);
  }, [id, onViewed]);

  return (
    <Drawer
      open={Boolean(id)}
      onClose={onClose}
      width={640}
      destroyOnHidden
      title={
        data ? (
          <Space wrap size={6}>
            <span>{t('reservations.detail.title', { number: data.number })}</span>
            <StatusTag domain="reservation" status={data.status} />
            <KindTag kind={data.kind} />
          </Space>
        ) : (
          t('reservations.detail.title', { number: '' })
        )
      }
    >
      {detail.error ? <ErrorAlert error={detail.error} onRetry={() => void detail.refetch()} /> : null}
      {!data && detail.isLoading ? <PageLoader /> : null}
      {data ? <ReservationCard reservation={data} onClose={onClose} /> : null}
    </Drawer>
  );
}

function ReservationCard({ reservation: r, onClose }: { reservation: ReservationDetail; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const notifyError = useNotifyError();
  const { can } = useCan();
  const tz = useBranchTimezone(r.branchId);
  const now = useNow(1000);
  const apply = useApplyDetail();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<ReservationActionKey | null>(null);
  const canManage = can(Permission.ReservationsManage, r.branchId);
  const actions = reservationActions(r, canManage);
  const countdown = r.status === 'pending' || r.status === 'awaiting_deposit' ? holdCountdown(r.holdExpiresAt, now) : null;
  const policy = cancelDepositPolicy(r);
  const deadline = formatInTz(r.cancellationDeadline, tz);

  const done = (key: ReservationActionKey) => (next: ReservationDetail) => {
    apply(next);
    setDialog(null);
    void message.success(t(`reservations.actions.done.${key}`));
  };

  const run = async (key: 'confirm' | 'arrived' | 'noShow') => {
    setBusy(key);
    try {
      const next =
        key === 'confirm' ? await reservationsApi.confirm(r.id) : key === 'arrived' ? await reservationsApi.arrived(r.id) : await reservationsApi.noShow(r.id);
      done(key)(next);
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(null);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      void message.success(t('reservations.detail.copied'));
    } catch {
      void message.info(text);
    }
  };

  const showOnTimeline = () => {
    onClose();
    navigate(`/reservations/day?date=${r.date}`);
  };

  return (
    <>
      {actions.length > 0 ? (
        <Flex gap={8} wrap style={{ marginBottom: 16 }}>
          {actions.map((action) => {
            const label = t(`reservations.actions.${action.key}`);
            const buttonProps = {
              type: action.emphasis === 'primary' ? ('primary' as const) : ('default' as const),
              danger: action.emphasis === 'danger',
              loading: busy === action.key,
            };
            if (action.key === 'cancel') return <Button key={action.key} {...buttonProps} onClick={() => setDialog('cancel')}>{label}</Button>;
            if (action.key === 'confirmWaive') return <Button key={action.key} {...buttonProps} onClick={() => setDialog('waive')}>{label}</Button>;
            if (action.key === 'reschedule') return <Button key={action.key} {...buttonProps} onClick={() => setDialog('reschedule')}>{label}</Button>;
            const key = action.key;
            const question =
              key === 'confirm'
                ? t('reservations.actions.confirmQuestion')
                : key === 'arrived'
                  ? t('reservations.actions.arrivedQuestion')
                  : t('reservations.actions.noShowQuestion');
            const depositNote =
              r.depositState === 'paid' ? (key === 'arrived' ? t('reservations.actions.arrivedDeposit') : key === 'noShow' ? t('reservations.actions.noShowDeposit') : null) : null;
            return (
              <Popconfirm
                key={key}
                title={question}
                description={depositNote}
                okText={label}
                cancelText={t('common.cancel')}
                onConfirm={() => run(key)}
              >
                <Button {...buttonProps}>{label}</Button>
              </Popconfirm>
            );
          })}
        </Flex>
      ) : null}

      {r.kind === 'banquet' ? (
        <Alert
          type="info"
          showIcon
          icon={<CrownOutlined />}
          style={{ marginBottom: 16 }}
          message={t('reservations.detail.banquetHold')}
          action={
            <Button size="small" onClick={() => navigate(r.banquetRequestId ? `/banquets/${r.banquetRequestId}` : '/banquets')}>
              {t('reservations.detail.openBanquet')}
            </Button>
          }
        />
      ) : null}
      {r.needsMark ? <Alert type="error" showIcon style={{ marginBottom: 16 }} message={t('reservations.detail.needsMark')} /> : null}
      {countdown ? (
        <Alert
          type={countdown.urgency === 'critical' || countdown.urgency === 'expired' ? 'error' : 'warning'}
          showIcon
          style={{ marginBottom: 16 }}
          message={
            countdown.urgency === 'expired'
              ? t('reservations.detail.holdExpired')
              : r.status === 'pending'
                ? t('reservations.detail.holdPending', { time: countdown.text })
                : t('reservations.detail.holdDeposit', { time: countdown.text })
          }
        />
      ) : null}

      <Descriptions size="small" column={1} bordered>
        <Descriptions.Item label={t('reservations.fields.when')}>
          <Space direction="vertical" size={0}>
            <Typography.Text strong>
              {formatLocalDate(r.date)}, {r.time}–{formatInTz(r.end, tz, 'HH:mm')}
            </Typography.Text>
            <Typography.Text type="secondary">
              {t('reservations.minutes', { count: r.durationMinutes })}
              {r.blockedUntil !== r.end ? ` · ${t('reservations.detail.ruleCleanup')} ${t('reservations.minutes', { count: r.rules.cleanupMinutes })}` : ''}
            </Typography.Text>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label={t('reservations.detail.where')}>
          <Space direction="vertical" size={0}>
            <span>{venueTitle(r.venue, i18n.language)}</span>
            <Typography.Text type="secondary">
              {translate(r.venue.hallName, i18n.language)} · {translate(r.venue.typeName, i18n.language)}
            </Typography.Text>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label={t('reservations.fields.guests')}>{r.guests}</Descriptions.Item>
        <Descriptions.Item label={t('reservations.fields.source')}>
          {t(`reservations.sources.${r.source}`)} · {t('reservations.detail.created')} {formatInTz(r.createdAt, tz)}
        </Descriptions.Item>
        {r.occasion ? <Descriptions.Item label={t('reservations.fields.occasion')}>{r.occasion}</Descriptions.Item> : null}
        {r.comment ? <Descriptions.Item label={t('reservations.fields.comment')}>{r.comment}</Descriptions.Item> : null}
        {r.note ? <Descriptions.Item label={t('reservations.fields.note')}>{r.note}</Descriptions.Item> : null}
      </Descriptions>
      <Button type="link" icon={<CalendarOutlined />} onClick={showOnTimeline} style={{ paddingInline: 0 }}>
        {t('reservations.detail.showOnTimeline')}
      </Button>

      <Divider orientation="left" plain>
        {t('reservations.detail.guest')}
      </Divider>
      <Descriptions size="small" column={1}>
        <Descriptions.Item label={t('reservations.fields.name')}>
          <Space size={6} wrap>
            {r.customer.name ?? '—'}
            {r.customer.id ? <Tag color="blue">{t('reservations.detail.inBase')}</Tag> : null}
          </Space>
        </Descriptions.Item>
        {r.customer.phone ? (
          <Descriptions.Item label={t('reservations.fields.phone')}>
            <Space size={4} wrap>
              <Typography.Text copyable>{r.customer.phone}</Typography.Text>
              <Button size="small" icon={<PhoneOutlined />} href={telLink(r.customer.phone)}>
                {t('reservations.detail.call')}
              </Button>
              <Button size="small" icon={<MessageOutlined />} href={whatsappLink(r.customer.phone)} target="_blank" rel="noreferrer">
                {t('reservations.detail.whatsapp')}
              </Button>
            </Space>
          </Descriptions.Item>
        ) : null}
        {r.customer.email ? (
          <Descriptions.Item label={t('reservations.fields.email')}>
            <Typography.Link href={`mailto:${r.customer.email}`}>{r.customer.email}</Typography.Link>
          </Descriptions.Item>
        ) : null}
        {r.manageUrl ? (
          <Descriptions.Item label={t('reservations.detail.guestPage')}>
            <Space size={4}>
              <Typography.Link href={r.manageUrl} target="_blank" rel="noreferrer">
                <LinkOutlined /> {t('reservations.detail.guestPage')}
              </Typography.Link>
              <Button size="small" type="text" icon={<CopyOutlined />} aria-label={t('reservations.detail.copy')} onClick={() => void copy(r.manageUrl!)} />
            </Space>
          </Descriptions.Item>
        ) : null}
      </Descriptions>

      <Divider orientation="left" plain>
        {t('reservations.detail.depositBlock')}
      </Divider>
      <Descriptions size="small" column={1}>
        <Descriptions.Item label={t('reservations.fields.deposit')}>
          <DepositTag state={r.depositState} amount={r.deposit} />
        </Descriptions.Item>
        {r.depositOutcome !== 'none' ? (
          <Descriptions.Item label={t('reservations.detail.outcome')}>{tx(t, `reservations.depositOutcomes.${r.depositOutcome}`, r.depositOutcome)}</Descriptions.Item>
        ) : null}
        {r.depositWaiveReason ? <Descriptions.Item label={t('reservations.detail.waiveReason')}>{r.depositWaiveReason}</Descriptions.Item> : null}
        {r.depositPayment ? (
          <Descriptions.Item label={t('reservations.detail.payment')}>
            <Space direction="vertical" size={2}>
              <Space size={6} wrap>
                <StatusTag domain="payment" status={r.depositPayment.status} />
                <span>{formatMoney(r.depositPayment.amount, i18n.language)}</span>
                {r.depositPayment.refundedAmount.amount > 0 ? (
                  <Typography.Text type="secondary">
                    {t('reservations.detail.refunded')}: {formatMoney(r.depositPayment.refundedAmount, i18n.language)}
                  </Typography.Text>
                ) : null}
              </Space>
              {r.depositPayment.paidAt ? (
                <Typography.Text type="secondary">
                  {t('reservations.detail.paidAt')}: {formatInTz(r.depositPayment.paidAt, tz)}
                </Typography.Text>
              ) : null}
              {r.depositPayment.paymentUrl && r.depositState === 'pending' ? (
                <Space size={4}>
                  <Typography.Link href={r.depositPayment.paymentUrl} target="_blank" rel="noreferrer">
                    <LinkOutlined /> {t('reservations.detail.paymentLink')}
                  </Typography.Link>
                  <Button
                    size="small"
                    type="text"
                    icon={<CopyOutlined />}
                    aria-label={t('reservations.detail.copy')}
                    onClick={() => void copy(r.depositPayment!.paymentUrl!)}
                  />
                </Space>
              ) : null}
            </Space>
          </Descriptions.Item>
        ) : null}
      </Descriptions>
      {r.status === 'pending' || r.status === 'awaiting_deposit' || r.status === 'confirmed' ? (
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          {policy.case === 'paid'
            ? policy.beforeDeadline
              ? t('reservations.detail.policyBefore', { deadline, hours: policy.deadlineHours })
              : t('reservations.detail.policyAfter', { deadline, hours: policy.deadlineHours })
            : t('reservations.detail.policyGeneric', { deadline, hours: policy.deadlineHours })}
        </Typography.Paragraph>
      ) : null}

      <Divider orientation="left" plain>
        {t('reservations.detail.rules')}
      </Divider>
      <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label={t('reservations.detail.ruleHold')}>{t('reservations.minutes', { count: r.rules.holdMinutes })}</Descriptions.Item>
        <Descriptions.Item label={t('reservations.detail.ruleCancel')}>{t('reservations.hours', { count: r.rules.cancellationDeadlineHours })}</Descriptions.Item>
        <Descriptions.Item label={t('reservations.detail.ruleCleanup')}>{t('reservations.minutes', { count: r.rules.cleanupMinutes })}</Descriptions.Item>
        <Descriptions.Item label={t('reservations.detail.ruleManual')}>
          {r.rules.requiresManualConfirmation ? t('reservations.detail.yes') : t('reservations.detail.no')}
        </Descriptions.Item>
      </Descriptions>

      <Divider orientation="left" plain>
        {t('reservations.detail.history')}
      </Divider>
      <Timestamps reservation={r} tz={tz} />
      {r.history.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Timeline
          style={{ marginTop: 12 }}
          items={r.history.map((h, index) => ({
            key: `${h.occurredAt}-${index}`,
            children: (
              <Space direction="vertical" size={0}>
                <Space size={4} wrap>
                  {h.from ? <StatusTag domain="reservation" status={h.from} /> : null}
                  {h.from ? '→' : null}
                  <StatusTag domain="reservation" status={h.to} />
                  {h.depositOutcome !== 'none' ? (
                    <Tag>{t('reservations.detail.historyDeposit', { outcome: tx(t, `reservations.depositOutcomes.${h.depositOutcome}`, h.depositOutcome) })}</Tag>
                  ) : null}
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {formatInTz(h.occurredAt, tz)} · {tx(t, `reservations.detail.actorKinds.${h.actorKind}`, h.actorKind)}: {h.actorName}
                </Typography.Text>
                {h.reason ? <Typography.Text style={{ fontSize: 13 }}>{h.reason}</Typography.Text> : null}
              </Space>
            ),
          }))}
        />
      )}

      <CancelReservationModal reservation={r} tz={tz} open={dialog === 'cancel'} onClose={() => setDialog(null)} onDone={done('cancel')} />
      <WaiveDepositModal reservation={r} open={dialog === 'waive'} onClose={() => setDialog(null)} onDone={done('confirmWaive')} />
      <RescheduleModal reservation={r} tz={tz} open={dialog === 'reschedule'} onClose={() => setDialog(null)} onDone={done('reschedule')} />
    </>
  );
}

function Timestamps({ reservation: r, tz }: { reservation: ReservationDetail; tz: string }) {
  const { t } = useTranslation();
  const rows: Array<[string, string | null, string?]> = [
    [t('reservations.detail.confirmedAt'), r.confirmedAt],
    [t('reservations.detail.arrivedAt'), r.arrivedAt],
    [t('reservations.detail.noShowAt'), r.noShowAt],
    [
      t('reservations.detail.cancelledAt'),
      r.cancelledAt,
      [r.cancelledBy ? tx(t, `reservations.detail.cancelledBy.${r.cancelledBy}`, r.cancelledBy) : null, r.cancelReason].filter(Boolean).join(': '),
    ],
    [t('reservations.detail.expiredAt'), r.expiredAt],
    [t('reservations.detail.reminderSentAt'), r.reminderSentAt],
  ];
  const visible = rows.filter(([, at]) => at);
  if (visible.length === 0) return null;
  return (
    <Descriptions size="small" column={1}>
      {visible.map(([label, at, extra]) => (
        <Descriptions.Item key={label} label={label}>
          {formatInTz(at, tz)}
          {extra ? ` · ${extra}` : ''}
        </Descriptions.Item>
      ))}
    </Descriptions>
  );
}
