import { DeleteOutlined, LoadingOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Divider, Empty, Flex, Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney, type Money } from '@aula/api-client';
import { messageForCode } from '@/shared/api/errors';
import { MoneyText } from '@/shared/ui/MoneyText';
import type { OrderQuote } from '../types';
import { MAX_LINE_QUANTITY, type CartLine } from './phone-order';

function Row({ label, value, strong, negative, extra }: { label: ReactNode; value: Money; strong?: boolean; negative?: boolean; extra?: ReactNode }) {
  return (
    <Flex justify="space-between" gap={12} style={{ padding: '2px 0' }}>
      <Typography.Text strong={strong}>{label}</Typography.Text>
      <span>
        {extra}
        {negative && value.amount > 0 ? '−' : null}
        <MoneyText value={value} strong={strong} />
      </span>
    </Flex>
  );
}

/**
 * Корзина и расчёт сервера: строки с ценами из ответа quote (по индексу позиции), скидка, доставка,
 * итог и проблемы оформления. Пока расчёт устарел — показываем прежние суммы с пометкой.
 */
export function QuotePanel({
  cart,
  quote,
  stale,
  onQuantity,
  onRemove,
  onClear,
}: {
  cart: readonly CartLine[];
  quote: OrderQuote | undefined;
  stale: boolean;
  onQuantity: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  onClear: () => void;
}) {
  const { t, i18n } = useTranslation();
  if (cart.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('orders.phone.cart.empty')} />;
  const lines = quote && quote.lines.length === cart.length ? quote.lines : undefined;
  const money = (value: Money | null | undefined) => formatMoney(value, i18n.language);
  const delivery = quote?.delivery;
  const promo = quote?.promo;

  return (
    <div style={{ opacity: stale ? 0.65 : 1, transition: 'opacity .2s' }}>
      {cart.map((line, index) => {
        const priced = lines?.[index];
        return (
          <Flex key={line.key} gap={8} align="center" style={{ padding: '6px 0', borderBottom: '1px solid #f0e6da' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Typography.Text strong>{priced?.name ?? line.name}</Typography.Text>
              {line.modifierLabels.length > 0 ? (
                <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                  {line.modifierLabels.join(', ')}
                </Typography.Text>
              ) : null}
              {priced && !priced.available ? (
                <Tag color="error" style={{ marginTop: 2 }}>
                  {priced.problem ? messageForCode(priced.problem, i18n.language) : t('orders.phone.quote.lineUnavailable')}
                </Tag>
              ) : null}
            </div>
            <Space.Compact>
              <Button icon={<MinusOutlined />} onClick={() => onQuantity(line.key, line.quantity - 1)} aria-label="−" />
              <Button disabled style={{ width: 44, color: 'inherit', cursor: 'default' }}>
                {line.quantity}
              </Button>
              <Button icon={<PlusOutlined />} disabled={line.quantity >= MAX_LINE_QUANTITY} onClick={() => onQuantity(line.key, line.quantity + 1)} aria-label="+" />
            </Space.Compact>
            <div style={{ width: 96, textAlign: 'right' }}>{priced?.lineTotal ? <MoneyText value={priced.lineTotal} /> : <Typography.Text type="secondary">—</Typography.Text>}</div>
            <Button type="text" danger icon={<DeleteOutlined />} onClick={() => onRemove(line.key)} aria-label={t('orders.phone.cart.remove')} />
          </Flex>
        );
      })}
      <Flex justify="flex-end" style={{ marginTop: 4 }}>
        <Button size="small" type="link" danger onClick={onClear}>
          {t('orders.phone.cart.clear')}
        </Button>
      </Flex>

      <Divider style={{ margin: '8px 0' }} orientation="left" plain>
        <Space size={6}>
          {t('orders.phone.quote.title')}
          {stale ? <LoadingOutlined /> : null}
        </Space>
      </Divider>
      {quote ? (
        <>
          <Row label={t('orders.phone.quote.subtotal')} value={quote.subtotal} />
          {quote.discount.amount > 0 ? <Row label={t('orders.phone.quote.discount')} value={quote.discount} negative /> : null}
          {quote.type === 'delivery' ? (
            <Row
              label={t('orders.phone.quote.deliveryFee')}
              value={quote.deliveryFee}
              extra={
                delivery && delivery.freeDeliveryReason ? (
                  <Tag color="green" style={{ marginInlineEnd: 6 }}>
                    {t('orders.phone.quote.freeDelivery')}
                  </Tag>
                ) : null
              }
            />
          ) : null}
          <Row label={t('orders.phone.quote.total')} value={quote.total} strong />
          {quote.certificate?.applied ? <Row label={t('orders.phone.quote.certificate')} value={quote.certificate.amount} negative /> : null}
          {quote.certificate?.applied ? <Row label={t('orders.phone.quote.amountDue')} value={quote.amountDue} strong /> : null}

          <Space direction="vertical" size={4} style={{ width: '100%', marginTop: 8 }}>
            {delivery?.zoneName ? (
              <Typography.Text type="secondary">{t('orders.phone.quote.zone', { name: delivery.zoneName, eta: delivery.etaMinutes ?? '—' })}</Typography.Text>
            ) : null}
            {delivery && delivery.deliverable && !delivery.minOrderReached ? (
              <Alert
                type="warning"
                showIcon
                message={t('orders.phone.quote.minOrder', { amount: money(delivery.minOrderAmount), shortfall: money(delivery.minOrderShortfall) })}
              />
            ) : null}
            {delivery?.amountToFreeDelivery && delivery.amountToFreeDelivery.amount > 0 ? (
              <Typography.Text type="secondary">{t('orders.phone.quote.toFreeDelivery', { amount: money(delivery.amountToFreeDelivery) })}</Typography.Text>
            ) : null}
            {promo ? (
              promo.applied ? (
                <Alert type="success" showIcon message={t('orders.phone.quote.promoApplied', { code: promo.code })} />
              ) : (
                <Alert
                  type="warning"
                  showIcon
                  message={t('orders.phone.quote.promoRejected', { code: promo.code })}
                  description={promo.reason ? messageForCode(promo.reason, i18n.language) : undefined}
                />
              )
            ) : null}
            {quote.certificate && quote.certificate.applied ? (
              <Typography.Text type="secondary">
                {t('orders.phone.quote.certificateApplied', { code: quote.certificate.maskedCode ?? '', balance: money(quote.certificate.balance) })}
              </Typography.Text>
            ) : null}
            {quote.problems.length > 0 ? (
              <Alert
                type="error"
                showIcon
                message={t('orders.phone.quote.problems')}
                description={
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {quote.problems.map((code) => (
                      <li key={code}>{messageForCode(code, i18n.language)}</li>
                    ))}
                  </ul>
                }
              />
            ) : null}
          </Space>
        </>
      ) : (
        <Typography.Text type="secondary">{t('orders.phone.quote.waiting')}</Typography.Text>
      )}
    </div>
  );
}
