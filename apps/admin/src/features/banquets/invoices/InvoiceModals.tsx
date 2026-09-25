import { Alert, App, DatePicker, Form, Input, Modal, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney, toApiError } from '@aula/api-client';
import { useApiMutation } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { dayjs, formatDateTime, isoToPickerValue, pickerValueToIso } from '@/shared/lib/dates';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { banquetsApi } from '../api';
import {
  newIdempotencyKey,
  overpaymentRemaining,
  toBankTransferInput,
  toRefundInput,
  validateBankTransfer,
  validateRefund,
  type BankTransferIssue,
  type RefundIssue,
} from '../invoice-form';
import { useInvalidateBanquets } from '../request/useRequestMutation';
import type { Invoice, InvoicePayment, Money } from '../types';

/**
 * Поступление по безналу (финансы): сумма не больше остатка по счёту, дата не в будущем, номер п/п.
 * Переплату сервер отклоняет (409 banquet_invoice.overpayment) — остаток показывается в окне.
 */
export function BankTransferModal({ open, invoice, onClose }: { open: boolean; invoice: Invoice; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const notifyError = useNotifyError();
  const invalidate = useInvalidateBanquets();
  const [amount, setAmount] = useState<number | null>(null);
  const [paidAt, setPaidAt] = useState<Dayjs | null>(null);
  const [documentNumber, setDocumentNumber] = useState('');
  const [issues, setIssues] = useState<BankTransferIssue[]>([]);
  const [overpayment, setOverpayment] = useState<Money | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount(invoice.remaining.amount > 0 ? invoice.remaining.amount : null);
    setPaidAt(isoToPickerValue(new Date().toISOString()));
    setDocumentNumber('');
    setIssues([]);
    setOverpayment(null);
  }, [open, invoice.remaining.amount]);

  const register = useApiMutation((input: ReturnType<typeof toBankTransferInput>) => banquetsApi.registerBankTransfer(invoice.id, input), {
    errorTitle: false,
    onSuccess: async (result) => {
      if (result.duplicate) void message.info(t('banquets.invoices.bankTransfer.duplicate'));
      else void message.success(t('banquets.invoices.bankTransfer.done'));
      await invalidate();
      onClose();
    },
    onError: (error) => {
      const apiError = toApiError(error);
      if (apiError.code === 'banquet_invoice.overpayment') setOverpayment(overpaymentRemaining(apiError.details) ?? invoice.remaining);
      else notifyError(error);
    },
  });

  const submit = () => {
    const values = { amount, paidAt: pickerValueToIso(paidAt), documentNumber };
    const found = validateBankTransfer(values, { remaining: invoice.remaining, nowMs: Date.now() });
    setIssues(found);
    setOverpayment(null);
    if (found.length === 0) register.mutate(toBankTransferInput(values));
  };

  const errorOf = (...codes: BankTransferIssue[]) => {
    const found = issues.find((i) => codes.includes(i));
    return found ? t(`banquets.invoices.bankTransfer.issues.${found}`, { amount: formatMoney(invoice.remaining, i18n.language) }) : undefined;
  };

  return (
    <Modal
      open={open}
      title={t('banquets.invoices.bankTransfer.title', { number: invoice.number })}
      okText={t('banquets.invoices.bankTransfer.action')}
      cancelText={t('common.cancel')}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={register.isPending}
      destroyOnHidden
    >
      <Typography.Paragraph>
        {t('banquets.invoices.bankTransfer.remaining', { amount: formatMoney(invoice.remaining, i18n.language) })}
      </Typography.Paragraph>
      {overpayment ? (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} message={t('banquets.invoices.bankTransfer.overpayment', { amount: formatMoney(overpayment, i18n.language) })} />
      ) : null}
      <Form layout="vertical" requiredMark="optional">
        <Form.Item
          label={t('banquets.invoices.bankTransfer.amount')}
          required
          validateStatus={errorOf('amountRequired', 'amountPositive', 'overpayment') ? 'error' : undefined}
          help={errorOf('amountRequired', 'amountPositive', 'overpayment')}
        >
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Form.Item>
        <Form.Item
          label={t('banquets.invoices.bankTransfer.paidAt')}
          required
          validateStatus={errorOf('paidAtRequired', 'paidAtInFuture') ? 'error' : undefined}
          help={errorOf('paidAtRequired', 'paidAtInFuture')}
        >
          <DatePicker
            showTime={{ format: 'HH:mm' }}
            format="DD.MM.YYYY HH:mm"
            value={paidAt}
            onChange={setPaidAt}
            disabledDate={(d) => d.isAfter(dayjs(), 'day')}
            style={{ width: '100%' }}
          />
        </Form.Item>
        <Form.Item
          label={t('banquets.invoices.bankTransfer.documentNumber')}
          required
          validateStatus={errorOf('documentRequired', 'documentTooLong') ? 'error' : undefined}
          help={errorOf('documentRequired', 'documentTooLong')}
        >
          <Input value={documentNumber} maxLength={60} onChange={(e) => setDocumentNumber(e.target.value)} />
        </Form.Item>
      </Form>
      <Typography.Text type="secondary">{t('banquets.invoices.bankTransfer.prepaidHint')}</Typography.Text>
    </Modal>
  );
}

/** Отмена выставленного счёта без оплат (с оплатами — только возврат). */
export function CancelInvoiceModal({ open, invoice, onClose }: { open: boolean; invoice: Invoice; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidateBanquets();
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const cancel = useApiMutation(() => banquetsApi.cancelInvoice(invoice.id, reason), {
    successMessage: t('banquets.invoices.cancel.done'),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      title={t('banquets.invoices.cancel.title', { number: invoice.number })}
      okText={t('banquets.invoices.cancel.action')}
      okButtonProps={{ danger: true }}
      cancelText={t('common.cancel')}
      onOk={() => cancel.mutate()}
      onCancel={onClose}
      confirmLoading={cancel.isPending}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">{t('banquets.invoices.cancel.hint')}</Typography.Paragraph>
      <Form layout="vertical">
        <Form.Item label={t('banquets.invoices.cancel.reason')}>
          <Input.TextArea rows={3} maxLength={1000} showCount value={reason} onChange={(e) => setReason(e.target.value)} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** Возврат платежа по счёту заявки (payments.refund). Ключ идемпотентности — один на открытие окна. */
export function RefundModal({ open, requestId, payment, onClose }: { open: boolean; requestId: string; payment: InvoicePayment | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const invalidate = useInvalidateBanquets();
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [issues, setIssues] = useState<RefundIssue[]>([]);
  const key = useRef(newIdempotencyKey());

  useEffect(() => {
    if (!open) return;
    setAmount(null);
    setReason('');
    setIssues([]);
    key.current = newIdempotencyKey();
  }, [open]);

  const refund = useApiMutation((input: ReturnType<typeof toRefundInput>) => banquetsApi.refund(requestId, input), {
    onSuccess: async (result) => {
      const amount = formatMoney(result.amount, i18n.language);
      if (result.status === 'pending') void message.info(t('banquets.invoices.refund.pending', { amount }));
      else if (result.status === 'failed') void message.error(t('banquets.invoices.refund.failed', { amount }));
      else void message.success(t('banquets.invoices.refund.done', { amount }));
      await invalidate();
      onClose();
    },
  });

  if (!payment) return null;

  const submit = () => {
    const values = { amount, reason };
    const found = validateRefund(values, payment);
    setIssues(found);
    if (found.length === 0) refund.mutate(toRefundInput(values, payment.paymentId, key.current));
  };

  const errorOf = (...codes: RefundIssue[]) => {
    const found = issues.find((i) => codes.includes(i));
    return found ? t(`banquets.invoices.refund.issues.${found}`, { amount: formatMoney(payment.refundable, i18n.language) }) : undefined;
  };

  return (
    <Modal
      open={open}
      title={t('banquets.invoices.refund.title')}
      okText={t('banquets.invoices.refund.action')}
      okButtonProps={{ danger: true }}
      cancelText={t('common.cancel')}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={refund.isPending}
      destroyOnHidden
    >
      <Typography.Paragraph>
        {t('banquets.invoices.refund.payment', { amount: formatMoney(payment.amount, i18n.language), date: formatDateTime(payment.paidAt) })}
        {payment.refunded.amount > 0 ? (
          <>
            <br />
            <Typography.Text type="secondary">{t('banquets.invoices.refund.alreadyRefunded', { amount: formatMoney(payment.refunded, i18n.language) })}</Typography.Text>
          </>
        ) : null}
        <br />
        <Typography.Text strong>{t('banquets.invoices.refund.refundable', { amount: formatMoney(payment.refundable, i18n.language) })}</Typography.Text>
      </Typography.Paragraph>
      <Form layout="vertical" requiredMark="optional">
        <Form.Item
          label={t('banquets.invoices.refund.amount')}
          extra={t('banquets.invoices.refund.amountHint')}
          validateStatus={errorOf('amountPositive', 'exceedsRefundable', 'nothingToRefund') ? 'error' : undefined}
          help={errorOf('amountPositive', 'exceedsRefundable', 'nothingToRefund')}
        >
          <MoneyInput value={amount} onChange={setAmount} allowClear />
        </Form.Item>
        <Form.Item
          label={t('banquets.invoices.refund.reason')}
          required
          validateStatus={errorOf('reasonRequired', 'reasonTooLong') ? 'error' : undefined}
          help={errorOf('reasonRequired', 'reasonTooLong')}
        >
          <Input.TextArea rows={3} maxLength={500} showCount value={reason} onChange={(e) => setReason(e.target.value)} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
