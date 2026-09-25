import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Flex, Select, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { translate, type Banner, type BannerPlacement } from '@aula/api-client';
import { contentApi } from '@/shared/api/catalog';
import { queryKeys } from '@/shared/api/query-keys';
import { useBranch } from '@/shared/branch/BranchProvider';
import { formatDateTime } from '@/shared/lib/dates';
import { BranchSelect } from '@/shared/ui/BranchSelect';
import { CatalogThumb } from '@/shared/ui/CatalogThumb';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MissingTranslationsTag } from '@/shared/ui/MissingTranslationsTag';
import { BANNER_PLACEMENTS } from '../forms';
import { useContentAbilities } from '../useContentAbilities';
import { BannerDrawer } from './BannerDrawer';

/** Период показа «с — по» (как пришёл с сервера, в Asia/Almaty). */
export function Period({ from, to }: { from: string | null; to: string | null }) {
  const { t } = useTranslation();
  if (!from && !to) return <Typography.Text type="secondary">{t('content.always')}</Typography.Text>;
  return (
    <Typography.Text>
      {from ? formatDateTime(from) : '…'} — {to ? formatDateTime(to) : '…'}
    </Typography.Text>
  );
}

/** Баннеры витрины: фильтр по месту показа и филиалу; баннер филиала правит сотрудник с правом в филиале. */
export function BannersTab() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const abilities = useContentAbilities();
  const { branchName } = useBranch();
  const [params, setParams] = useSearchParams();
  const [placement, setPlacement] = useState<BannerPlacement | undefined>();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ open: boolean; banner: Banner | null }>({ open: false, banner: null });
  const query = useMemo(() => ({ placement, branchId: branchId ?? undefined }), [placement, branchId]);
  const banners = useQuery({ queryKey: queryKeys.bannerList(query), queryFn: () => contentApi.banners(query) });
  const canCreate = abilities.global || abilities.editableBranchIds.length > 0;

  const editId = params.get('edit');
  useEffect(() => {
    if (!editId || !banners.data) return;
    const found = banners.data.find((b) => b.id === editId);
    if (found) setDrawer({ open: true, banner: found });
  }, [editId, banners.data]);

  const close = () => {
    setDrawer({ open: false, banner: null });
    if (editId) {
      params.delete('edit');
      setParams(params, { replace: true });
    }
  };

  return (
    <>
      <Flex justify="space-between" gap={8} wrap style={{ marginBottom: 12 }}>
        <Flex gap={8} wrap>
          <Select<BannerPlacement>
            allowClear
            placeholder={t('content.banners.placement')}
            style={{ width: 220 }}
            value={placement}
            onChange={setPlacement}
            options={BANNER_PLACEMENTS.map((p) => ({ value: p, label: t(`content.banners.placements.${p}`) }))}
          />
          <BranchSelect allowClear allowAll style={{ width: 220 }} value={branchId} onChange={setBranchId} placeholder={t('content.banners.anyBranch')} />
        </Flex>
        {canCreate ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawer({ open: true, banner: null })}>
            {t('content.banners.create')}
          </Button>
        ) : null}
      </Flex>
      {banners.error ? <ErrorAlert error={banners.error} onRetry={() => void banners.refetch()} /> : null}
      <Table<Banner>
        rowKey="id"
        loading={banners.isLoading}
        dataSource={banners.data ?? []}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: t('content.fields.title'),
            key: 'title',
            render: (_, b) => (
              <Flex gap={12} align="center">
                <CatalogThumb image={b.image} size={56} />
                <div>
                  <Typography.Text strong>{translate(b.title, i18n.language)}</Typography.Text>
                  {b.linkUrl ? (
                    <>
                      <br />
                      <Typography.Text type="secondary" code>
                        {b.linkUrl}
                      </Typography.Text>
                    </>
                  ) : null}
                  <div>
                    <MissingTranslationsTag items={b.missingTranslations} />
                  </div>
                </div>
              </Flex>
            ),
          },
          { title: t('content.banners.placement'), dataIndex: 'placement', render: (p: BannerPlacement) => <Tag>{t(`content.banners.placements.${p}`)}</Tag> },
          {
            title: t('layout.branch'),
            dataIndex: 'branchId',
            render: (id: string | null) => (id ? branchName(id) : <Tag color="gold">{t('layout.allBranches')}</Tag>),
          },
          { title: t('content.period'), key: 'period', render: (_, b) => <Period from={b.activeFrom} to={b.activeTo} /> },
          { title: t('catalog.fields.sortOrder'), dataIndex: 'sortOrder', align: 'right' },
          {
            title: t('catalog.fields.status'),
            dataIndex: 'isActive',
            render: (active: boolean) => <Tag color={active ? 'success' : 'default'}>{active ? t('common.active') : t('common.inactive')}</Tag>,
          },
          {
            title: t('common.actions'),
            key: 'actions',
            render: (_, b) => {
              const canEdit = abilities.banner(b.branchId);
              return (
                <Space size={4}>
                  <Button size="small" icon={canEdit ? <EditOutlined /> : <EyeOutlined />} onClick={() => setDrawer({ open: true, banner: b })}>
                    {canEdit ? t('common.edit') : t('catalog.view')}
                  </Button>
                  {canEdit ? (
                    <ConfirmAction
                      danger
                      title={t('content.banners.deleteConfirm', { name: translate(b.title, i18n.language) })}
                      description={t('catalog.auditNote')}
                      buttonProps={{ size: 'small', icon: <DeleteOutlined /> }}
                      successMessage={t('catalog.deleted')}
                      onConfirm={async () => {
                        await contentApi.deleteBanner(b.id);
                        await queryClient.invalidateQueries({ queryKey: queryKeys.banners });
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
      <BannerDrawer
        open={drawer.open}
        banner={drawer.banner}
        onClose={close}
        onSaved={(banner) => setDrawer({ open: true, banner })}
      />
    </>
  );
}
