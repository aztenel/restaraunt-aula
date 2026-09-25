import { BarcodeOutlined, CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Flex, Input, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { translate, type BranchMenuItem, type MenuItemAvailability } from '@aula/api-client';
import { branchMenuApi, catalogApi, type BranchMenuQuery, type BranchMenuRow } from '@/shared/api/catalog';
import { queryKeys } from '@/shared/api/query-keys';
import { useBranch } from '@/shared/branch/BranchProvider';
import { formatDateTime } from '@/shared/lib/dates';
import { CatalogThumb } from '@/shared/ui/CatalogThumb';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PaginatedTable } from '@/shared/ui/PaginatedTable';
import { AvailabilityTag } from '../../stop-list/AvailabilityTag';
import { BranchRequired } from '../BranchRequired';
import { bySortOrder } from '../reorder';
import { useBranchMenuAbilities } from '../useAbilities';
import { AddDishesModal } from './AddDishesModal';
import { BulkPricesModal } from './BulkPricesModal';
import { CopyMenuModal } from './CopyMenuModal';
import { PriceCell } from './PriceCell';
import { SkuModal } from './SkuModal';

/** Меню филиала: выбранный в шапке филиал (цены и стоп-лист — всегда в разрезе филиала). */
export function BranchMenuTab() {
  return <BranchRequired>{(branchId) => <BranchMenuView key={branchId} branchId={branchId} />}</BranchRequired>;
}

type AvailabilityFilter = 'all' | MenuItemAvailability;

function BranchMenuView({ branchId }: { branchId: string }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { branchName, getBranch } = useBranch();
  const { editPrices, editStopList } = useBranchMenuAbilities(branchId);
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [availability, setAvailability] = useState<AvailabilityFilter>('all');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(100);
  const [modal, setModal] = useState<'add' | 'bulk' | 'copy' | null>(null);
  const [skuItem, setSkuItem] = useState<BranchMenuItem | null>(null);
  const name = branchName(branchId);
  const timeZone = getBranch(branchId)?.timezone;

  const params: BranchMenuQuery = useMemo(
    () => ({ q: q || undefined, categoryId, availability: availability === 'all' ? undefined : availability, page, perPage }),
    [q, categoryId, availability, page, perPage],
  );
  const menu = useQuery({
    queryKey: queryKeys.branchMenuList(branchId, params),
    queryFn: () => branchMenuApi.list(branchId, params),
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({ queryKey: queryKeys.categories, queryFn: catalogApi.categories, staleTime: 60_000 });
  const categoryName = (id: string) => {
    const category = categories.data?.find((c) => c.id === id);
    return category ? translate(category.name, i18n.language) : '—';
  };

  return (
    <>
      <Flex justify="space-between" gap={8} wrap style={{ marginBottom: 12 }}>
        <Flex gap={8} wrap>
          <Input.Search
            allowClear
            placeholder={t('catalog.branchMenu.searchPlaceholder')}
            style={{ width: 260 }}
            onSearch={(value) => {
              setQ(value.trim());
              setPage(1);
            }}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={t('catalog.fields.category')}
            style={{ width: 200 }}
            value={categoryId}
            onChange={(value?: string) => {
              setCategoryId(value);
              setPage(1);
            }}
            options={bySortOrder(categories.data ?? []).map((c) => ({ value: c.id, label: translate(c.name, i18n.language) }))}
          />
          <Select<AvailabilityFilter>
            style={{ width: 170 }}
            value={availability}
            onChange={(value) => {
              setAvailability(value);
              setPage(1);
            }}
            options={[
              { value: 'all', label: t('catalog.branchMenu.filterAll') },
              { value: 'available', label: t('stopList.available') },
              { value: 'stopped', label: t('stopList.stopped') },
            ]}
          />
        </Flex>
        {editPrices ? (
          <Space wrap>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModal('add')}>
              {t('catalog.branchMenu.add')}
            </Button>
            <Button icon={<EditOutlined />} onClick={() => setModal('bulk')}>
              {t('catalog.branchMenu.bulk')}
            </Button>
            <Button icon={<CopyOutlined />} onClick={() => setModal('copy')}>
              {t('catalog.branchMenu.copy')}
            </Button>
          </Space>
        ) : null}
      </Flex>
      <Typography.Paragraph type="secondary" style={{ marginTop: -4 }}>
        {t('catalog.branchMenu.hint', { branch: name })}
        {editStopList ? (
          <>
            {' '}
            <Link to="/stop-list">{t('catalog.branchMenu.toStopList')}</Link>
          </>
        ) : null}
        {!editPrices ? ` ${t('catalog.branchMenu.readOnlyPrices')}` : ''}
      </Typography.Paragraph>
      {menu.error ? <ErrorAlert error={menu.error} onRetry={() => void menu.refetch()} /> : null}
      <PaginatedTable<BranchMenuRow>
        rowKey="dishId"
        data={menu.data}
        loading={menu.isLoading || menu.isPlaceholderData}
        page={page}
        perPage={perPage}
        pageSizeOptions={[50, 100, 200]}
        onPageChange={(p, pp) => {
          setPage(p);
          setPerPage(pp);
        }}
        columns={[
          {
            title: t('catalog.fields.name'),
            key: 'name',
            render: (_, item) => (
              <Flex gap={10} align="center">
                <CatalogThumb image={item.photo} size={40} />
                <div>
                  <Link to={`/menu/dishes/${item.dishId}`}>
                    <Typography.Text strong>{translate(item.dishName, i18n.language)}</Typography.Text>
                  </Link>
                  {!item.dishIsActive ? (
                    <>
                      {' '}
                      <Tooltip title={t('catalog.branchMenu.dishInactiveHint')}>
                        <Tag>{t('catalog.branchMenu.dishInactive')}</Tag>
                      </Tooltip>
                    </>
                  ) : null}
                  <br />
                  <Typography.Text type="secondary">{categoryName(item.categoryId)}</Typography.Text>
                </div>
              </Flex>
            ),
          },
          { title: t('catalog.branchMenu.price'), key: 'price', render: (_, item) => <PriceCell item={item} canEdit={editPrices} /> },
          {
            title: t('catalog.branchMenu.availability'),
            key: 'availability',
            render: (_, item) => <AvailabilityTag item={item} timeZone={timeZone} />,
          },
          {
            title: t('catalog.branchMenu.posCode'),
            key: 'sku',
            render: (_, item) => (
              <Space size={4}>
                {item.effectiveSku ? <Typography.Text code>{item.effectiveSku}</Typography.Text> : <Typography.Text type="secondary">—</Typography.Text>}
                {item.sku ? <Tag color="blue">{t('catalog.branchMenu.branchOverride')}</Tag> : null}
                {editPrices ? (
                  <Tooltip title={t('catalog.branchMenu.editSku')}>
                    <Button size="small" type="text" icon={<BarcodeOutlined />} aria-label={t('catalog.branchMenu.editSku')} onClick={() => setSkuItem(item)} />
                  </Tooltip>
                ) : null}
              </Space>
            ),
          },
          {
            title: t('catalog.branchMenu.updatedAt'),
            key: 'updatedAt',
            render: (_: unknown, item: BranchMenuRow) => (
              <div>
                <Typography.Text type="secondary">{formatDateTime(item.updatedAt)}</Typography.Text>
                {item.updatedByName ? (
                  <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                    {item.updatedByName}
                  </Typography.Text>
                ) : null}
              </div>
            ),
          },
          ...(editPrices
            ? [
                {
                  title: t('common.actions'),
                  key: 'actions',
                  render: (_: unknown, item: BranchMenuItem) => (
                    <ConfirmAction
                      danger
                      title={t('catalog.branchMenu.removeConfirm', { name: translate(item.dishName, i18n.language), branch: name })}
                      description={t('catalog.branchMenu.removeDescription')}
                      buttonProps={{ size: 'small', icon: <DeleteOutlined /> }}
                      successMessage={t('catalog.branchMenu.removed')}
                      onConfirm={async () => {
                        await branchMenuApi.remove(branchId, item.dishId);
                        await queryClient.invalidateQueries({ queryKey: queryKeys.branchMenu(branchId) });
                        void queryClient.invalidateQueries({ queryKey: queryKeys.dishes });
                      }}
                    >
                      {t('catalog.branchMenu.remove')}
                    </ConfirmAction>
                  ),
                },
              ]
            : []),
        ]}
      />
      <AddDishesModal branchId={branchId} branchName={name} open={modal === 'add'} onClose={() => setModal(null)} />
      <BulkPricesModal branchId={branchId} branchName={name} open={modal === 'bulk'} onClose={() => setModal(null)} />
      <CopyMenuModal branchId={branchId} open={modal === 'copy'} onClose={() => setModal(null)} />
      <SkuModal item={skuItem} onClose={() => setSkuItem(null)} />
    </>
  );
}
