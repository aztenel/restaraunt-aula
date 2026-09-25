/**
 * Журнал доставки уведомлений (integrations.manage): фильтры по статусу, каналу, шаблону, аудитории,
 * датам, адресату (точное совпадение; в ответе — маска) и связанному объекту; карточка доставки —
 * цепочка каналов, попытки, отправленный текст (коды скрыты); повторная отправка.
 */
import { ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, DatePicker, Descriptions, Drawer, Flex, Input, Select, Space, Steps, Table, Tag, Timeline, Tooltip, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { tx } from '@/shared/i18n/tx';
import { endOfLocalDayExclusiveIso, formatDateTime, formatDateTimeSeconds, startOfLocalDayIso } from '@/shared/lib/dates';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageLoader } from '@/shared/ui/PageLoader';
import { DELIVERY_STATUSES, notificationKeys, notificationsApi, type DeliveryLogItem, type DeliveryLogQuery, type DeliveryStatus, type TemplateKey } from './api';
import { NOTIFICATION_CHANNELS, type NotificationChannel } from './template-vars';
import { templateTitle } from './TemplatesTab';

const STATUS_COLORS: Record<string, string> = {
  pending: 'processing',
  sent: 'success',
  failed: 'error',
  queued: 'processing',
  partial: 'warning',
  skipped: 'default',
};

/** Ссылка на связанный объект в админке (заказ, бронь, банкетная заявка, сертификат). */
export function relatedPath(related: { type: string; id: string } | null | undefined): string | null {
  if (!related) return null;
  switch (related.type) {
    case 'order':
      return `/orders/${related.id}`;
    case 'reservation':
      return `/reservations/${related.id}`;
    case 'banquet_request':
      return `/banquets/${related.id}`;
    case 'gift_certificate':
      return '/certificates';
    default:
      return null;
  }
}

interface Filters {
  status?: DeliveryStatus;
  channel?: NotificationChannel;
  template?: TemplateKey;
  audience?: 'guest' | 'staff';
  range: [Dayjs, Dayjs] | null;
  recipient: string;
  relatedType: string;
  relatedId: string;
}

export function DeliveriesTab() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const openId = params.get('delivery');
  const [filters, setFilters] = useState<Filters>({ range: null, recipient: '', relatedType: '', relatedId: '' });
  const [page, setPage] = useState({ page: 1, perPage: 50 });
  const templates = useApiQuery(notificationKeys.templates, notificationsApi.templates, { staleTime: 5 * 60_000 });
  const titles = useMemo(() => new Map((templates.data ?? []).map((tpl) => [tpl.key, templateTitle(tpl, i18n.language)])), [templates.data, i18n.language]);

  const query: DeliveryLogQuery = {
    status: filters.status,
    channel: filters.channel,
    template: filters.template,
    audience: filters.audience,
    from: filters.range ? startOfLocalDayIso(filters.range[0]) : undefined,
    to: filters.range ? endOfLocalDayExclusiveIso(filters.range[1]) : undefined,
    recipient: filters.recipient.trim() || undefined,
    relatedType: filters.relatedType.trim() || undefined,
    relatedId: filters.relatedId.trim() || undefined,
    ...page,
  };
  const list = useApiQuery(notificationKeys.deliveries(query), () => notificationsApi.deliveries(query), { keepPrevious: true, refetchInterval: 30_000 });

  const update = (patch: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage((p) => ({ ...p, page: 1 }));
  };
  const open = (id: string | null) =>
    setParams((prev) => {
      const copy = new URLSearchParams(prev);
      if (id) copy.set('delivery', id);
      else copy.delete('delivery');
      return copy;
    });

  return (
    <Card>
      <Flex gap={8} wrap style={{ marginBottom: 12 }} justify="space-between">
        <Space wrap>
          <Select<DeliveryStatus | undefined>
            allowClear
            placeholder={t('notifications.deliveries.allStatuses')}
            value={filters.status}
            onChange={(status) => update({ status })}
            options={DELIVERY_STATUSES.map((s) => ({ value: s, label: t(`notifications.deliveries.statuses.${s}`) }))}
            style={{ width: 150 }}
          />
          <Select<NotificationChannel | undefined>
            allowClear
            placeholder={t('notifications.deliveries.allChannels')}
            value={filters.channel}
            onChange={(channel) => update({ channel })}
            options={NOTIFICATION_CHANNELS.map((c) => ({ value: c, label: t(`notifications.channels.${c}`) }))}
            style={{ width: 150 }}
          />
          <Select<TemplateKey | undefined>
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={t('notifications.deliveries.allTemplates')}
            value={filters.template}
            onChange={(template) => update({ template })}
            options={(templates.data ?? []).map((tpl) => ({ value: tpl.key, label: templateTitle(tpl, i18n.language) }))}
            style={{ width: 240 }}
          />
          <Select<'guest' | 'staff' | undefined>
            allowClear
            placeholder={t('notifications.deliveries.allAudiences')}
            value={filters.audience}
            onChange={(audience) => update({ audience })}
            options={[
              { value: 'guest', label: t('notifications.audiences.guest') },
              { value: 'staff', label: t('notifications.audiences.staff') },
            ]}
            style={{ width: 140 }}
          />
          <DatePicker.RangePicker
            format="DD.MM.YYYY"
            value={filters.range}
            onChange={(range) => update({ range: range?.[0] && range[1] ? [range[0], range[1]] : null })}
          />
          <Input.Search allowClear placeholder={t('notifications.deliveries.recipient')} onSearch={(recipient) => update({ recipient })} style={{ width: 220 }} />
          <Input.Search
            allowClear
            placeholder={t('notifications.deliveries.related')}
            onSearch={(value) => {
              const [type, id] = value.includes(':') ? value.split(':', 2) : ['', value];
              update({ relatedType: (type ?? '').trim(), relatedId: (id ?? '').trim() });
            }}
            style={{ width: 240 }}
          />
        </Space>
        <Button icon={<ReloadOutlined />} onClick={() => void list.refetch()} aria-label={t('common.refresh')} />
      </Flex>
      {list.error ? <ErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : null}
      <Table<DeliveryLogItem>
        rowKey="id"
        size="small"
        loading={list.isFetching}
        dataSource={list.data?.items ?? []}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('notifications.deliveries.empty') }}
        onRow={(r) => ({ onClick: () => open(r.id), style: { cursor: 'pointer' } })}
        pagination={{
          current: page.page,
          pageSize: page.perPage,
          total: list.data?.total ?? 0,
          showSizeChanger: true,
          onChange: (p, perPage) => setPage({ page: perPage === page.perPage ? p : 1, perPage }),
        }}
        columns={[
          { title: t('notifications.deliveries.createdAt'), key: 'createdAt', render: (_, r) => formatDateTime(r.createdAt) },
          {
            title: t('notifications.templates.template'),
            key: 'template',
            render: (_, r) => (
              <Space direction="vertical" size={0}>
                <span>{titles.get(r.template) ?? r.template}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t(`notifications.audiences.${r.audience as 'guest'}`)} · {r.locale}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: t('notifications.deliveries.recipient'),
            key: 'recipient',
            render: (_, r) => (
              <Space direction="vertical" size={0}>
                <Typography.Text style={{ fontFamily: 'monospace' }}>{r.recipient}</Typography.Text>
                {r.recipientName ? <Typography.Text type="secondary">{r.recipientName}</Typography.Text> : null}
              </Space>
            ),
          },
          {
            title: t('notifications.deliveries.channel'),
            key: 'channel',
            render: (_, r) => (
              <span>
                {tx(t, `notifications.channels.${r.channel}`, r.channel)}
                {r.provider ? <Typography.Text type="secondary"> · {r.provider}</Typography.Text> : null}
              </span>
            ),
          },
          {
            title: t('notifications.deliveries.status'),
            key: 'status',
            render: (_, r) => (
              <Space size={4} wrap>
                <Tag color={STATUS_COLORS[r.status]}>{tx(t, `notifications.deliveries.statuses.${r.status}`, r.status)}</Tag>
                {r.resentFromId ? <Tag>{t('notifications.deliveries.resent')}</Tag> : null}
              </Space>
            ),
          },
          { title: t('notifications.deliveries.attempts'), dataIndex: 'attempts', align: 'right' },
          {
            title: t('notifications.deliveries.lastError'),
            key: 'lastError',
            render: (_, r) =>
              r.lastError ? (
                <Tooltip title={r.lastError}>
                  <Typography.Text type="danger" ellipsis style={{ maxWidth: 220 }}>
                    {r.lastError}
                  </Typography.Text>
                </Tooltip>
              ) : null,
          },
          {
            title: t('notifications.deliveries.related'),
            key: 'related',
            render: (_, r) => {
              if (!r.related) return null;
              const path = relatedPath(r.related);
              const label = tx(t, `notifications.related.${r.related.type}`, r.related.type);
              return path ? (
                <Link to={path} onClick={(e) => e.stopPropagation()}>
                  {label}
                </Link>
              ) : (
                label
              );
            },
          },
        ]}
      />
      <DeliveryDrawer id={openId} titles={titles} onClose={() => open(null)} onOpen={open} />
    </Card>
  );
}

function DeliveryDrawer({ id, titles, onClose, onOpen }: { id: string | null; titles: Map<string, string>; onClose: () => void; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const [resending, setResending] = useState(false);
  const detail = useApiQuery(notificationKeys.delivery(id ?? ''), () => notificationsApi.delivery(id!), { enabled: Boolean(id) });
  const d = detail.data?.id === id ? detail.data : undefined;

  const resend = async () => {
    if (!d) return;
    setResending(true);
    try {
      const queued = await notificationsApi.resend(d.id);
      void message.success(t('notifications.deliveries.resendQueued'));
      await queryClient.invalidateQueries({ queryKey: ['notifications', 'deliveries'] });
      onOpen(queued.deliveryId);
    } catch (error) {
      notifyError(error);
    } finally {
      setResending(false);
    }
  };

  return (
    <Drawer
      open={Boolean(id)}
      onClose={onClose}
      width={720}
      destroyOnHidden
      title={d ? (titles.get(d.template) ?? d.template) : t('notifications.deliveries.detailTitle')}
      extra={
        d && d.status !== 'pending' ? (
          <Button icon={<SendOutlined />} loading={resending} onClick={() => void resend()}>
            {t('notifications.deliveries.resend')}
          </Button>
        ) : null
      }
    >
      {detail.error ? <ErrorAlert error={detail.error} onRetry={() => void detail.refetch()} /> : null}
      {!d && detail.isLoading ? <PageLoader /> : null}
      {d ? (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label={t('notifications.deliveries.status')}>
              <Space size={4}>
                <Tag color={STATUS_COLORS[d.status]}>{tx(t, `notifications.deliveries.statuses.${d.status}`, d.status)}</Tag>
                <Tag color={STATUS_COLORS[d.messageStatus]}>{tx(t, `notifications.deliveries.messageStatuses.${d.messageStatus}`, d.messageStatus)}</Tag>
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label={t('notifications.deliveries.recipient')}>
              <span style={{ fontFamily: 'monospace' }}>{d.recipient}</span>
              {d.recipientName ? ` · ${d.recipientName}` : ''}
            </Descriptions.Item>
            <Descriptions.Item label={t('notifications.deliveries.createdAt')}>{formatDateTimeSeconds(d.createdAt)}</Descriptions.Item>
            {d.sentAt ? <Descriptions.Item label={t('notifications.deliveries.sentAt')}>{formatDateTimeSeconds(d.sentAt)}</Descriptions.Item> : null}
            {d.deliveredAt ? <Descriptions.Item label={t('notifications.deliveries.deliveredAt')}>{formatDateTimeSeconds(d.deliveredAt)}</Descriptions.Item> : null}
            {d.readAt ? <Descriptions.Item label={t('notifications.deliveries.readAt')}>{formatDateTimeSeconds(d.readAt)}</Descriptions.Item> : null}
            {d.resentFromId ? (
              <Descriptions.Item label={t('notifications.deliveries.resentFrom')}>
                <Typography.Text code>{d.resentFromId}</Typography.Text>
              </Descriptions.Item>
            ) : null}
          </Descriptions>
          <div>
            <Typography.Title level={5}>{t('notifications.deliveries.chain')}</Typography.Title>
            <Steps
              size="small"
              current={d.stepIndex}
              status={d.status === 'failed' ? 'error' : d.status === 'sent' ? 'finish' : 'process'}
              items={d.chain.map((step) => ({ title: tx(t, `notifications.channels.${step.channel}`, step.channel), description: step.recipient }))}
            />
          </div>
          <div>
            <Typography.Title level={5}>{t('notifications.deliveries.attemptLog')}</Typography.Title>
            <Timeline
              items={d.attemptLog.map((a) => ({
                key: a.attemptNo,
                color: a.status === 'sent' ? 'green' : a.status === 'failed' ? 'red' : 'gray',
                children: (
                  <Space direction="vertical" size={0}>
                    <span>
                      #{a.attemptNo} · {tx(t, `notifications.channels.${a.channel}`, a.channel)}
                      {a.provider ? ` · ${a.provider}` : ''} · {tx(t, `notifications.deliveries.attemptStatuses.${a.status}`, a.status)}
                      {a.retryable ? ` · ${t('notifications.deliveries.retryable')}` : ''}
                    </span>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDateTimeSeconds(a.occurredAt)} · {a.recipient}
                      {a.durationMs !== null && a.durationMs !== undefined ? ` · ${a.durationMs} ms` : ''}
                      {a.externalId ? ` · ${a.externalId}` : ''}
                    </Typography.Text>
                    {a.error ? (
                      <Typography.Text type="danger" style={{ fontSize: 12 }}>
                        {a.errorCode ? `${a.errorCode}: ` : ''}
                        {a.error}
                      </Typography.Text>
                    ) : null}
                  </Space>
                ),
              }))}
            />
          </div>
          {d.renderedSubject || d.renderedText ? (
            <div>
              <Typography.Title level={5}>{t('notifications.deliveries.renderedText')}</Typography.Title>
              {d.renderedSubject ? <Typography.Paragraph strong>{d.renderedSubject}</Typography.Paragraph> : null}
              <div style={{ whiteSpace: 'pre-wrap', background: '#fbf8f3', border: '1px solid #ede0d0', borderRadius: 8, padding: 12 }}>{d.renderedText}</div>
            </div>
          ) : null}
          {Object.keys(d.params).length > 0 ? (
            <div>
              <Typography.Title level={5}>{t('notifications.deliveries.params')}</Typography.Title>
              <Descriptions size="small" column={1}>
                {Object.entries(d.params).map(([key, value]) => (
                  <Descriptions.Item key={key} label={<Typography.Text code>{key}</Typography.Text>}>
                    {value}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            </div>
          ) : null}
        </Space>
      ) : null}
    </Drawer>
  );
}
