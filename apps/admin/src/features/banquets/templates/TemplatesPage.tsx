import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Flex, Space, Table, Tag, Typography } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/shared/api/hooks';
import { formatDateTime } from '@/shared/lib/dates';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { useSectionAbilities } from '../abilities';
import { banquetRefKeys, banquetsApi } from '../api';
import type { ContractTemplate } from '../types';
import { TemplateEditorDrawer } from './TemplateEditorDrawer';

/** Шаблоны договоров (общие для сети): договор формируется по шаблону с подстановкой реквизитов. */
export function TemplatesPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const abilities = useSectionAbilities();
  const templates = useApiQuery(banquetRefKeys.templates, banquetsApi.templates);
  const [editing, setEditing] = useState<ContractTemplate | 'new' | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: banquetRefKeys.templates });

  return (
    <>
      <Flex justify="space-between" gap={12} wrap style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={0}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t('banquets.templates.title')}
          </Typography.Title>
          <Typography.Text type="secondary">{t('banquets.templates.subtitle')}</Typography.Text>
        </Space>
        {abilities.templatesEdit ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            {t('banquets.templates.create')}
          </Button>
        ) : null}
      </Flex>
      {templates.error ? <ErrorAlert error={templates.error} onRetry={() => void templates.refetch()} /> : null}
      <Table<ContractTemplate>
        rowKey="id"
        loading={templates.isLoading}
        dataSource={templates.data ?? []}
        pagination={false}
        locale={{ emptyText: t('banquets.templates.empty') }}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: t('banquets.templates.name'),
            dataIndex: 'name',
            render: (name: string, row) => (
              <Space>
                <Typography.Link onClick={() => setEditing(row)}>{name}</Typography.Link>
                {row.isDefault ? <Tag color="gold">{t('banquets.templates.defaultTag')}</Tag> : null}
              </Space>
            ),
          },
          { title: t('banquets.templates.code'), dataIndex: 'code', render: (code: string) => <Typography.Text code>{code}</Typography.Text> },
          { title: t('banquets.templates.updatedAt'), dataIndex: 'updatedAt', render: (v: string) => formatDateTime(v) },
          {
            title: t('common.actions'),
            key: 'actions',
            width: 110,
            render: (_, row) =>
              abilities.templatesEdit ? (
                <Space>
                  <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(row)} aria-label={t('common.edit')} />
                  <ConfirmAction
                    title={t('banquets.templates.deleteConfirm', { name: row.name })}
                    danger
                    successMessage={t('banquets.templates.deleted')}
                    onConfirm={async () => {
                      await banquetsApi.deleteTemplate(row.id);
                      await refresh();
                    }}
                    buttonProps={{ size: 'small', icon: <DeleteOutlined />, 'aria-label': t('common.delete') }}
                  >
                    {null}
                  </ConfirmAction>
                </Space>
              ) : (
                <Button size="small" icon={<EyeOutlined />} onClick={() => setEditing(row)} aria-label={t('banquets.common.open')} />
              ),
          },
        ]}
      />
      <TemplateEditorDrawer
        open={editing !== null}
        template={editing === 'new' ? null : editing}
        readOnly={!abilities.templatesEdit}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void message.success(t('banquets.templates.saved'));
          void refresh();
        }}
      />
    </>
  );
}
