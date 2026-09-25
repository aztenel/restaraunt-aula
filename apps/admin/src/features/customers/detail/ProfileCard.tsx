import { Button, Card, Col, DatePicker, Form, Input, Row, Select, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiMutation, useApiQuery } from '@/shared/api/hooks';
import { customerKeys, customersApi } from '../api';
import { tagLabel } from '../CustomerTags';
import {
  customerToProfileForm,
  normalizeTagInput,
  PROFILE_LIMITS,
  toUpdateCustomerBody,
  validateProfile,
  type ProfileErrors,
  type ProfileFormValues,
} from '../profile-form';
import { AUTO_TAGS, type Customer } from '../types';

/** Профиль, теги, аллергии, предпочтения и заметки гостя. Правка — customers.manage (не для обезличенных). */
export function ProfileCard({ customer, editable }: { customer: Customer; editable: boolean }) {
  const { t } = useTranslation();
  const [form] = Form.useForm<ProfileFormValues>();
  const tags = useApiQuery(customerKeys.tags, customersApi.tags, { staleTime: 60_000, enabled: editable });
  const save = useApiMutation((values: ProfileFormValues) => customersApi.update(customer.id, toUpdateCustomerBody(values)), {
    invalidate: [customerKeys.all],
    successMessage: t('customers.detail.saved'),
  });

  const fieldRule = (field: keyof ProfileErrors) => ({
    validator: async () => {
      const issue = validateProfile(form.getFieldsValue(true))[field];
      if (issue) throw new Error(t(`customers.detail.issues.${issue}`));
    },
  });

  const knownTags = [...new Set([...AUTO_TAGS, ...(tags.data ?? []).map((stat) => stat.tag)])];

  return (
    <Card title={t('customers.detail.profile')}>
      <Form<ProfileFormValues>
        key={customer.updatedAt}
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={!editable}
        initialValues={customerToProfileForm(customer)}
        onFinish={(values) => void save.mutateAsync({ ...form.getFieldsValue(true), ...values }).catch(() => undefined)}
      >
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="name" label={t('customers.detail.name')} rules={[fieldRule('name')]}>
              <Input maxLength={PROFILE_LIMITS.name} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="email" label={t('customers.detail.email')} rules={[fieldRule('email')]}>
              <Input type="email" maxLength={PROFILE_LIMITS.email} />
            </Form.Item>
          </Col>
          <Col xs={12} md={12}>
            <Form.Item name="birthday" label={t('customers.detail.birthday')}>
              <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={12}>
            <Form.Item name="locale" label={t('customers.detail.locale')}>
              <Select options={(['ru', 'kk', 'en'] as const).map((value) => ({ value, label: t(`customers.locales.${value}`) }))} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          name="tags"
          label={t('customers.detail.tags')}
          rules={[fieldRule('tags')]}
          extra={<Typography.Text type="secondary">{t('customers.detail.tagsHint')}</Typography.Text>}
          normalize={(value: string[]) => [...new Set((value ?? []).map(normalizeTagInput).filter(Boolean))]}
        >
          <Select
            mode="tags"
            placeholder={t('customers.detail.tagsPlaceholder')}
            tokenSeparators={[',']}
            options={knownTags.map((tag) => ({ value: tag, label: tagLabel(t, tag) }))}
          />
        </Form.Item>
        <Form.Item name="allergies" label={t('customers.detail.allergies')} rules={[fieldRule('allergies')]}>
          <Input.TextArea rows={2} maxLength={PROFILE_LIMITS.allergies} showCount placeholder={t('customers.detail.allergiesPlaceholder')} />
        </Form.Item>
        <Form.Item name="preferences" label={t('customers.detail.preferences')} rules={[fieldRule('preferences')]}>
          <Input.TextArea rows={2} maxLength={PROFILE_LIMITS.preferences} showCount placeholder={t('customers.detail.preferencesPlaceholder')} />
        </Form.Item>
        <Form.Item name="notes" label={t('customers.detail.notes')} rules={[fieldRule('notes')]}>
          <Input.TextArea rows={3} maxLength={PROFILE_LIMITS.notes} showCount />
        </Form.Item>
        {editable ? (
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            {t('common.save')}
          </Button>
        ) : (
          <Typography.Text type="secondary">{t('customers.detail.readOnly')}</Typography.Text>
        )}
      </Form>
    </Card>
  );
}
