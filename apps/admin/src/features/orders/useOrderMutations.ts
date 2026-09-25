import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiMutation } from '@/shared/api/hooks';
import { ordersApi, ordersKeys } from './api';
import type { AdminOrderDetails, CancelOrderInput, RefundOrderInput, StaffTransitionTarget } from './types';

/** Ответ действия — свежая карточка заказа: кладём в кэш и обновляем очередь/списки. */
function useStoreDetails() {
  const queryClient = useQueryClient();
  return (order: AdminOrderDetails) => queryClient.setQueryData(ordersKeys.detail(order.id), order);
}

export function useTransitionOrder() {
  const { t } = useTranslation();
  const store = useStoreDetails();
  return useApiMutation(({ id, to }: { id: string; to: StaffTransitionTarget }) => ordersApi.transition(id, to), {
    invalidate: [ordersKeys.all],
    successMessage: t('orders.actions.done'),
    onSuccess: store,
  });
}

export function useCancelOrder(mode: 'cancel' | 'reject') {
  const { t } = useTranslation();
  const store = useStoreDetails();
  return useApiMutation(
    ({ id, input }: { id: string; input: CancelOrderInput }) => (mode === 'reject' ? ordersApi.reject(id, input) : ordersApi.cancel(id, input)),
    {
      invalidate: [ordersKeys.all],
      successMessage: mode === 'reject' ? t('orders.cancelDialog.rejected') : t('orders.cancelDialog.cancelled'),
      onSuccess: store,
    },
  );
}

export function useRefundOrder() {
  const { t } = useTranslation();
  const store = useStoreDetails();
  return useApiMutation(({ id, input }: { id: string; input: RefundOrderInput }) => ordersApi.refund(id, input), {
    invalidate: [ordersKeys.all],
    successMessage: t('orders.refundDialog.done'),
    onSuccess: store,
  });
}

export function useCourierAction() {
  const { t } = useTranslation();
  const store = useStoreDetails();
  return useApiMutation(
    ({ id, action }: { id: string; action: 'retry' | 'cancel' }) => (action === 'retry' ? ordersApi.courierRetry(id) : ordersApi.courierCancel(id)),
    { invalidate: [ordersKeys.all], successMessage: t('orders.courier.done'), onSuccess: store },
  );
}

/** Текущее время, обновляемое раз в intervalMs (таймеры «сколько прошло» в очереди). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
