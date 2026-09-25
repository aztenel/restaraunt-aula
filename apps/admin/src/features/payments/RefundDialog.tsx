import { Alert, Form, Input, Modal, Radio, Space, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@aula/api-client';
import { useApiMutation } from '@/shared/api/hooks';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { paymentKeys, paymentsApi } from './api';
import {
  newIdempotencyKey,
  REFUND_REASON_MAX,
  refundModeForMethod,
  toCreateRefundBody,
  validatePaymentRefund,
  type PaymentRefundErrors,
  type PaymentRefundFormValues,
} from './refund-form';
import type { Payment } from './types';

/**
 * Возврат по платежу (payments.refund в филиале платежа; кнопка — по payment.canRefund от сервера).
 * Весь остаток или частично (не больше refundableAmount), причина обязательна. Ключ идемпотентности —
 * один на открытие диалога.
 */
export function RefundDialog({ payment, open, onClose }: { payment: Payment; open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [form] = Form.useForm<PaymentRefundFormValues>();
  const [idempotencyKey] = useState(newIdempotencyKey);
  const mode = Form.useWatch('mode', form) ?? 'full';
  const refundable = payment.refundableAmount.amount;
  const refundMode = refundModeForMethod(payment.method);

  const refund = useApiMutation((values: PaymentRefundFormValues) => paymentsApi.refund(payment.id, toCreateRefundBody(values, idempotencyKey)), {
    invalidate: [paymentKeys.all],
    successMessage: refundMode === 'manual' ? t('payments.refundDialog.requestedManual') : t('payments.refundDialog.requested'),
    onSuccess: () => onClose(),
  });

  const fieldRule = (field: keyof PaymentRefundErrors) => ({
    validator: async () => {
      const issue = validatePaymentRefund(form.getFieldsValue(true), refundable)[field];
      if (issue) throw new Error(t(`payments.refundDialog.issues.${issue}`));
    },
  });

  const submit = async () => {
    await form.validateFields();
    await refund.mutateAsync(form.getFieldsValue(true));
  };

  return (
    <Modal
      open={open}
      title={t('payments.refundDialog.title', { number: payment.invoiceNo })}
      onCancel={onClose}
      onOk={() => void submit().catch(() => undefined)}
      okText={t('payments.refundDialog.submit')}
      okButtonProps={{ danger: true, loading: refund.isPending, disabled: refundable <= 0 }}
      cancelText={t('common.close')}
      destroyOnHidden
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t(`payments.refundDialog.hint.${refundMode}`)} />
      <Space direction="vertical" size={0} style={{ marginBottom: 12 }}>
        <Typography.Text strong>{t('payments.refundDialog.refundable', { amount: formatMoney(payment.refundableAmount, i18n.language) })}</Typography.Text>
        {payment.refundedAmount.amount > 0 ? (
          <Typography.Text type="secondary">
            {t('payments.refundDialog.alreadyRefunded', { amount: formatMoney(payment.refundedAmount, i18n.language) })}
          </Typography.Text>
        ) : null}
      </Space>
      <Form<PaymentRefundFormValues> form={form} layout="vertical" requiredMark={false} preserve={false} initialValues={{ mode: 'full' }}>
        <Form.Item name="mode" rules={[fieldRule('mode')]}>
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            options={(['full', 'partial'] as const).map((value) => ({ value, label: t(`payments.refundDialog.mode.${value}`) }))}
          />
        </Form.Item>
        {mode === 'partial' ? (
          <Form.Item name="amount" label={t('payments.refundDialog.amount')} rules={[fieldRule('amount')]}>
            <MoneyInput size="large" max={refundable} style={{ maxWidth: 240 }} autoFocus />
          </Form.Item>
        ) : null}
        <Form.Item name="reason" label={t('payments.refundDialog.reason')} rules={[fieldRule('reason')]}>
          <Input.TextArea rows={2} maxLength={REFUND_REASON_MAX} showCount placeholder={t('payments.refundDialog.reasonPlaceholder')} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
