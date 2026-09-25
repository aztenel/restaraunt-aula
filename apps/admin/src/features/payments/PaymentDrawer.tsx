import { Drawer, Grid, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/shared/api/hooks';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { paymentKeys, paymentsApi } from './api';
import { PaymentDetailsView } from './PaymentDetailsView';

/** Карточка платежа поверх списка или очереди возвратов (?payment=<id> в адресе). */
export function PaymentDrawer({ paymentId, onClose }: { paymentId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const screens = Grid.useBreakpoint();
  const detail = useApiQuery(paymentKeys.detail(paymentId ?? ''), () => paymentsApi.get(paymentId ?? ''), { enabled: paymentId !== null });
  const details = paymentId ? detail.data : undefined;

  return (
    <Drawer
      open={paymentId !== null}
      onClose={onClose}
      width={screens.xl ? 960 : screens.md ? '90%' : '100%'}
      title={details ? t('payments.detail.title', { number: details.payment.invoiceNo }) : ' '}
      destroyOnHidden
    >
      {detail.isLoading ? <Spin style={{ display: 'block', margin: '48px auto' }} /> : null}
      {detail.error ? <ErrorAlert error={detail.error} onRetry={() => void detail.refetch()} /> : null}
      {details ? <PaymentDetailsView details={details} /> : null}
    </Drawer>
  );
}
