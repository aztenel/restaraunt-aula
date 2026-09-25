import { Alert, Form, Input, Modal, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@aula/api-client';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { REASON_MAX_LENGTH, toRefundPayload, validateRefundForm, type RefundFormErrors, type RefundFormValues } from '../cancel-form';
import type { AdminOrderDetails } from '../types';
import { useRefundOrder } from '../useOrderMutations';

/** Частичный возврат по заказу (право orders.refund, canRefund от сервера): сумма ≤ refundable, причина. */
export function RefundDialog({ order, open, onClose }: { order: AdminOrderDetails; open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [form] = Form.useForm<RefundFormValues>();
  const refund = useRefundOrder();
  const refundable = order.refundable.amount;

  const fieldRule = (field: keyof RefundFormErrors) => ({
    validator: async () => {
      const issue = validateRefundForm(form.getFieldsValue(true), refundable)[field];
      if (issue) throw new Error(t(`orders.refundDialog.issues.${issue}`));
    },
  });

  const submit = async () => {
    await form.validateFields();
    await refund.mutateAsync({ id: order.id, input: toRefundPayload(form.getFieldsValue(true)) });
    onClose();
  };

  return (
    <Modal
      open={open}
      title={t('orders.refundDialog.title', { number: order.number })}
      onCancel={onClose}
      onOk={() => void submit().catch(() => undefined)}
      okText={t('orders.refundDialog.submit')}
      okButtonProps={{ danger: true, loading: refund.isPending }}
      cancelText={t('common.close')}
      destroyOnHidden
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('orders.refundDialog.hint')} />
      <Form<RefundFormValues> form={form} layout="vertical" requiredMark={false} preserve={false}>
        <Form.Item
          name="amount"
          label={t('orders.refundDialog.amount')}
          extra={<Typography.Text type="secondary">{t('orders.detail.refundable', { amount: formatMoney(order.refundable, i18n.language) })}</Typography.Text>}
          rules={[fieldRule('amount')]}
        >
          <MoneyInput size="large" style={{ maxWidth: 240 }} />
        </Form.Item>
        <Form.Item name="reason" label={t('orders.refundDialog.reason')} rules={[fieldRule('reason')]}>
          <Input.TextArea rows={2} maxLength={REASON_MAX_LENGTH} showCount placeholder={t('orders.refundDialog.reasonPlaceholder')} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
