import { Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { tx } from '@/shared/i18n/tx';
import type { PaymentMethod, PaymentPurpose, RefundMode, RefundStatus } from './types';

const PURPOSE_COLORS: Record<PaymentPurpose, string> = {
  order: 'blue',
  reservation_deposit: 'purple',
  banquet_invoice: 'gold',
  gift_certificate: 'magenta',
};

const REFUND_STATUS_COLORS: Record<RefundStatus, string> = { pending: 'gold', succeeded: 'success', failed: 'error' };

export function PurposeTag({ purpose }: { purpose: PaymentPurpose }) {
  const { t } = useTranslation();
  return (
    <Tag color={PURPOSE_COLORS[purpose]} style={{ marginInlineEnd: 0 }}>
      {t(`payments.purpose.${purpose}`)}
    </Tag>
  );
}

/** Способ оплаты и провайдер: «Онлайн · Kaspi». Для не-онлайн способов провайдер совпадает со способом. */
export function MethodText({ method, provider }: { method: PaymentMethod; provider: string }) {
  const { t } = useTranslation();
  const providerLabel = tx(t, `payments.provider.${provider}`, provider);
  return (
    <span>
      {t(`payments.method.${method}`)}
      {method === 'online' ? <Typography.Text type="secondary"> · {providerLabel}</Typography.Text> : null}
    </span>
  );
}

export function RefundStatusTag({ status }: { status: RefundStatus }) {
  const { t } = useTranslation();
  return (
    <Tag color={REFUND_STATUS_COLORS[status]} style={{ marginInlineEnd: 0 }}>
      {t(`payments.refunds.status.${status}`)}
    </Tag>
  );
}

export function RefundModeTag({ mode }: { mode: RefundMode }) {
  const { t } = useTranslation();
  return <Tag style={{ marginInlineEnd: 0 }}>{t(`payments.refunds.mode.${mode}`)}</Tag>;
}

/** Объект оплаты: ссылка на заказ / заказ сертификатов, иначе идентификатор с копированием. */
export function ReferenceLink({ purpose, referenceId }: { purpose: PaymentPurpose; referenceId: string }) {
  const short = referenceId.length > 13 ? `${referenceId.slice(0, 8)}…` : referenceId;
  const href =
    purpose === 'order'
      ? `/orders/${referenceId}`
      : purpose === 'gift_certificate'
        ? `/certificates/list?orderId=${encodeURIComponent(referenceId)}`
        : null;
  return (
    <span style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
      {href ? (
        <Link to={href}>
          <Typography.Text code style={{ fontSize: 12 }}>
            {short}
          </Typography.Text>
        </Link>
      ) : (
        <Typography.Text code style={{ fontSize: 12 }}>
          {short}
        </Typography.Text>
      )}
      <Typography.Text copyable={{ text: referenceId }} />
    </span>
  );
}
