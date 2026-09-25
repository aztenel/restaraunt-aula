import { Alert, Checkbox, Form, Input, Modal } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiMutation } from '@/shared/api/hooks';
import { customerKeys, customersApi } from '../api';
import type { Customer } from '../types';

/**
 * Обезличивание гостя по его требованию (закон РК о ПД, customers.manage): необратимо — телефон, имя,
 * email, день рождения, аллергии, предпочтения, заметки и IP в согласиях стираются, история остаётся
 * для отчётности. Требует явного подтверждения.
 */
export function AnonymizeModal({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { t } = useTranslation();
  const [form] = Form.useForm<{ reason?: string }>();
  const [acknowledged, setAcknowledged] = useState(false);
  const anonymize = useApiMutation((reason: string | null) => customersApi.anonymize(customer.id, reason), {
    invalidate: [customerKeys.all],
    successMessage: t('customers.anonymize.done'),
    onSuccess: () => onClose(),
  });

  return (
    <Modal
      open
      title={t('customers.anonymize.title', { phone: customer.phone ?? '' })}
      okText={t('customers.anonymize.submit')}
      okButtonProps={{ danger: true, disabled: !acknowledged, loading: anonymize.isPending }}
      cancelText={t('common.cancel')}
      onCancel={onClose}
      onOk={() =>
        void form
          .validateFields()
          .then(({ reason }) => anonymize.mutateAsync(reason?.trim() || null))
          .catch(() => undefined)
      }
      destroyOnHidden
    >
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('customers.anonymize.irreversible')}
        description={t('customers.anonymize.warning')}
      />
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item name="reason" label={t('customers.anonymize.reason')}>
          <Input.TextArea rows={2} maxLength={500} showCount placeholder={t('customers.anonymize.reasonPlaceholder')} />
        </Form.Item>
      </Form>
      <Checkbox checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)}>
        {t('customers.anonymize.acknowledge')}
      </Checkbox>
    </Modal>
  );
}
