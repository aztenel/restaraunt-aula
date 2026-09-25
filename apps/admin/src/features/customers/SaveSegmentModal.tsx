import { Alert, Form, Input, Modal, Radio, Space, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiMutation } from '@/shared/api/hooks';
import { customerKeys, customersApi } from './api';
import { FilterSummary } from './CustomerTags';
import { isFilterEmpty } from './customer-filter';
import { toSaveSegmentBody, validateSegmentForm, type SegmentFormValues } from './segment-form';
import type { CustomerFilterDto, Segment } from './types';

type Target = 'new' | 'update';

/**
 * Сохранение сегмента (customers.manage):
 *  - из списка гостей — текущие условия как новый сегмент или обновление выбранного сегмента;
 *  - на вкладке «Сегменты» (editOnly) — название и описание, условия не меняются.
 */
export function SaveSegmentModal({
  filter,
  currentSegment,
  editOnly = false,
  onClose,
  onSaved,
}: {
  filter?: CustomerFilterDto;
  currentSegment?: Segment | null;
  editOnly?: boolean;
  onClose: () => void;
  onSaved?: (segment: Segment) => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm<SegmentFormValues>();
  const [target, setTarget] = useState<Target>(editOnly ? 'update' : 'new');
  const canUpdate = Boolean(currentSegment);
  const effectiveFilter: CustomerFilterDto = editOnly ? (currentSegment?.filter ?? {}) : (filter ?? {});

  const save = useApiMutation(
    (values: SegmentFormValues) => {
      const body = toSaveSegmentBody(values, effectiveFilter);
      return target === 'update' && currentSegment ? customersApi.updateSegment(currentSegment.id, body) : customersApi.createSegment(body);
    },
    {
      invalidate: [customerKeys.segments],
      successMessage: t('customers.segments.saved'),
      onSuccess: (segment) => (onSaved ? onSaved(segment) : onClose()),
    },
  );

  const fieldRule = (field: 'name' | 'description') => ({
    validator: async () => {
      const issue = validateSegmentForm(form.getFieldsValue(true))[field];
      if (issue) throw new Error(t(`customers.segments.modal.issues.${issue}`));
    },
  });

  const initial: SegmentFormValues =
    editOnly && currentSegment ? { name: currentSegment.name, description: currentSegment.description ?? '' } : { name: '', description: '' };

  return (
    <Modal
      open
      title={editOnly ? t('customers.segments.modal.editTitle') : t('customers.segments.modal.createTitle')}
      okText={t('common.save')}
      okButtonProps={{ loading: save.isPending }}
      cancelText={t('common.cancel')}
      onCancel={onClose}
      onOk={() =>
        void form
          .validateFields()
          .then(() => save.mutateAsync(form.getFieldsValue(true)))
          .catch(() => undefined)
      }
      destroyOnHidden
    >
      <Form<SegmentFormValues> form={form} layout="vertical" requiredMark={false} initialValues={initial}>
        {!editOnly && canUpdate && currentSegment ? (
          <Form.Item label={t('customers.segments.modal.target')}>
            <Radio.Group
              value={target}
              onChange={(e) => {
                const next = e.target.value as Target;
                setTarget(next);
                form.setFieldsValue(
                  next === 'update' ? { name: currentSegment.name, description: currentSegment.description ?? '' } : { name: '', description: '' },
                );
              }}
            >
              <Space direction="vertical">
                <Radio value="new">{t('customers.segments.modal.saveAsNew')}</Radio>
                <Radio value="update">{t('customers.segments.modal.updateExisting', { name: currentSegment.name })}</Radio>
              </Space>
            </Radio.Group>
          </Form.Item>
        ) : null}
        <Form.Item name="name" label={t('customers.segments.modal.name')} rules={[fieldRule('name')]}>
          <Input maxLength={120} placeholder={t('customers.segments.modal.namePlaceholder')} autoFocus />
        </Form.Item>
        <Form.Item name="description" label={t('customers.segments.modal.description')} rules={[fieldRule('description')]}>
          <Input.TextArea rows={2} maxLength={500} showCount />
        </Form.Item>
      </Form>
      <Typography.Text strong>{t('customers.segments.modal.filter')}</Typography.Text>
      <div style={{ margin: '8px 0' }}>
        <FilterSummary filter={effectiveFilter} />
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {editOnly ? t('customers.segments.modal.keepFilter') : t('customers.segments.modal.fromList')}
      </Typography.Text>
      {!editOnly && isFilterEmpty(effectiveFilter) ? (
        <Alert type="warning" showIcon style={{ marginTop: 12 }} message={t('customers.segments.modal.emptyFilter')} />
      ) : null}
    </Modal>
  );
}
