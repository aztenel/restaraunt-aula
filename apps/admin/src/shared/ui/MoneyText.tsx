import { Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { formatMoney, type Money } from '@aula/api-client';

/** Сумма от сервера (тиыны) в формате «2 500 ₸». Ничего не считает. */
export function MoneyText({ value, strong, type }: { value: Money | null | undefined; strong?: boolean; type?: 'secondary' | 'danger' | 'success' }) {
  const { i18n } = useTranslation();
  return (
    <Typography.Text strong={strong} type={type} style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
      {formatMoney(value, i18n.language)}
    </Typography.Text>
  );
}
