import { Button, Col, ColorPicker, Drawer, Flex, Form, Grid, Input, InputNumber, Radio, Row, Switch } from 'antd';
import type { Color } from 'antd/es/color-picker';
import { useTranslation } from 'react-i18next';
import { useApiMutation } from '@/shared/api/hooks';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { TranslatableInput } from '@/shared/ui/TranslatableInput';
import { certificateKeys, certificatesApi } from './api';
import {
  emptyProductForm,
  productToForm,
  toProductInput,
  validateProductForm,
  type ProductFormErrors,
  type ProductFormValues,
} from './product-form';
import { CERTIFICATE_KINDS, type CertificateProduct } from './types';

/** Создание и изменение продукта сертификата (certificates.manage). Переводимые поля — kk/ru (+en). */
export function ProductDrawer({ product, open, onClose }: { product: CertificateProduct | null; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const screens = Grid.useBreakpoint();
  const [form] = Form.useForm<ProductFormValues>();
  const kind = Form.useWatch('kind', form) ?? product?.kind ?? 'amount';

  const save = useApiMutation(
    (values: ProductFormValues) =>
      product ? certificatesApi.updateProduct(product.id, toProductInput(values)) : certificatesApi.createProduct(toProductInput(values)),
    { invalidate: [certificateKeys.products], successMessage: t('certificates.products.saved'), onSuccess: () => onClose() },
  );

  const fieldRule = (field: keyof ProductFormErrors) => ({
    validator: async () => {
      const issue = validateProductForm(form.getFieldsValue(true))[field];
      if (issue) throw new Error(t(`certificates.products.issues.${issue}`));
    },
  });

  const submit = async () => {
    await form.validateFields();
    await save.mutateAsync(form.getFieldsValue(true));
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={screens.md ? 640 : '100%'}
      title={product ? t('certificates.products.edit') : t('certificates.products.create')}
      destroyOnHidden
      extra={
        <Flex gap={8}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="primary" loading={save.isPending} onClick={() => void submit().catch(() => undefined)}>
            {t('common.save')}
          </Button>
        </Flex>
      }
    >
      <Form<ProductFormValues> form={form} layout="vertical" requiredMark={false} initialValues={product ? productToForm(product) : emptyProductForm()}>
        <Form.Item name="kind" label={t('certificates.products.fields.kind')}>
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            options={CERTIFICATE_KINDS.map((value) => ({ value, label: t(`certificates.kind.${value}`) }))}
            onChange={() => void form.validateFields(['description']).catch(() => undefined)}
          />
        </Form.Item>
        <Form.Item name="name" label={t('certificates.products.fields.name')} rules={[fieldRule('name')]}>
          <TranslatableInput maxLength={200} />
        </Form.Item>
        <Form.Item
          name="description"
          label={kind === 'set' ? t('certificates.products.fields.descriptionSet') : t('certificates.products.fields.description')}
          rules={[fieldRule('description')]}
        >
          <TranslatableInput multiline rows={3} maxLength={2000} required={kind === 'set' ? ['kk', 'ru'] : []} />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item
              name="nominal"
              label={t('certificates.products.fields.nominal')}
              rules={[fieldRule('nominal')]}
              extra={kind === 'set' ? t('certificates.products.fields.nominalSetHint') : undefined}
            >
              <MoneyInput />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="price" label={t('certificates.products.fields.price')} rules={[fieldRule('price')]}>
              <MoneyInput />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="validityMonths" label={t('certificates.products.fields.validityMonths')} rules={[fieldRule('validityMonths')]}>
              <InputNumber min={1} max={60} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="slug" label={t('certificates.products.fields.slug')} rules={[fieldRule('slug')]} extra={t('certificates.products.fields.slugHint')}>
              <Input maxLength={80} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8}>
            <Form.Item
              name="color"
              label={t('certificates.products.fields.color')}
              rules={[fieldRule('color')]}
              getValueFromEvent={(color: Color) => color.toHexString()}
            >
              <ColorPicker disabledAlpha showText format="hex" />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8}>
            <Form.Item name="theme" label={t('certificates.products.fields.theme')}>
              <Input maxLength={40} placeholder="classic" />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8}>
            <Form.Item name="sortOrder" label={t('certificates.products.fields.sortOrder')}>
              <InputNumber min={-10000} max={10000} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="imageUrl" label={t('certificates.products.fields.imageUrl')}>
          <Input type="url" maxLength={500} placeholder="https://" />
        </Form.Item>
        <Form.Item name="isActive" label={t('certificates.products.fields.isActive')} valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
