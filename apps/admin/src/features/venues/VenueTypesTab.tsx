/**
 * Типы мест — общий справочник сети (стол, VIP-зал, юрта, терраса…) с правилами брони по умолчанию.
 * Изменять может только сотрудник с глобальным правом venues.manage; остальным — просмотр.
 */
import { PlusOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Col, Drawer, Form, Input, InputNumber, Row, Space, Switch, Table, Tag, Typography, type TableColumnsType } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Permission, translate } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { useCan } from '@/shared/auth/useCan';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { TranslatableInput, translatableRule } from '@/shared/ui/TranslatableInput';
import { venueConfigApi, venueKeys } from './api';
import { TypeRulesFields } from './RulesFields';
import type { VenueType } from './types';
import { formToVenueTypeInput, venueTypeToForm, type VenueTypeFormValues } from './venue-form';

const TYPE_CODE_RE = /^[a-z][a-z0-9_]{1,31}$/;

export function VenueTypesTab() {
  const { t, i18n } = useTranslation();
  const { can } = useCan();
  const canEdit = can(Permission.VenuesManage);
  const types = useApiQuery(venueKeys.types, venueConfigApi.types);
  const [editing, setEditing] = useState<VenueType | 'new' | null>(null);

  const columns: TableColumnsType<VenueType> = [
    {
      title: t('venues.fields.name'),
      key: 'name',
      render: (_, type) => (
        <Space direction="vertical" size={0}>
          <Typography.Link onClick={() => setEditing(type)}>{translate(type.name, i18n.language) || type.code}</Typography.Link>
          <Typography.Text type="secondary" code style={{ fontSize: 12 }}>
            {type.code}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('venues.rules.durationMinutes'),
      key: 'duration',
      render: (_, type) => t('reservations.minutes', { count: type.rules.durationMinutes }),
    },
    { title: t('venues.rules.holdMinutes'), key: 'hold', render: (_, type) => t('reservations.minutes', { count: type.rules.holdMinutes }) },
    {
      title: t('venues.rules.cancellationDeadlineHours'),
      key: 'deadline',
      render: (_, type) => t('reservations.hours', { count: type.rules.cancellationDeadlineHours }),
    },
    { title: t('venues.rules.cleanupMinutes'), key: 'cleanup', render: (_, type) => t('reservations.minutes', { count: type.rules.cleanupMinutes }) },
    {
      title: t('venues.fields.rules'),
      key: 'flags',
      render: (_, type) => (
        <Space size={4} wrap>
          {type.rules.requiresManualConfirmation ? <Tag color="gold">{t('venues.rules.requiresManualConfirmation')}</Tag> : null}
          <Tag color={type.rules.bookableOnline ? 'green' : 'default'}>
            {type.rules.bookableOnline ? t('venues.rules.bookableOnline') : t('reservations.phoneOnly')}
          </Tag>
          <Tag>{t('venues.rules.slotStepMinutes')}: {type.rules.slotStepMinutes}</Tag>
        </Space>
      ),
    },
    {
      title: t('venues.fields.status'),
      key: 'active',
      render: (_, type) => (type.isActive ? <Tag color="success">{t('common.active')}</Tag> : <Tag>{t('common.inactive')}</Tag>),
    },
  ];

  return (
    <Card
      title={t('venues.tabs.types')}
      extra={
        canEdit ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            {t('venues.types.create')}
          </Button>
        ) : null
      }
    >
      {!canEdit ? <Alert type="info" showIcon message={t('venues.typesReadOnly')} style={{ marginBottom: 12 }} /> : null}
      {types.error ? <ErrorAlert error={types.error} onRetry={() => void types.refetch()} /> : null}
      <Table<VenueType>
        rowKey="id"
        size="middle"
        loading={types.isLoading}
        dataSource={[...(types.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)}
        columns={columns}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('venues.types.empty') }}
      />
      <VenueTypeDrawer
        open={editing !== null}
        type={editing === 'new' ? null : editing}
        canEdit={canEdit}
        onClose={() => setEditing(null)}
      />
    </Card>
  );
}

function VenueTypeDrawer({ open, type, canEdit, onClose }: { open: boolean; type: VenueType | null; canEdit: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const [form] = Form.useForm<VenueTypeFormValues>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(venueTypeToForm(type));
  }, [open, type, form]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: venueKeys.types });
    void queryClient.invalidateQueries({ queryKey: venueKeys.all });
  };

  const submit = async () => {
    let values: VenueTypeFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const input = formToVenueTypeInput({ ...venueTypeToForm(type), ...values });
      if (type) await venueConfigApi.updateType(type.id, input);
      else await venueConfigApi.createType(input);
      refresh();
      void message.success(t('common.saved'));
      onClose();
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={680}
      destroyOnHidden
      title={type ? t('venues.types.editTitle') : t('venues.types.createTitle')}
      extra={
        <Space>
          {type && canEdit ? (
            <ConfirmAction
              title={t('venues.types.deleteConfirm')}
              danger
              okText={t('common.delete')}
              successMessage={t('venues.types.deleted')}
              onConfirm={async () => {
                await venueConfigApi.deleteType(type.id);
                refresh();
                onClose();
              }}
            >
              {t('common.delete')}
            </ConfirmAction>
          ) : null}
          <Button onClick={onClose}>{canEdit ? t('common.cancel') : t('common.close')}</Button>
          {canEdit ? (
            <Button type="primary" loading={saving} onClick={() => void submit()}>
              {t('common.save')}
            </Button>
          ) : null}
        </Space>
      }
    >
      <Form<VenueTypeFormValues> form={form} layout="vertical" requiredMark="optional" disabled={!canEdit}>
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item
              name="code"
              label={t('venues.fields.code')}
              extra={t('venues.types.codeHint')}
              rules={[{ required: true, pattern: TYPE_CODE_RE, message: t('venues.types.codeHint') }]}
            >
              <Input maxLength={32} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={6}>
            <Form.Item name="sortOrder" label={t('venues.fields.sortOrder')}>
              <InputNumber min={0} max={10000} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={6}>
            <Form.Item name="isActive" label={t('venues.fields.isActive')} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="name" label={t('venues.fields.name')} rules={[translatableRule(t('translatable.required'))]}>
          <TranslatableInput maxLength={100} />
        </Form.Item>
        <Form.Item name="description" label={t('venues.fields.description')}>
          <TranslatableInput multiline rows={2} maxLength={1000} />
        </Form.Item>
        <Typography.Title level={5}>{t('venues.fields.rules')}</Typography.Title>
        <Typography.Paragraph type="secondary">{t('venues.types.rulesHint')}</Typography.Paragraph>
        <TypeRulesFields disabled={!canEdit} />
      </Form>
    </Drawer>
  );
}
