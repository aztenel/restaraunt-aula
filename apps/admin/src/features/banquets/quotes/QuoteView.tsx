import { Descriptions, Flex, Space, Table, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { formatMoney, translate } from '@aula/api-client';
import { tx } from '@/shared/i18n/tx';
import { formatDateTime } from '@/shared/lib/dates';
import { MoneyText } from '@/shared/ui/MoneyText';
import { formatIsoDate } from '../common/format';
import { bpToPercentText } from '../sla';
import type { Quote, QuoteDiscount, QuoteLine } from '../types';

export function DiscountText({ discount }: { discount: QuoteDiscount | null }) {
  const { i18n } = useTranslation();
  if (!discount) return <>—</>;
  if (discount.type === 'percent') return <>{bpToPercentText(discount.bp ?? 0, i18n.language)}%</>;
  return <>{formatMoney(discount.amount, i18n.language)}</>;
}

/** Итоги версии сметы — только из ответа сервера. */
export function QuoteTotals({ quote }: { quote: Pick<Quote, 'totals' | 'serviceChargeBp' | 'vatPayer' | 'vatRateBp' | 'guests'> }) {
  const { t, i18n } = useTranslation();
  const { totals } = quote;
  const row = (label: string, value: Quote['totals']['total'], options: { strong?: boolean; negative?: boolean } = {}) => (
    <Flex justify="space-between" gap={16}>
      <Typography.Text strong={options.strong}>{label}</Typography.Text>
      <Typography.Text strong={options.strong} style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {options.negative && value.amount > 0 ? '−' : ''}
        {formatMoney(value, i18n.language)}
      </Typography.Text>
    </Flex>
  );
  return (
    <Space direction="vertical" size={4} style={{ width: '100%', maxWidth: 420, marginInlineStart: 'auto' }}>
      {row(t('banquets.quote.totals.subtotal'), totals.subtotal)}
      {totals.linesDiscount.amount > 0 ? row(t('banquets.quote.totals.linesDiscount'), totals.linesDiscount, { negative: true }) : null}
      {totals.overallDiscount.amount > 0 ? row(t('banquets.quote.totals.overallDiscount'), totals.overallDiscount, { negative: true }) : null}
      {quote.serviceChargeBp > 0 ? row(t('banquets.quote.totals.service', { percent: bpToPercentText(quote.serviceChargeBp, i18n.language) }), totals.service) : null}
      {row(t('banquets.quote.totals.total'), totals.total, { strong: true })}
      {quote.vatPayer ? (
        row(t('banquets.quote.totals.vat', { percent: bpToPercentText(quote.vatRateBp, i18n.language) }), totals.vat)
      ) : (
        <Typography.Text type="secondary">{t('banquets.quote.totals.noVat')}</Typography.Text>
      )}
      {row(t('banquets.quote.totals.perGuest', { guests: quote.guests }), totals.perGuest)}
    </Space>
  );
}

/** Версия сметы только для чтения (прошлые версии не меняются). */
export function QuoteView({ quote }: { quote: Quote }) {
  const { t, i18n } = useTranslation();
  const lines = [...quote.lines].sort((a, b) => a.position - b.position);
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label={t('banquets.quote.createdAt')}>
          {formatDateTime(quote.createdAt)} · {quote.createdByName}
        </Descriptions.Item>
        <Descriptions.Item label={t('banquets.quote.validUntil')}>{formatIsoDate(quote.validUntil)}</Descriptions.Item>
        <Descriptions.Item label={t('banquets.quote.seller')}>
          {quote.seller.name} · {quote.seller.bin}
        </Descriptions.Item>
        <Descriptions.Item label={t('banquets.common.status')}>
          <Space size={4} wrap>
            {quote.isLatest ? <Tag color="blue">{t('banquets.quote.latest')}</Tag> : null}
            {quote.sentAt ? <Tag color="geekblue">{t('banquets.quote.sentAt', { date: formatDateTime(quote.sentAt) })}</Tag> : <Tag>{t('banquets.quote.notSent')}</Tag>}
            {quote.acceptedAt ? <Tag color="green">{t('banquets.quote.acceptedAt', { date: formatDateTime(quote.acceptedAt) })}</Tag> : null}
          </Space>
        </Descriptions.Item>
      </Descriptions>
      <Table<QuoteLine>
        size="small"
        rowKey="position"
        pagination={false}
        dataSource={lines}
        scroll={{ x: 'max-content' }}
        columns={[
          { title: t('banquets.quote.columns.position'), dataIndex: 'position', width: 48 },
          {
            title: t('banquets.quote.columns.item'),
            key: 'item',
            render: (_, line) => (
              <Space direction="vertical" size={0}>
                <span>{translate(line.title, i18n.language)}</span>
                <Tag style={{ marginInlineEnd: 0, width: 'fit-content' }} color={line.kind === 'menu' ? 'gold' : undefined}>
                  {tx(t, `banquets.quote.kinds.${line.kind}`, line.kind)}
                </Tag>
              </Space>
            ),
          },
          { title: t('banquets.quote.columns.unit'), dataIndex: 'unit' },
          { title: t('banquets.quote.columns.quantity'), dataIndex: 'quantity', align: 'right' },
          { title: t('banquets.quote.columns.price'), dataIndex: 'unitPrice', align: 'right', render: (v: QuoteLine['unitPrice']) => <MoneyText value={v} /> },
          { title: t('banquets.quote.columns.gross'), dataIndex: 'gross', align: 'right', render: (v: QuoteLine['gross']) => <MoneyText value={v} /> },
          {
            title: t('banquets.quote.columns.discount'),
            key: 'discount',
            align: 'right',
            render: (_, line) =>
              line.discount ? (
                <Space direction="vertical" size={0} align="end">
                  <DiscountText discount={line.discount} />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    −{formatMoney(line.discountAmount, i18n.language)}
                  </Typography.Text>
                </Space>
              ) : (
                '—'
              ),
          },
          { title: t('banquets.quote.columns.total'), dataIndex: 'total', align: 'right', render: (v: QuoteLine['total']) => <MoneyText value={v} strong /> },
        ]}
      />
      <Flex justify="space-between" gap={24} wrap>
        <div style={{ flex: '1 1 260px' }}>
          {quote.discount ? (
            <div>
              {t('banquets.quote.totals.overallDiscount')}: <DiscountText discount={quote.discount} />
            </div>
          ) : null}
          {quote.notes ? (
            <>
              <Typography.Text type="secondary">{t('banquets.quote.notes')}</Typography.Text>
              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{quote.notes}</Typography.Paragraph>
            </>
          ) : null}
        </div>
        <div style={{ flex: '1 1 320px' }}>
          <QuoteTotals quote={quote} />
        </div>
      </Flex>
    </Space>
  );
}
