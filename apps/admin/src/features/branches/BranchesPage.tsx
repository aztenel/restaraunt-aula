import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { missingLocales, translate, type Branch } from '@aula/api-client';
import { branchesApi, legalEntitiesApi } from '@/shared/api/endpoints';
import { queryKeys } from '@/shared/api/query-keys';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageHeader } from '@/shared/ui/PageHeader';
import { BranchFormDrawer } from './BranchFormDrawer';

/** Филиалы (право branches.manage): адреса kk/ru/en, координаты, часы работы, настройки, юрлицо. */
export function BranchesPage() {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const branches = useQuery({ queryKey: queryKeys.branches, queryFn: branchesApi.list });
  const legalEntities = useQuery({ queryKey: queryKeys.legalEntities, queryFn: legalEntitiesApi.list });
  const [editing, setEditing] = useState<Branch | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title={t('nav.branches')}
        subtitle={t('sections.branches')}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            {t('branches.create')}
          </Button>
        }
      />
      {branches.error ? <ErrorAlert error={branches.error} onRetry={() => void branches.refetch()} /> : null}
      <Table<Branch>
        rowKey="id"
        loading={branches.isLoading}
        dataSource={[...(branches.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: t('branches.name'),
            key: 'name',
            render: (_, b) => {
              const missing = [...new Set([...missingLocales(b.name), ...missingLocales(b.address)])];
              return (
                <div>
                  <Typography.Text strong>{translate(b.name, i18n.language)}</Typography.Text>
                  <br />
                  <Typography.Text type="secondary">{translate(b.address, i18n.language)}</Typography.Text>
                  {missing.length > 0 ? (
                    <div>
                      <Tag color="warning" style={{ marginTop: 4 }}>
                        {t('translatable.missing', { locales: missing.map((l) => t(`translatable.${l}`)).join(', ') })}
                      </Tag>
                    </div>
                  ) : null}
                </div>
              );
            },
          },
          { title: t('branches.code'), dataIndex: 'code', render: (code: string) => <Tag>{code}</Tag> },
          { title: t('branches.slug'), dataIndex: 'slug', render: (slug: string) => <Typography.Text code>{slug}</Typography.Text> },
          {
            // ID нужен при настройке интеграций по филиалам (маршрутизация платежей, POS, курьеров).
            title: t('branches.id'),
            dataIndex: 'id',
            render: (id: string) => (
              <Typography.Text code copyable={{ text: id }} style={{ fontSize: 12 }}>
                {id.slice(0, 8)}…
              </Typography.Text>
            ),
          },
          {
            title: t('branches.contacts'),
            key: 'contacts',
            render: (_, b) => (
              <div>
                {b.phone}
                {b.whatsapp ? (
                  <>
                    <br />
                    <Typography.Text type="secondary">WhatsApp: {b.whatsapp}</Typography.Text>
                  </>
                ) : null}
              </div>
            ),
          },
          {
            title: t('branches.legalEntity'),
            dataIndex: 'legalEntityId',
            render: (id: string | null) => legalEntities.data?.find((e) => e.id === id)?.shortName ?? <Typography.Text type="secondary">—</Typography.Text>,
          },
          {
            title: t('branches.services'),
            key: 'services',
            render: (_, b) => (
              <Space size={4} wrap>
                {b.settings.acceptsDelivery ? <Tag>{t('branches.settings.acceptsDelivery')}</Tag> : null}
                {b.settings.acceptsPickup ? <Tag>{t('branches.settings.acceptsPickup')}</Tag> : null}
                {b.settings.acceptsReservations ? <Tag>{t('branches.settings.acceptsReservations')}</Tag> : null}
              </Space>
            ),
          },
          {
            title: t('users.status'),
            dataIndex: 'isActive',
            render: (active: boolean) => <Tag color={active ? 'success' : 'default'}>{active ? t('common.active') : t('common.inactive')}</Tag>,
          },
          {
            title: t('common.actions'),
            key: 'actions',
            render: (_, b) => (
              <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(b)}>
                {t('common.edit')}
              </Button>
            ),
          },
        ]}
      />
      <BranchFormDrawer
        open={creating || editing !== null}
        branch={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: queryKeys.branches });
          void message.success(t('common.saved'));
        }}
      />
    </>
  );
}
