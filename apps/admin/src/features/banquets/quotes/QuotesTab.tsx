import { FilePdfOutlined, PlusOutlined, SendOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Drawer, Empty, Space, Table, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { formatDateTime } from '@/shared/lib/dates';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MoneyText } from '@/shared/ui/MoneyText';
import { PageLoader } from '@/shared/ui/PageLoader';
import { banquetsApi, banquetsKeys, openSignedLink } from '../api';
import { CopyLink } from '../common/ui';
import { formatIsoDate } from '../common/format';
import { useRequestMutation } from '../request/useRequestMutation';
import type { BanquetRequestDetail, QuoteSummary } from '../types';
import { QuoteView } from './QuoteView';

/** Версии сметы заявки: просмотр (неизменяемые), PDF, отправка клиенту, ссылка для клиента, новая версия. */
export function QuotesTab({ request }: { request: BanquetRequestDetail }) {
  const { t } = useTranslation();
  const { modal } = App.useApp();
  const navigate = useNavigate();
  const notifyError = useNotifyError();
  const [params, setParams] = useSearchParams();
  const openId = params.get('quote');
  const quote = useApiQuery(banquetsKeys.quote(openId ?? ''), () => banquetsApi.quote(openId ?? ''), { enabled: Boolean(openId) });
  const send = useRequestMutation((quoteId: string) => banquetsApi.sendQuote(quoteId), { successMessage: t('banquets.quote.sent') });
  const editable = request.canEditQuote;
  const hasQuotes = request.quotes.length > 0;

  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('quote', id);
    else next.delete('quote');
    setParams(next, { replace: true });
  };

  const pdf = (quoteId: string) => openSignedLink(() => banquetsApi.quotePdf(quoteId)).catch(notifyError);

  type Sendable = Pick<QuoteSummary, 'id' | 'version' | 'isLatest' | 'sentAt'>;
  const confirmSend = (q: Sendable) =>
    modal.confirm({
      title: t('banquets.quote.sendConfirm', { version: q.version }),
      content: t('banquets.actions.confirmText.sendQuote'),
      okText: t('banquets.quote.send'),
      cancelText: t('common.cancel'),
      onOk: () => send.mutateAsync(q.id).catch(() => undefined),
    });

  const sendButton = (q: Sendable, size: 'small' | 'middle' = 'small') =>
    request.canSendLatestQuote && q.isLatest ? (
      <Button size={size} type="primary" icon={<SendOutlined />} onClick={() => confirmSend(q)} loading={send.isPending && send.variables === q.id}>
        {t('banquets.quote.send')}
      </Button>
    ) : null;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        size="small"
        title={t('banquets.quote.versions')}
        extra={
          editable ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate(`/banquets/${request.id}/quote/new`)}>
              {hasQuotes ? t('banquets.quote.newVersion') : t('banquets.quote.firstVersion')}
            </Button>
          ) : null
        }
      >
        {hasQuotes ? (
          <>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              {t('banquets.quote.immutable')}
            </Typography.Paragraph>
            <Table<QuoteSummary>
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={request.quotes}
              scroll={{ x: 'max-content' }}
              onRow={(q) => ({ onClick: () => setOpen(q.id), style: { cursor: 'pointer' } })}
              columns={[
                {
                  title: t('banquets.quote.versions'),
                  dataIndex: 'version',
                  render: (v: number, q) => (
                    <Space>
                      <Typography.Link>v{v}</Typography.Link>
                      {q.isLatest ? <Tag color="blue">{t('banquets.quote.latest')}</Tag> : null}
                    </Space>
                  ),
                },
                { title: t('banquets.quote.createdAt'), dataIndex: 'createdAt', render: (v: string, q) => `${formatDateTime(v)} · ${q.createdByName}` },
                { title: t('banquets.quote.lines'), dataIndex: 'linesCount', align: 'right' },
                { title: t('banquets.quote.total'), dataIndex: 'total', align: 'right', render: (v: QuoteSummary['total']) => <MoneyText value={v} strong /> },
                { title: t('banquets.quote.vat'), dataIndex: 'vat', align: 'right', render: (v: QuoteSummary['vat']) => <MoneyText value={v} type="secondary" /> },
                { title: t('banquets.quote.validUntil'), dataIndex: 'validUntil', render: (v: string | null) => formatIsoDate(v) },
                {
                  title: t('banquets.common.status'),
                  key: 'status',
                  render: (_, q) => (
                    <Space size={4} wrap>
                      {q.sentAt ? <Tag color="geekblue">{t('banquets.quote.sentAt', { date: formatDateTime(q.sentAt) })}</Tag> : <Tag>{t('banquets.quote.notSent')}</Tag>}
                      {q.acceptedAt ? <Tag color="green">{t('banquets.quote.acceptedAt', { date: formatDateTime(q.acceptedAt) })}</Tag> : null}
                    </Space>
                  ),
                },
                {
                  title: t('common.actions'),
                  key: 'actions',
                  render: (_, q) => (
                    <Space onClick={(e) => e.stopPropagation()}>
                      <Button size="small" icon={<FilePdfOutlined />} onClick={() => void pdf(q.id)}>
                        {t('banquets.quote.pdf')}
                      </Button>
                      {sendButton(q)}
                    </Space>
                  ),
                },
              ]}
            />
          </>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('banquets.quote.empty')} />
        )}
      </Card>
      <Card size="small" title={t('banquets.quote.publicLink')}>
        <Space direction="vertical" size={4}>
          <CopyLink url={request.publicQuoteUrl} />
          <Typography.Text type="secondary">{t('banquets.quote.publicLinkHint')}</Typography.Text>
        </Space>
      </Card>
      <Drawer
        open={Boolean(openId)}
        onClose={() => setOpen(null)}
        width={980}
        title={quote.data ? t('banquets.quote.version', { version: quote.data.version }) : t('banquets.quote.loading')}
        extra={
          quote.data ? (
            <Space>
              <Button icon={<FilePdfOutlined />} onClick={() => void pdf(quote.data.id)}>
                {t('banquets.quote.pdf')}
              </Button>
              {sendButton(quote.data, 'middle')}
            </Space>
          ) : null
        }
      >
        {quote.isLoading ? <PageLoader /> : null}
        {quote.error ? <ErrorAlert error={quote.error} onRetry={() => void quote.refetch()} /> : null}
        {quote.data ? (
          <>
            {quote.data.isLatest && !quote.data.sentAt && editable ? (
              <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('banquets.actions.confirm.sendQuote')} />
            ) : null}
            <QuoteView quote={quote.data} />
          </>
        ) : null}
      </Drawer>
    </Space>
  );
}
