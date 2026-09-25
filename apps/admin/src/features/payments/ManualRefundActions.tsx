import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, Modal, Space } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney, Permission } from '@aula/api-client';
import { useApiMutation } from '@/shared/api/hooks';
import { useCan } from '@/shared/auth/useCan';
import { paymentKeys, paymentsApi } from './api';
import { CONFIRM_COMMENT_MAX, confirmCommentIssue, REFUND_REASON_MAX, reasonIssue } from './refund-form';
import type { PaymentRefund } from './types';

type Dialog = 'confirm' | 'reject' | null;

/**
 * Подтверждение/отклонение ручного возврата (наличные при получении, банковский перевод) финансистом:
 * право payments.manual в филиале платежа, возврат ждёт подтверждения (awaitingManualConfirmation от сервера).
 */
export function ManualRefundActions({ refund, size = 'small' }: { refund: PaymentRefund; size?: 'small' | 'middle' }) {
  const { t } = useTranslation();
  const { can } = useCan();
  const [dialog, setDialog] = useState<Dialog>(null);
  if (!refund.awaitingManualConfirmation || !can(Permission.PaymentsManual, refund.payment.branchId ?? null)) return null;
  return (
    <>
      <Space size={4} wrap onClick={(e) => e.stopPropagation()}>
        <Button size={size} type="primary" icon={<CheckOutlined />} onClick={() => setDialog('confirm')}>
          {t('payments.refunds.confirm')}
        </Button>
        <Button size={size} danger icon={<CloseOutlined />} onClick={() => setDialog('reject')}>
          {t('payments.refunds.reject')}
        </Button>
      </Space>
      {dialog === 'confirm' ? <ConfirmRefundModal refund={refund} onClose={() => setDialog(null)} /> : null}
      {dialog === 'reject' ? <RejectRefundModal refund={refund} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function ConfirmRefundModal({ refund, onClose }: { refund: PaymentRefund; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [form] = Form.useForm<{ comment?: string }>();
  const confirm = useApiMutation((comment: string | null) => paymentsApi.confirmRefund(refund.id, comment), {
    invalidate: [paymentKeys.all],
    successMessage: t('payments.refunds.confirmed'),
    onSuccess: () => onClose(),
  });
  const submit = async () => {
    const { comment } = await form.validateFields();
    await confirm.mutateAsync(comment?.trim() || null);
  };
  return (
    <Modal
      open
      title={t('payments.refunds.confirmTitle', { amount: formatMoney(refund.amount, i18n.language) })}
      onCancel={onClose}
      onOk={() => void submit().catch(() => undefined)}
      okText={t('payments.refunds.confirmSubmit')}
      okButtonProps={{ loading: confirm.isPending }}
      cancelText={t('common.cancel')}
      destroyOnHidden
    >
      <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={t('payments.refunds.confirmHint')} />
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="comment"
          label={t('payments.refunds.commentLabel')}
          rules={[
            {
              validator: async (_: unknown, value: string | undefined) => {
                const issue = confirmCommentIssue(value);
                if (issue) throw new Error(t(`payments.refunds.issues.${issue}`));
              },
            },
          ]}
        >
          <Input.TextArea rows={2} maxLength={CONFIRM_COMMENT_MAX} showCount placeholder={t('payments.refunds.commentPlaceholder')} autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function RejectRefundModal({ refund, onClose }: { refund: PaymentRefund; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [form] = Form.useForm<{ reason?: string }>();
  const reject = useApiMutation((reason: string) => paymentsApi.rejectRefund(refund.id, reason), {
    invalidate: [paymentKeys.all],
    successMessage: t('payments.refunds.rejected'),
    onSuccess: () => onClose(),
  });
  const submit = async () => {
    const { reason } = await form.validateFields();
    await reject.mutateAsync((reason ?? '').trim());
  };
  return (
    <Modal
      open
      title={t('payments.refunds.rejectTitle', { amount: formatMoney(refund.amount, i18n.language) })}
      onCancel={onClose}
      onOk={() => void submit().catch(() => undefined)}
      okText={t('payments.refunds.rejectSubmit')}
      okButtonProps={{ danger: true, loading: reject.isPending }}
      cancelText={t('common.cancel')}
      destroyOnHidden
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('payments.refunds.rejectHint')} />
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          name="reason"
          label={t('payments.refunds.rejectReason')}
          rules={[
            {
              validator: async (_: unknown, value: string | undefined) => {
                const issue = reasonIssue(value);
                if (issue) throw new Error(t(`payments.refunds.issues.${issue}`));
              },
            },
          ]}
        >
          <Input.TextArea rows={2} maxLength={REFUND_REASON_MAX} showCount autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  );
}
