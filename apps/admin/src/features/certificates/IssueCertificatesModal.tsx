import { FilePdfOutlined } from '@ant-design/icons';
import { Alert, Button, Checkbox, Col, DatePicker, Divider, Form, Input, InputNumber, List, Modal, Result, Row, Select, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney, translate } from '@aula/api-client';
import { useApiMutation, useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { dayjs, DISPLAY_TIMEZONE } from '@/shared/lib/dates';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { newIdempotencyKey } from '../payments/refund-form';
import { useCertificateAbilities } from './abilities';
import { certificateKeys, certificatesApi } from './api';
import { emptyIssueForm, toManualIssueBody, validateIssueForm, type IssueFormErrors, type IssueFormValues } from './issue-form';
import { CONTENT_LOCALES, DELIVERY_CHANNELS, type ManualIssueResult } from './types';

/**
 * Выпуск сертификатов по счёту — корпоративная продажа (certificates.manage или payments.manual глобально):
 * поступление по банковскому переводу регистрируется и сертификаты выпускаются сразу. Ключ идемпотентности —
 * один на открытие окна (повтор нажатия не выпустит сертификаты дважды).
 */
export function IssueCertificatesModal({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const abilities = useCertificateAbilities();
  const notifyError = useNotifyError();
  const [form] = Form.useForm<IssueFormValues>();
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [today] = useState(() => dayjs().tz(DISPLAY_TIMEZONE).format('YYYY-MM-DD'));
  const [result, setResult] = useState<ManualIssueResult | null>(null);
  const [pdfLoading, setPdfLoading] = useState<string | null>(null);
  const products = useApiQuery(certificateKeys.products, certificatesApi.products);
  const recipientIsBuyer = Form.useWatch('recipientIsBuyer', form) ?? true;
  const productId = Form.useWatch('productId', form);
  const product = products.data?.find((p) => p.id === productId);

  const issue = useApiMutation((values: IssueFormValues) => certificatesApi.issue(toManualIssueBody(values, idempotencyKey)), {
    invalidate: [certificateKeys.all, ['payments']],
    onSuccess: (data) => setResult(data),
  });

  const fieldRule = (field: keyof IssueFormErrors) => ({
    validator: async () => {
      const issueCode = validateIssueForm(form.getFieldsValue(true), today)[field];
      if (issueCode) throw new Error(t(`certificates.issue.issues.${issueCode}`));
    },
  });

  const openPdf = async (id: string) => {
    const popup = window.open('', '_blank');
    setPdfLoading(id);
    try {
      const link = await certificatesApi.pdfLink(id);
      if (popup) popup.location.href = link.url;
      else window.location.assign(link.url);
    } catch (error) {
      popup?.close();
      notifyError(error);
    } finally {
      setPdfLoading(null);
    }
  };

  if (result) {
    return (
      <Modal open title={t('certificates.issue.resultTitle')} onCancel={onClose} footer={<Button type="primary" onClick={onClose}>{t('certificates.issue.done')}</Button>}>
        <Result
          status="success"
          title={t('certificates.issue.success', { count: result.certificates.length })}
          subTitle={t('certificates.issue.resultText', { total: formatMoney(result.order.total, i18n.language) })}
        />
        <List
          size="small"
          bordered
          dataSource={result.certificates}
          renderItem={(c) => (
            <List.Item
              actions={
                abilities.pdf
                  ? [
                      <Button key="pdf" size="small" icon={<FilePdfOutlined />} loading={pdfLoading === c.id} onClick={() => void openPdf(c.id)}>
                        {t('certificates.actions.pdf')}
                      </Button>,
                    ]
                  : []
              }
            >
              <Typography.Text style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{c.maskedCode}</Typography.Text>
              <Typography.Text type="secondary">{formatMoney(c.nominal, i18n.language)}</Typography.Text>
            </List.Item>
          )}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
          {t('certificates.actions.pdfHint')}
        </Typography.Paragraph>
      </Modal>
    );
  }

  return (
    <Modal
      open
      width={760}
      title={t('certificates.issue.title')}
      okText={t('certificates.issue.submit')}
      okButtonProps={{ loading: issue.isPending }}
      cancelText={t('common.cancel')}
      onCancel={onClose}
      onOk={() =>
        void form
          .validateFields()
          .then(() => issue.mutateAsync(form.getFieldsValue(true)))
          .catch(() => undefined)
      }
      destroyOnHidden
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('certificates.issue.hint')} />
      {products.error ? <ErrorAlert error={products.error} onRetry={() => void products.refetch()} /> : null}
      <Form<IssueFormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={emptyIssueForm(i18n.language === 'kk' ? 'kk' : 'ru')}
      >
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item
              name="productId"
              label={t('certificates.issue.product')}
              rules={[fieldRule('productId')]}
              extra={product ? t('certificates.issue.price', { amount: formatMoney(product.price, i18n.language) }) : undefined}
            >
              <Select
                showSearch
                optionFilterProp="label"
                loading={products.isLoading}
                options={(products.data ?? [])
                  .filter((p) => p.isActive)
                  .map((p) => ({ value: p.id, label: `${translate(p.name, i18n.language)} · ${formatMoney(p.nominal, i18n.language)}` }))}
              />
            </Form.Item>
          </Col>
          <Col xs={12} md={5}>
            <Form.Item name="quantity" label={t('certificates.issue.quantity')} rules={[fieldRule('quantity')]}>
              <InputNumber min={1} max={100} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={7}>
            <Form.Item name="total" label={t('certificates.issue.total')} rules={[fieldRule('total')]} extra={t('certificates.issue.totalHint')}>
              <MoneyInput />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left" plain>
          {t('certificates.issue.buyer')}
        </Divider>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="buyerName" label={t('certificates.issue.buyerName')} rules={[fieldRule('buyerName')]}>
              <Input maxLength={120} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="buyerCompany" label={t('certificates.issue.buyerCompany')}>
              <Input maxLength={300} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="buyerPhone" label={t('certificates.issue.phone')} rules={[fieldRule('buyerPhone')]}>
              <Input inputMode="tel" maxLength={32} placeholder="+7" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="buyerEmail" label={t('certificates.issue.email')} rules={[fieldRule('buyerEmail')]}>
              <Input type="email" maxLength={254} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="recipientIsBuyer" valuePropName="checked">
          <Checkbox>{t('certificates.issue.recipientIsBuyer')}</Checkbox>
        </Form.Item>
        {!recipientIsBuyer ? (
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <Form.Item name="recipientName" label={t('certificates.issue.recipientName')} rules={[fieldRule('recipientName')]}>
                <Input maxLength={120} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="recipientPhone" label={t('certificates.issue.phone')} rules={[fieldRule('recipientPhone')]}>
                <Input inputMode="tel" maxLength={32} placeholder="+7" />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="recipientEmail" label={t('certificates.issue.email')} rules={[fieldRule('recipientEmail')]}>
                <Input type="email" maxLength={254} />
              </Form.Item>
            </Col>
          </Row>
        ) : null}
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="deliveryChannel" label={t('certificates.issue.deliveryChannel')}>
              <Select
                options={DELIVERY_CHANNELS.map((value) => ({ value, label: t(`certificates.deliveryChannel.${value}`) }))}
                onChange={() => void form.validateFields(['buyerEmail', 'buyerPhone', 'recipientEmail', 'recipientPhone']).catch(() => undefined)}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="locale" label={t('certificates.issue.locale')}>
              <Select options={CONTENT_LOCALES.map((value) => ({ value, label: t(`certificates.locale.${value}`) }))} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="message" label={t('certificates.issue.message')} rules={[fieldRule('message')]}>
          <Input.TextArea rows={2} maxLength={500} showCount />
        </Form.Item>

        <Divider orientation="left" plain>
          {t('certificates.issue.payment')}
        </Divider>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="documentNumber" label={t('certificates.issue.documentNumber')} rules={[fieldRule('documentNumber')]}>
              <Input maxLength={60} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="paidAt" label={t('certificates.issue.paidAt')} rules={[fieldRule('paidAt')]}>
              <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} disabledDate={(day) => day.format('YYYY-MM-DD') > today} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
