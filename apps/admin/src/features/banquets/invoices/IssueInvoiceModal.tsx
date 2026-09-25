import { Alert, App, DatePicker, Form, Input, Modal, Radio, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiMutation } from '@/shared/api/hooks';
import { dayjs } from '@/shared/lib/dates';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { MoneyText } from '@/shared/ui/MoneyText';
import { useSectionAbilities } from '../abilities';
import { banquetsApi } from '../api';
import { todayLocal } from '../calendar-layout';
import { CompanySelect } from '../companies/CompanySelect';
import { toIssueInvoiceInput, validateIssueInvoice, type IssueInvoiceFormValues, type IssueInvoiceIssue } from '../invoice-form';
import { useInvalidateBanquets } from '../request/useRequestMutation';
import { PAYER_TYPES, type BanquetRequestDetail, type InvoiceListItem, type PayerType } from '../types';

const FIELD_BY_ISSUE: Record<IssueInvoiceIssue, keyof IssueInvoiceFormValues> = {
  companyRequired: 'companyId',
  amountPositive: 'amount',
  dueDateInPast: 'dueDate',
  descriptionTooLong: 'description',
};

/**
 * Счёт по заявке: физлицу — онлайн-оплата по ссылке, юрлицу — счёт на оплату с реквизитами компании.
 * Сумма и срок по умолчанию — от сервера (остаток предоплаты / до итога сметы; 3 или 5 дней).
 */
export function IssueInvoiceModal({
  open,
  request,
  onClose,
  onIssued,
}: {
  open: boolean;
  request: BanquetRequestDetail;
  onClose: () => void;
  onIssued?: (invoice: InvoiceListItem) => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const abilities = useSectionAbilities();
  const invalidate = useInvalidateBanquets();
  const [payerType, setPayerType] = useState<PayerType>('individual');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [issues, setIssues] = useState<IssueInvoiceIssue[]>([]);

  useEffect(() => {
    if (!open) return;
    setPayerType(request.company ? 'company' : 'individual');
    setCompanyId(request.company?.id ?? null);
    setAmount(null);
    setDueDate(null);
    setDescription('');
    setIssues([]);
  }, [open, request.company]);

  const issue = useApiMutation((values: IssueInvoiceFormValues) => banquetsApi.issueInvoice(request.id, toIssueInvoiceInput(values)), {
    onSuccess: async (invoice) => {
      void message.success(t('banquets.invoices.issued', { number: invoice.number }));
      await invalidate();
      onIssued?.(invoice);
      onClose();
    },
  });

  const submit = () => {
    const values: IssueInvoiceFormValues = { payerType, companyId, amount, dueDate, description };
    const found = validateIssueInvoice(values, todayLocal());
    setIssues(found);
    if (found.length === 0) issue.mutate(values);
  };

  const errorOf = (field: keyof IssueInvoiceFormValues) => {
    const found = issues.find((i) => FIELD_BY_ISSUE[i] === field);
    return found ? t(`banquets.invoices.issues.${found}`) : undefined;
  };

  return (
    <Modal
      open={open}
      title={t('banquets.invoices.issueTitle', { number: request.number })}
      okText={t('banquets.invoices.issue')}
      cancelText={t('common.cancel')}
      onOk={submit}
      onCancel={onClose}
      confirmLoading={issue.isPending}
      width={620}
      destroyOnHidden
    >
      <Space direction="vertical" size={4} style={{ width: '100%', marginBottom: 12 }}>
        <Typography.Text type="secondary">
          {t('banquets.prepayment.required')}: <MoneyText value={request.prepayment.required} /> · {t('banquets.prepayment.paid')}: <MoneyText value={request.prepayment.paid} />
        </Typography.Text>
        <Typography.Text type="secondary">
          {t('banquets.prepayment.quoteTotal')}: <MoneyText value={request.balance.quoteTotal} /> · {t('banquets.prepayment.invoiced')}: <MoneyText value={request.balance.invoiced} />
        </Typography.Text>
      </Space>
      <Form layout="vertical" requiredMark="optional">
        <Form.Item label={t('banquets.invoices.payer')} required>
          <Radio.Group value={payerType} onChange={(e) => setPayerType(e.target.value as PayerType)}>
            <Space direction="vertical">
              {PAYER_TYPES.map((type) => (
                <Radio key={type} value={type}>
                  {t(`banquets.invoices.payerTypes.${type}`)}
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </Form.Item>
        {payerType === 'company' ? (
          <Form.Item label={t('banquets.invoices.company')} required validateStatus={errorOf('companyId') ? 'error' : undefined} help={errorOf('companyId')}>
            <CompanySelect value={companyId} onChange={(id) => setCompanyId(id)} initialCompany={request.company} allowCreate={abilities.companiesEdit} />
          </Form.Item>
        ) : (
          <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('banquets.invoices.onlineHint')} />
        )}
        <Space wrap size={12} style={{ width: '100%' }} align="start">
          <Form.Item label={t('banquets.invoices.amount')} extra={t('banquets.invoices.amountHint')} validateStatus={errorOf('amount') ? 'error' : undefined} help={errorOf('amount')} style={{ width: 260 }}>
            <MoneyInput value={amount} onChange={setAmount} allowClear />
          </Form.Item>
          <Form.Item label={t('banquets.invoices.dueDate')} extra={t('banquets.invoices.dueDateHint')} validateStatus={errorOf('dueDate') ? 'error' : undefined} help={errorOf('dueDate')} style={{ width: 260 }}>
            <DatePicker
              format="DD.MM.YYYY"
              style={{ width: '100%' }}
              value={dueDate ? dayjs(dueDate) : null}
              disabledDate={(d) => d.isBefore(dayjs(todayLocal()), 'day')}
              onChange={(d) => setDueDate(d ? d.format('YYYY-MM-DD') : null)}
            />
          </Form.Item>
        </Space>
        <Form.Item label={t('banquets.invoices.description')} validateStatus={errorOf('description') ? 'error' : undefined} help={errorOf('description')}>
          <Input.TextArea rows={2} maxLength={500} showCount value={description} onChange={(e) => setDescription(e.target.value)} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
