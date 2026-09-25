import { Col, Divider, Form, Input, Modal, Row } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toApiError } from '@aula/api-client';
import { errorMessage } from '@/shared/api/errors';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { banquetsApi } from '../api';
import type { ClientCompany } from '../types';
import {
  BIK_PATTERN,
  BIN_PATTERN,
  companyToForm,
  EMAIL_PATTERN,
  IBAN_PATTERN,
  KBE_PATTERN,
  normalizeCode,
  toCompanyInput,
  type CompanyField,
  type CompanyFormValues,
} from './company-form';

/** Ошибки сервера, которые относятся к конкретному полю формы. */
const FIELD_BY_ERROR: Record<string, CompanyField> = {
  'banquet_company.invalid_bin': 'bin',
  'banquet_company.duplicate_bin': 'bin',
  'banquet_company.invalid_iban': 'iban',
  'banquet_company.invalid_bik': 'bik',
  'banquet_company.invalid_kbe': 'kbe',
  'banquet_company.invalid_email': 'contactEmail',
  'phone.invalid': 'contactPhone',
};

/** Создание/правка реквизитов компании-заказчика (договор, счёт, акт, ЭСФ). */
export function CompanyFormModal({
  open,
  company,
  onClose,
  onSaved,
}: {
  open: boolean;
  company: ClientCompany | null;
  onClose: () => void;
  onSaved: (company: ClientCompany) => void;
}) {
  const { t, i18n } = useTranslation();
  const [form] = Form.useForm<CompanyFormValues>();
  const notifyError = useNotifyError();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (company) form.setFieldsValue(companyToForm(company));
    else form.setFieldsValue({ kbe: '17' });
  }, [open, company, form]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const input = toCompanyInput(values);
      onSaved(company ? await banquetsApi.updateCompany(company.id, input) : await banquetsApi.createCompany(input));
    } catch (error) {
      const apiError = toApiError(error);
      const field = FIELD_BY_ERROR[apiError.code];
      if (field) form.setFields([{ name: field, errors: [errorMessage(apiError, i18n.language)] }]);
      else notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  const req = { required: true, whitespace: true, message: t('common.required') };
  const codeRule = (pattern: RegExp, message: string, optional = true) => ({
    validator: async (_: unknown, value: string | undefined) => {
      const v = normalizeCode(value);
      if (optional && v === '') return;
      if (!pattern.test(v)) throw new Error(message);
    },
  });
  const labels = {
    name: t('banquets.companies.fields.name'),
    bin: t('banquets.companies.fields.bin'),
    legalAddress: t('banquets.companies.fields.legalAddress'),
    bankName: t('banquets.companies.fields.bankName'),
    iban: t('banquets.companies.fields.iban'),
    bik: t('banquets.companies.fields.bik'),
    kbe: t('banquets.companies.fields.kbe'),
    directorName: t('banquets.companies.fields.directorName'),
    directorPosition: t('banquets.companies.fields.directorPosition'),
    actingBasis: t('banquets.companies.fields.actingBasis'),
    contactName: t('banquets.companies.fields.contactName'),
    contactPhone: t('banquets.companies.fields.contactPhone'),
    contactEmail: t('banquets.companies.fields.contactEmail'),
  };
  const f = (key: keyof typeof labels) => labels[key];

  return (
    <Modal
      open={open}
      title={company ? t('banquets.companies.editTitle') : t('banquets.companies.createTitle')}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      onOk={() => void submit()}
      onCancel={onClose}
      confirmLoading={saving}
      width={760}
      destroyOnHidden
    >
      <Form<CompanyFormValues> form={form} layout="vertical" requiredMark="optional">
        <Row gutter={12}>
          <Col xs={24} sm={16}>
            <Form.Item name="name" label={f('name')} rules={[req, { max: 300 }]}>
              <Input maxLength={300} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item
              name="bin"
              label={f('bin')}
              rules={[req, codeRule(BIN_PATTERN, t('banquets.companies.rules.bin'), false)]}
              extra={t('banquets.companies.hints.bin')}
            >
              <Input inputMode="numeric" maxLength={16} />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="legalAddress" label={f('legalAddress')} rules={[req, { max: 500 }]}>
              <Input maxLength={500} />
            </Form.Item>
          </Col>
        </Row>
        <Divider orientation="left" plain style={{ margin: '4px 0 12px' }}>
          {t('banquets.companies.sections.bank')}
        </Divider>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="bankName" label={f('bankName')} rules={[{ max: 200 }]}>
              <Input maxLength={200} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="iban" label={f('iban')} rules={[codeRule(IBAN_PATTERN, t('banquets.companies.rules.iban'))]} extra={t('banquets.companies.hints.iban')}>
              <Input maxLength={34} placeholder="KZ00 0000 0000 0000 0000" />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8}>
            <Form.Item name="bik" label={f('bik')} rules={[codeRule(BIK_PATTERN, t('banquets.companies.rules.bik'))]} extra={t('banquets.companies.hints.bik')}>
              <Input maxLength={11} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={4}>
            <Form.Item name="kbe" label={f('kbe')} rules={[codeRule(KBE_PATTERN, t('banquets.companies.rules.kbe'))]} extra={t('banquets.companies.hints.kbe')}>
              <Input maxLength={2} inputMode="numeric" />
            </Form.Item>
          </Col>
        </Row>
        <Divider orientation="left" plain style={{ margin: '4px 0 12px' }}>
          {t('banquets.companies.sections.director')}
        </Divider>
        <Row gutter={12}>
          <Col xs={24} sm={10}>
            <Form.Item name="directorName" label={f('directorName')} rules={[{ max: 200 }]}>
              <Input maxLength={200} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={7}>
            <Form.Item name="directorPosition" label={f('directorPosition')} rules={[{ max: 200 }]}>
              <Input maxLength={200} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={7}>
            <Form.Item name="actingBasis" label={f('actingBasis')} rules={[{ max: 200 }]} extra={t('banquets.companies.hints.actingBasis')}>
              <Input maxLength={200} />
            </Form.Item>
          </Col>
        </Row>
        <Divider orientation="left" plain style={{ margin: '4px 0 12px' }}>
          {t('banquets.companies.sections.contact')}
        </Divider>
        <Row gutter={12}>
          <Col xs={24} sm={8}>
            <Form.Item name="contactName" label={f('contactName')} rules={[{ max: 200 }]}>
              <Input maxLength={200} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8}>
            <Form.Item name="contactPhone" label={f('contactPhone')} rules={[{ max: 32 }]} extra={t('banquets.companies.hints.contactPhone')}>
              <Input maxLength={32} inputMode="tel" />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8}>
            <Form.Item
              name="contactEmail"
              label={f('contactEmail')}
              rules={[
                {
                  validator: async (_: unknown, value: string | undefined) => {
                    const v = value?.trim() ?? '';
                    if (v && !EMAIL_PATTERN.test(v)) throw new Error(t('banquets.companies.rules.email'));
                  },
                },
              ]}
            >
              <Input maxLength={200} inputMode="email" />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
