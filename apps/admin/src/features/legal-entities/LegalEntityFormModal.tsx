import { Col, Form, Input, Modal, Row, Switch } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatFixed2ForInput, parseFixed2, type LegalEntity, type LegalEntityInput } from '@aula/api-client';
import { legalEntitiesApi } from '@/shared/api/endpoints';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { BIK_PATTERN, BIN_PATTERN, IBAN_PATTERN, KBE_PATTERN, normalizeCode } from './validation';

interface FormValues extends Omit<LegalEntityInput, 'vatRateBp' | 'actualAddress' | 'vatCertificate' | 'phone' | 'email'> {
  /** Ставка НДС в процентах строкой ("16", "12,5") — в API уходит в базисных пунктах. */
  vatRate?: string;
  actualAddress?: string;
  vatCertificate?: string;
  phone?: string;
  email?: string;
}

function nullable(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

export function LegalEntityFormModal({
  open,
  entity,
  onClose,
  onSaved,
}: {
  open: boolean;
  entity: LegalEntity | null;
  onClose: () => void;
  onSaved: (entity: LegalEntity) => void;
}) {
  const { t, i18n } = useTranslation();
  const [form] = Form.useForm<FormValues>();
  const notifyError = useNotifyError();
  const [saving, setSaving] = useState(false);
  const vatPayer = Form.useWatch('vatPayer', form);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (entity) {
      form.setFieldsValue({
        ...entity,
        actualAddress: entity.actualAddress ?? undefined,
        vatCertificate: entity.vatCertificate ?? undefined,
        phone: entity.phone ?? undefined,
        email: entity.email ?? undefined,
        vatRate: entity.vatPayer ? formatFixed2ForInput(entity.vatRateBp, i18n.language) : undefined,
      });
    } else {
      form.setFieldsValue({ directorPosition: t('legalEntities.defaults.directorPosition'), actingBasis: t('legalEntities.defaults.actingBasis'), kbe: '17', vatPayer: false, isDefault: false });
    }
  }, [open, entity, form, t, i18n.language]);

  const submit = async () => {
    const values = await form.validateFields();
    const rate = values.vatPayer ? parseFixed2(values.vatRate ?? '', { max: 10_000 }) : null;
    const input: LegalEntityInput = {
      name: values.name.trim(),
      shortName: values.shortName.trim(),
      bin: normalizeCode(values.bin),
      legalAddress: values.legalAddress.trim(),
      actualAddress: nullable(values.actualAddress),
      directorName: values.directorName.trim(),
      directorPosition: values.directorPosition.trim(),
      actingBasis: values.actingBasis.trim(),
      bankName: values.bankName?.trim() ?? '',
      iban: normalizeCode(values.iban),
      bik: normalizeCode(values.bik),
      kbe: values.kbe.trim(),
      vatPayer: values.vatPayer,
      vatRateBp: rate && rate.ok ? rate.value : 0,
      vatCertificate: nullable(values.vatCertificate),
      phone: nullable(values.phone),
      email: nullable(values.email),
      isDefault: values.isDefault ?? false,
    };
    setSaving(true);
    try {
      onSaved(entity ? await legalEntitiesApi.update(entity.id, input) : await legalEntitiesApi.create(input));
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  const req = { required: true, message: t('common.required') };
  const codeRule = (pattern: RegExp, message: string, optional = false) => ({
    validator: async (_: unknown, value: string | undefined) => {
      const v = normalizeCode(value);
      if (optional && v === '') return;
      if (!pattern.test(v)) throw new Error(message);
    },
  });

  return (
    <Modal
      open={open}
      title={entity ? t('legalEntities.editTitle') : t('legalEntities.createTitle')}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      onOk={() => void submit()}
      onCancel={onClose}
      confirmLoading={saving}
      width={760}
      destroyOnHidden
    >
      <Form<FormValues> form={form} layout="vertical" requiredMark="optional">
        <Row gutter={12}>
          <Col xs={24} sm={16}>
            <Form.Item name="name" label={t('legalEntities.name')} rules={[req]} extra={t('legalEntities.nameHint')}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="shortName" label={t('legalEntities.shortName')} rules={[req]}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="bin" label={t('legalEntities.bin')} rules={[req, codeRule(BIN_PATTERN, t('legalEntities.binRule'))]} extra={t('legalEntities.binHint')}>
              <Input inputMode="numeric" maxLength={12} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={16}>
            <Form.Item name="legalAddress" label={t('legalEntities.legalAddress')} rules={[req]}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="actualAddress" label={t('legalEntities.actualAddress')}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} sm={10}>
            <Form.Item name="directorName" label={t('legalEntities.directorName')} rules={[req]}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} sm={7}>
            <Form.Item name="directorPosition" label={t('legalEntities.directorPosition')} rules={[req]}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={12} sm={7}>
            <Form.Item name="actingBasis" label={t('legalEntities.actingBasis')} rules={[req]} extra={t('legalEntities.actingBasisHint')}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="bankName" label={t('legalEntities.bankName')}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="iban" label={t('legalEntities.iban')} rules={[codeRule(IBAN_PATTERN, t('legalEntities.ibanRule'), true)]} extra={t('legalEntities.ibanHint')}>
              <Input maxLength={34} placeholder="KZ00 0000 0000 0000 0000" />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8}>
            <Form.Item name="bik" label={t('legalEntities.bik')} rules={[codeRule(BIK_PATTERN, t('legalEntities.bikRule'), true)]}>
              <Input maxLength={11} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={4}>
            <Form.Item name="kbe" label={t('legalEntities.kbe')} rules={[req, codeRule(KBE_PATTERN, t('legalEntities.kbeRule'))]}>
              <Input maxLength={2} inputMode="numeric" />
            </Form.Item>
          </Col>
          <Col xs={12} sm={6}>
            <Form.Item name="vatPayer" label={t('legalEntities.vatPayer')} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
          <Col xs={12} sm={6}>
            <Form.Item
              name="vatRate"
              label={t('legalEntities.vatRate')}
              extra={t('legalEntities.vatRateHint')}
              rules={
                vatPayer
                  ? [
                      req,
                      {
                        validator: async (_, value: string | undefined) => {
                          const parsed = parseFixed2(value ?? '', { max: 10_000 });
                          if (!parsed.ok || parsed.value <= 0) throw new Error(t('legalEntities.vatRateRule'));
                        },
                      },
                    ]
                  : []
              }
            >
              <Input disabled={!vatPayer} suffix="%" inputMode="decimal" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="vatCertificate" label={t('legalEntities.vatCertificate')}>
              <Input disabled={!vatPayer} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="phone" label={t('users.phone')}>
              <Input inputMode="tel" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="email" label={t('auth.email')} rules={[{ type: 'email', message: t('common.invalidEmail') }]}>
              <Input inputMode="email" />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="isDefault" label={t('legalEntities.isDefault')} valuePropName="checked" extra={t('legalEntities.isDefaultHint')}>
              <Switch />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
