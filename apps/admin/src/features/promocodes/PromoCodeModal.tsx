import { Col, DatePicker, Form, Input, InputNumber, Modal, Radio, Row, Select, Switch } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Permission, translate } from '@aula/api-client';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { useCan } from '@/shared/auth/useCan';
import { useBranch } from '@/shared/branch/BranchProvider';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { promoApi } from './api';
import {
  emptyPromoForm,
  formValuesToPromoInput,
  PROMO_KINDS,
  promoToFormValues,
  validatePromoForm,
  type PromoCode,
  type PromoFormErrors,
  type PromoFormValues,
} from './promo-form';

const NETWORK = '__network__';

/** Где действует промокод: филиал или «Вся сеть» (значение формы null). Совместим с Form.Item. */
function ScopeSelect({
  value,
  onChange,
  options,
}: {
  value?: string | null;
  onChange?: (value: string | null) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Select<string>
      showSearch
      optionFilterProp="label"
      value={value === null ? NETWORK : (value ?? undefined)}
      onChange={(next) => onChange?.(next === NETWORK ? null : next)}
      options={options}
    />
  );
}

/**
 * Создание и изменение промокода. Выбор «Вся сеть» — только при глобальном праве promocodes.manage;
 * филиалы — те, где у сотрудника есть это право. Применимость к заказу считает сервер.
 */
export function PromoCodeModal({
  promo,
  open,
  defaultBranchId,
  onClose,
  onSaved,
}: {
  /** null — новый промокод. */
  promo: PromoCode | null;
  open: boolean;
  defaultBranchId: string | null;
  onClose: () => void;
  onSaved: (promo: PromoCode) => void;
}) {
  const { t, i18n } = useTranslation();
  const { can, branchesWith } = useCan();
  const { branches } = useBranch();
  const notifyError = useNotifyError();
  const [form] = Form.useForm<PromoFormValues>();
  const [saving, setSaving] = useState(false);
  const canNetwork = can(Permission.PromoCodesManage);
  const scope = branchesWith(Permission.PromoCodesManage);
  const branchOptions = branches.filter((b) => scope === 'all' || scope.includes(b.id));
  const initialBranch = canNetwork ? defaultBranchId : (defaultBranchId ?? branchOptions[0]?.id ?? null);
  const kind = Form.useWatch('kind', form) ?? promo?.kind ?? 'percent';

  const fieldRule = (field: keyof PromoFormErrors) => ({
    validator: async () => {
      const issue = validatePromoForm(form.getFieldsValue(true), { canNetwork })[field];
      if (issue) throw new Error(t(`promoCodes.issues.${issue}`));
    },
  });

  const submit = async () => {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    const input = formValuesToPromoInput(form.getFieldsValue(true));
    setSaving(true);
    try {
      const saved = promo ? await promoApi.update(promo.id, input) : await promoApi.create(input);
      onSaved(saved);
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={promo ? t('promoCodes.editTitle', { code: promo.code }) : t('promoCodes.createTitle')}
      onCancel={onClose}
      onOk={() => void submit()}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      okButtonProps={{ loading: saving }}
      width={680}
      destroyOnHidden
    >
      <Form<PromoFormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={promo ? promoToFormValues(promo, i18n.language) : emptyPromoForm(initialBranch)}
        preserve={false}
      >
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item
              name="code"
              label={t('promoCodes.form.code')}
              extra={t('promoCodes.form.codeHint')}
              rules={[fieldRule('code')]}
              normalize={(value: string) => value.toUpperCase().replace(/\s+/g, '')}
            >
              <Input maxLength={32} style={{ fontFamily: 'monospace' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="branchId" label={t('promoCodes.form.branch')} extra={canNetwork ? undefined : t('promoCodes.form.networkHint')} rules={[fieldRule('branchId')]}>
              <ScopeSelect
                options={[
                  ...(canNetwork ? [{ value: NETWORK, label: t('promoCodes.network') }] : []),
                  ...branchOptions.map((b) => ({ value: b.id, label: translate(b.name, i18n.language) })),
                ]}
              />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="kind" label={t('promoCodes.form.kind')}>
          <Radio.Group optionType="button" buttonStyle="solid" options={PROMO_KINDS.map((k) => ({ value: k, label: t(`promoCodes.kinds.${k}`) }))} />
        </Form.Item>
        <Row gutter={16}>
          {kind === 'percent' ? (
            <Col xs={24} md={12}>
              <Form.Item name="percent" label={t('promoCodes.form.percent')} extra={t('promoCodes.form.percentHint')} dependencies={['kind']} rules={[fieldRule('percent')]}>
                <Input inputMode="decimal" suffix="%" style={{ maxWidth: 200 }} />
              </Form.Item>
            </Col>
          ) : null}
          {kind === 'fixed' ? (
            <Col xs={24} md={12}>
              <Form.Item name="fixedAmount" label={t('promoCodes.form.fixedAmount')} extra={t('promoCodes.form.fixedHint')} dependencies={['kind']} rules={[fieldRule('fixedAmount')]}>
                <MoneyInput style={{ maxWidth: 220 }} />
              </Form.Item>
            </Col>
          ) : null}
          {kind === 'free_delivery' ? (
            <Col xs={24} md={12}>
              <Form.Item label=" " colon={false}>
                <span style={{ color: '#6b5a4b' }}>{t('promoCodes.form.freeDeliveryHint')}</span>
              </Form.Item>
            </Col>
          ) : null}
          <Col xs={24} md={12}>
            <Form.Item name="minSubtotal" label={t('promoCodes.form.minSubtotal')} extra={t('promoCodes.form.minSubtotalHint')} rules={[fieldRule('minSubtotal')]}>
              <MoneyInput allowClear style={{ maxWidth: 220 }} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="validFrom" label={t('promoCodes.form.validFrom')}>
              <DatePicker showTime={{ format: 'HH:mm' }} format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="validTo" label={t('promoCodes.form.validTo')} dependencies={['validFrom']} rules={[fieldRule('validTo')]}>
              <DatePicker showTime={{ format: 'HH:mm' }} format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="totalLimit" label={t('promoCodes.form.totalLimit')} extra={t('promoCodes.form.limitHint')} rules={[fieldRule('totalLimit')]}>
              <InputNumber min={1} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="perPhoneLimit" label={t('promoCodes.form.perPhoneLimit')} extra={t('promoCodes.form.limitHint')} rules={[fieldRule('perPhoneLimit')]}>
              <InputNumber min={1} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="description" label={t('promoCodes.form.description')} rules={[fieldRule('description')]}>
          <Input.TextArea rows={2} maxLength={500} showCount />
        </Form.Item>
        <Form.Item name="isActive" label={t('promoCodes.form.isActive')} valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
