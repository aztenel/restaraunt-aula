import { Alert, Checkbox, Form, Input, Modal, Radio, Space, Spin, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { formatMoney, Permission } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useCan } from '@/shared/auth/useCan';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { ordersApi, ordersKeys } from '../api';
import {
  REASON_MAX_LENGTH,
  reasonCodesFor,
  toCancelPayload,
  validateCancelForm,
  type CancelFormContext,
  type CancelFormErrors,
  type CancelFormValues,
  type CancelMode,
} from '../cancel-form';
import { useCancelOrder } from '../useOrderMutations';

/**
 * Отмена или отказ с причиной. Режим и доступность — из карточки заказа (canReject / canCancel),
 * частичная сумма возврата — только с правом orders.refund и не больше refundable от сервера.
 */
export function CancelOrderDialog({
  orderId,
  preferred,
  onClose,
}: {
  /** null — диалог закрыт. */
  orderId: string | null;
  /** Какое действие выбрал сотрудник (если сервер разрешает оба — берётся оно). */
  preferred?: CancelMode;
  onClose: (done: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const { can } = useCan();
  const [form] = Form.useForm<CancelFormValues>();
  const open = orderId !== null;
  const detail = useApiQuery(ordersKeys.detail(orderId ?? ''), () => ordersApi.get(orderId ?? ''), { enabled: open });
  const order = open ? detail.data : undefined;

  const allowed: CancelMode[] = order ? [...(order.canReject ? ['reject' as const] : []), ...(order.canCancel ? ['cancel' as const] : [])] : [];
  const mode: CancelMode | null = preferred && allowed.includes(preferred) ? preferred : (allowed[0] ?? null);
  const cancelMutation = useCancelOrder(mode ?? 'cancel');

  const ctx: CancelFormContext | null =
    order && mode
      ? {
          mode,
          refundAllowed: order.wasPaid && can(Permission.OrdersRefund, order.branchId),
          refundable: order.refundable.amount,
        }
      : null;

  const fieldRule = (field: keyof CancelFormErrors) => ({
    validator: async () => {
      if (!ctx) return;
      const issue = validateCancelForm(form.getFieldsValue(true), ctx)[field];
      if (issue) throw new Error(t(`orders.cancelDialog.issues.${issue}`));
    },
  });

  const submit = async () => {
    if (!order || !ctx) return;
    await form.validateFields();
    const values = form.getFieldsValue(true);
    await cancelMutation.mutateAsync({ id: order.id, input: toCancelPayload(values, ctx) });
    onClose(true);
  };

  const partial = Form.useWatch('partialRefund', form);
  const title = order
    ? mode === 'reject'
      ? t('orders.cancelDialog.rejectTitle', { number: order.number })
      : t('orders.cancelDialog.cancelTitle', { number: order.number })
    : t('orders.actions.cancel');

  return (
    <Modal
      open={open}
      title={title}
      onCancel={() => onClose(false)}
      onOk={() => void submit().catch(() => undefined)}
      okText={mode === 'reject' ? t('orders.cancelDialog.submitReject') : t('orders.cancelDialog.submitCancel')}
      okButtonProps={{ danger: true, size: 'large', disabled: !ctx, loading: cancelMutation.isPending }}
      cancelButtonProps={{ size: 'large' }}
      cancelText={t('common.close')}
      destroyOnHidden
      width={560}
    >
      {detail.isLoading ? <Spin style={{ display: 'block', margin: '24px auto' }} /> : null}
      {detail.error ? <ErrorAlert error={detail.error} onRetry={() => void detail.refetch()} /> : null}
      {order && !mode ? <Alert type="warning" showIcon message={t('orders.cancelDialog.notAllowed')} /> : null}
      {order && ctx ? (
        <Form<CancelFormValues> form={form} layout="vertical" requiredMark={false} initialValues={{ partialRefund: false }} preserve={false}>
          <Alert
            type={mode === 'reject' ? 'warning' : 'info'}
            showIcon
            style={{ marginBottom: 16 }}
            message={
              mode === 'reject'
                ? t('orders.cancelDialog.rejectHint')
                : order.wasPaid
                  ? t('orders.cancelDialog.paidHint')
                  : t('orders.cancelDialog.unpaidHint')
            }
            description={order.wasPaid && !partial ? t('orders.cancelDialog.fullRefund', { amount: formatMoney(order.refundable, i18n.language) }) : undefined}
          />
          <Form.Item name="reasonCode" label={t('orders.cancelDialog.reason')} rules={[fieldRule('reasonCode')]}>
            <Radio.Group style={{ width: '100%' }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                {reasonCodesFor(ctx.mode).map((code) => (
                  <Radio key={code} value={code} style={{ padding: '6px 0', fontSize: 15 }}>
                    {t(`orders.reasons.${code}`)}
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          </Form.Item>
          <Form.Item
            name="reason"
            label={t('orders.cancelDialog.comment')}
            extra={t('orders.cancelDialog.commentHint')}
            dependencies={['reasonCode']}
            rules={[fieldRule('reason')]}
          >
            <Input.TextArea rows={2} maxLength={REASON_MAX_LENGTH} showCount />
          </Form.Item>
          {ctx.refundAllowed ? (
            <>
              <Form.Item name="partialRefund" valuePropName="checked" style={{ marginBottom: 8 }}>
                <Checkbox>{t('orders.cancelDialog.partialRefund')}</Checkbox>
              </Form.Item>
              {partial ? (
                <Form.Item
                  name="refundAmount"
                  label={t('orders.cancelDialog.refundAmount')}
                  extra={
                    <Typography.Text type="secondary">
                      {t('orders.cancelDialog.refundableHint', { amount: formatMoney(order.refundable, i18n.language) })}
                    </Typography.Text>
                  }
                  dependencies={['partialRefund']}
                  rules={[fieldRule('refundAmount')]}
                >
                  <MoneyInput size="large" max={order.refundable.amount} style={{ maxWidth: 240 }} />
                </Form.Item>
              ) : null}
            </>
          ) : null}
        </Form>
      ) : null}
    </Modal>
  );
}
