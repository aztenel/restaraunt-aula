import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatFixed2ForInput, Permission, type LegalEntity } from '@aula/api-client';
import { legalEntitiesApi } from '@/shared/api/endpoints';
import { queryKeys } from '@/shared/api/query-keys';
import { useCan } from '@/shared/auth/useCan';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageHeader } from '@/shared/ui/PageHeader';
import { LegalEntityFormModal } from './LegalEntityFormModal';

/** Юрлица (продавцы): реквизиты для счетов, актов, договоров и ЭСФ; у филиала — своё юрлицо (франшиза). */
export function LegalEntitiesPage() {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { canSomewhere } = useCan();
  const canEdit = canSomewhere(Permission.BranchesManage);
  const entities = useQuery({ queryKey: queryKeys.legalEntities, queryFn: legalEntitiesApi.list });
  const [editing, setEditing] = useState<LegalEntity | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title={t('nav.legalEntities')}
        subtitle={t('sections.legalEntities')}
        extra={
          canEdit ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              {t('legalEntities.create')}
            </Button>
          ) : null
        }
      />
      {entities.error ? <ErrorAlert error={entities.error} onRetry={() => void entities.refetch()} /> : null}
      <Table<LegalEntity>
        rowKey="id"
        loading={entities.isLoading}
        dataSource={entities.data ?? []}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: t('legalEntities.name'),
            key: 'name',
            render: (_, e) => (
              <div>
                <Typography.Text strong>{e.name}</Typography.Text> {e.isDefault ? <Tag color="gold">{t('legalEntities.default')}</Tag> : null}
                <br />
                <Typography.Text type="secondary">{e.legalAddress}</Typography.Text>
              </div>
            ),
          },
          { title: t('legalEntities.bin'), dataIndex: 'bin', render: (bin: string) => <Typography.Text code>{bin}</Typography.Text> },
          {
            title: t('legalEntities.bank'),
            key: 'bank',
            render: (_, e) =>
              e.iban ? (
                <div>
                  {e.bankName}
                  <br />
                  <Typography.Text type="secondary">
                    {e.iban} · {e.bik}
                  </Typography.Text>
                </div>
              ) : (
                <Tag color="warning">{t('legalEntities.noBankDetails')}</Tag>
              ),
          },
          {
            title: t('legalEntities.vat'),
            key: 'vat',
            render: (_, e) => (e.vatPayer ? `${formatFixed2ForInput(e.vatRateBp, i18n.language)}%` : <Typography.Text type="secondary">{t('legalEntities.noVat')}</Typography.Text>),
          },
          { title: t('legalEntities.directorName'), dataIndex: 'directorName' },
          ...(canEdit
            ? [
                {
                  title: t('common.actions'),
                  key: 'actions',
                  render: (_: unknown, e: LegalEntity) => (
                    <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(e)}>
                      {t('common.edit')}
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />
      <LegalEntityFormModal
        open={creating || editing !== null}
        entity={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          void queryClient.invalidateQueries({ queryKey: queryKeys.legalEntities });
          void message.success(t('common.saved'));
        }}
      />
    </>
  );
}
