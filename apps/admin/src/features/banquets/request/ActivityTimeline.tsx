import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  EditOutlined,
  FileTextOutlined,
  FireOutlined,
  MessageOutlined,
  PhoneOutlined,
  TeamOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { Button, Card, Empty, Flex, Input, Segmented, Space, Timeline, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiMutation } from '@/shared/api/hooks';
import { tx } from '@/shared/i18n/tx';
import { formatDateTime } from '@/shared/lib/dates';
import { banquetsApi } from '../api';
import { activitySummary } from '../common/format';
import { MANUAL_ACTIVITY_KINDS, type BanquetActivity, type ManualActivityKind } from '../types';
import { useInvalidateBanquets } from './useRequestMutation';

const ICONS: Partial<Record<string, ReactNode>> = {
  call: <PhoneOutlined />,
  contact: <MessageOutlined />,
  meeting: <TeamOutlined />,
  note: <EditOutlined />,
  status_changed: <CheckCircleOutlined />,
  quote_saved: <FileTextOutlined />,
  quote_sent: <FileTextOutlined />,
  quote_accepted: <CheckCircleOutlined />,
  payment_recorded: <WalletOutlined />,
  invoice_issued: <WalletOutlined />,
  sla_breach: <FireOutlined />,
};

const COLORS: Partial<Record<string, string>> = {
  sla_breach: 'red',
  quote_accepted: 'green',
  payment_recorded: 'green',
  call: 'blue',
  contact: 'blue',
  meeting: 'blue',
  invoice_cancelled: 'gray',
  refund_requested: 'orange',
  refund_recorded: 'orange',
};

/** Лента заявки (новые сверху) и запись звонка / контакта / встречи / заметки. */
export function ActivityTimeline({ requestId, timeline, canAdd }: { requestId: string; timeline: BanquetActivity[]; canAdd: boolean }) {
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidateBanquets();
  const [kind, setKind] = useState<ManualActivityKind>('call');
  const [text, setText] = useState('');
  const [textError, setTextError] = useState(false);
  const add = useApiMutation(({ kind: k, text: body }: { kind: ManualActivityKind; text: string }) => banquetsApi.addActivity(requestId, k, body), {
    successMessage: t('banquets.activity.added'),
    onSuccess: async () => {
      setText('');
      await invalidate();
    },
  });

  const submit = () => {
    if (kind === 'note' && !text.trim()) {
      setTextError(true);
      return;
    }
    add.mutate({ kind, text });
  };

  return (
    <Card size="small" title={t('banquets.activity.title')}>
      {canAdd ? (
        <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }} size={8}>
          <Segmented<ManualActivityKind>
            block
            value={kind}
            onChange={(value) => {
              setKind(value);
              setTextError(false);
            }}
            options={MANUAL_ACTIVITY_KINDS.map((k) => ({ value: k, label: t(`banquets.activity.manual.${k}`), icon: ICONS[k] }))}
          />
          <Input.TextArea
            rows={2}
            maxLength={4000}
            placeholder={t('banquets.activity.placeholder')}
            value={text}
            status={textError ? 'error' : undefined}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value.trim()) setTextError(false);
            }}
          />
          {textError ? <Typography.Text type="danger">{t('banquets.activity.noteRequired')}</Typography.Text> : null}
          <Flex justify="space-between" align="center" gap={8}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('banquets.activity.responseHint')}
            </Typography.Text>
            <Button type="primary" loading={add.isPending} onClick={submit}>
              {t('banquets.activity.add')}
            </Button>
          </Flex>
        </Space>
      ) : null}
      {timeline.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('banquets.activity.empty')} />
      ) : (
        <Timeline
          items={timeline.map((item) => {
            const summary = activitySummary(t, i18n.language, item.kind, item.data);
            const author = item.authorKind === 'staff' ? item.authorName : `${tx(t, `banquets.activity.authors.${item.authorKind}`, item.authorKind)}${item.authorKind === 'guest' ? ` (${item.authorName})` : ''}`;
            return {
              key: item.id,
              color: COLORS[item.kind] ?? 'gray',
              dot: ICONS[item.kind] ?? <ClockCircleOutlined />,
              children: (
                <div>
                  <Flex justify="space-between" gap={8} wrap>
                    <Typography.Text strong>{tx(t, `banquets.activity.kinds.${item.kind}`, item.kind)}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDateTime(item.occurredAt)}
                    </Typography.Text>
                  </Flex>
                  {summary ? <div style={{ fontSize: 13 }}>{summary}</div> : null}
                  {item.text ? (
                    <Typography.Paragraph style={{ margin: '2px 0 0', whiteSpace: 'pre-wrap' }} ellipsis={{ rows: 4, expandable: true }}>
                      {item.text}
                    </Typography.Paragraph>
                  ) : null}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {author}
                  </Typography.Text>
                </div>
              ),
            };
          })}
        />
      )}
    </Card>
  );
}
