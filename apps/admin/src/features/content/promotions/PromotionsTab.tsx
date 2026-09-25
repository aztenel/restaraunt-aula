import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Flex, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { translate, type Promotion } from '@aula/api-client';
import { contentApi } from '@/shared/api/catalog';
import { queryKeys } from '@/shared/api/query-keys';
import { useBranch } from '@/shared/branch/BranchProvider';
import { CatalogThumb } from '@/shared/ui/CatalogThumb';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MissingTranslationsTag } from '@/shared/ui/MissingTranslationsTag';
import { Period } from '../banners/BannersTab';
import { useContentAbilities } from '../useContentAbilities';
import { PromotionDrawer } from './PromotionDrawer';

/** Акции витрины: срок действия и филиалы; акцию сети (без филиалов) правит только глобальный контент-менеджер. */
export function PromotionsTab() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const abilities = useContentAbilities();
  const { branchName } = useBranch();
  const [params, setParams] = useSearchParams();
  const promotions = useQuery({ queryKey: queryKeys.promotions, queryFn: contentApi.promotions });
  const [drawer, setDrawer] = useState<{ open: boolean; promotion: Promotion | null }>({ open: false, promotion: null });
  const canCreate = abilities.global || abilities.editableBranchIds.length > 0;

  const editId = params.get('edit');
  useEffect(() => {
    if (!editId || !promotions.data) return;
    const found = promotions.data.find((p) => p.id === editId);
    if (found) setDrawer({ open: true, promotion: found });
  }, [editId, promotions.data]);

  const close = () => {
    setDrawer({ open: false, promotion: null });
    if (editId) {
      params.delete('edit');
      setParams(params, { replace: true });
    }
  };

  return (
    <>
      <Flex justify="flex-end" style={{ marginBottom: 12 }}>
        {canCreate ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawer({ open: true, promotion: null })}>
            {t('content.promotions.create')}
          </Button>
        ) : null}
      </Flex>
      {promotions.error ? <ErrorAlert error={promotions.error} onRetry={() => void promotions.refetch()} /> : null}
      <Table<Promotion>
        rowKey="id"
        loading={promotions.isLoading}
        dataSource={promotions.data ?? []}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: t('content.fields.title'),
            key: 'title',
            render: (_, p) => (
              <Flex gap={12} align="center">
                <CatalogThumb image={p.image} size={56} />
                <div>
                  <Typography.Text strong>{translate(p.title, i18n.language)}</Typography.Text>
                  <br />
                  <Typography.Text type="secondary" code>
                    {p.slug}
                  </Typography.Text>
                  <div>
                    <MissingTranslationsTag items={p.missingTranslations} />
                  </div>
                </div>
              </Flex>
            ),
          },
          {
            title: t('content.promotions.branches'),
            dataIndex: 'branchIds',
            render: (ids: string[]) =>
              ids.length === 0 ? (
                <Tag color="gold">{t('layout.allBranches')}</Tag>
              ) : (
                <Space size={[4, 4]} wrap>
                  {ids.map((id) => (
                    <Tag key={id}>{branchName(id)}</Tag>
                  ))}
                </Space>
              ),
          },
          { title: t('content.validity'), key: 'period', render: (_, p) => <Period from={p.validFrom} to={p.validTo} /> },
          {
            title: t('catalog.fields.status'),
            dataIndex: 'isActive',
            render: (active: boolean) => <Tag color={active ? 'success' : 'default'}>{active ? t('common.active') : t('common.inactive')}</Tag>,
          },
          {
            title: t('common.actions'),
            key: 'actions',
            render: (_, p) => {
              const canEdit = abilities.promotion(p.branchIds);
              return (
                <Space size={4}>
                  <Button size="small" icon={canEdit ? <EditOutlined /> : <EyeOutlined />} onClick={() => setDrawer({ open: true, promotion: p })}>
                    {canEdit ? t('common.edit') : t('catalog.view')}
                  </Button>
                  {canEdit ? (
                    <ConfirmAction
                      danger
                      title={t('content.promotions.deleteConfirm', { name: translate(p.title, i18n.language) })}
                      description={t('catalog.auditNote')}
                      buttonProps={{ size: 'small', icon: <DeleteOutlined /> }}
                      successMessage={t('catalog.deleted')}
                      onConfirm={async () => {
                        await contentApi.deletePromotion(p.id);
                        await queryClient.invalidateQueries({ queryKey: queryKeys.promotions });
                      }}
                    >
                      {t('common.delete')}
                    </ConfirmAction>
                  ) : null}
                </Space>
              );
            },
          },
        ]}
      />
      <PromotionDrawer open={drawer.open} promotion={drawer.promotion} onClose={close} onSaved={(promotion) => setDrawer({ open: true, promotion })} />
    </>
  );
}
