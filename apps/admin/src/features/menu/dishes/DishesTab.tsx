import { DeleteOutlined, EditOutlined, EyeOutlined, FireFilled, PlusOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Flex, Input, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { translate, type Dish } from '@aula/api-client';
import { catalogApi, type DishListQuery } from '@/shared/api/catalog';
import { queryKeys } from '@/shared/api/query-keys';
import { CatalogThumb } from '@/shared/ui/CatalogThumb';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MissingTranslationsTag } from '@/shared/ui/MissingTranslationsTag';
import { PaginatedTable } from '@/shared/ui/PaginatedTable';
import { bySortOrder } from '../reorder';
import { useCatalogAbilities } from '../useAbilities';

type ActiveFilter = 'all' | 'active' | 'inactive';

/** Подписи остроты 0..3. */
export const SPICY_KEYS = ['none', 'mild', 'medium', 'hot'] as const;

/** Острота 0..3 — значками. */
export function SpicyLevel({ level }: { level: number }) {
  const { t } = useTranslation();
  if (level <= 0) return null;
  const count = Math.min(level, 3);
  const label = t(`catalog.dishes.spicy.${SPICY_KEYS[count] ?? 'hot'}`);
  return (
    <Tooltip title={label}>
      <span aria-label={label} style={{ color: '#cf1322', whiteSpace: 'nowrap' }}>
        {Array.from({ length: count }, (_, i) => (
          <FireFilled key={i} />
        ))}
      </span>
    </Tooltip>
  );
}

/**
 * Блюда сети (карточка без цены — цена в меню филиала): поиск по названию, slug и коду POS,
 * фильтры по категории и активности; фильтры и страница — в адресе (возврат из карточки).
 */
export function DishesTab() {
  const { t, i18n } = useTranslation();
  const { editCatalog } = useCatalogAbilities();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const categoryId = params.get('categoryId') ?? undefined;
  const active = (params.get('active') as ActiveFilter | null) ?? 'all';
  const page = Number(params.get('page') ?? 1) || 1;
  const perPage = Number(params.get('perPage') ?? 50) || 50;

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '' || value === 'all') next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const query: DishListQuery = useMemo(
    () => ({ q: q || undefined, categoryId, isActive: active === 'all' ? undefined : active === 'active', page, perPage }),
    [q, categoryId, active, page, perPage],
  );
  const dishes = useQuery({ queryKey: queryKeys.dishList(query), queryFn: () => catalogApi.dishes(query), placeholderData: keepPreviousData });
  const categories = useQuery({ queryKey: queryKeys.categories, queryFn: catalogApi.categories, staleTime: 60_000 });
  const categoryName = (id: string) => {
    const category = categories.data?.find((c) => c.id === id);
    return category ? translate(category.name, i18n.language) : '—';
  };

  return (
    <>
      <Flex gap={8} wrap justify="space-between" style={{ marginBottom: 12 }}>
        <Flex gap={8} wrap>
          <Input.Search
            allowClear
            defaultValue={q}
            placeholder={t('catalog.dishes.searchPlaceholder')}
            style={{ width: 280 }}
            onSearch={(value) => update({ q: value.trim() })}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={t('catalog.fields.category')}
            style={{ width: 220 }}
            value={categoryId}
            loading={categories.isLoading}
            onChange={(value?: string) => update({ categoryId: value })}
            options={bySortOrder(categories.data ?? []).map((c) => ({ value: c.id, label: translate(c.name, i18n.language) }))}
          />
          <Select<ActiveFilter>
            style={{ width: 170 }}
            value={active}
            onChange={(value) => update({ active: value })}
            options={[
              { value: 'all', label: t('catalog.dishes.filterAll') },
              { value: 'active', label: t('catalog.dishes.filterActive') },
              { value: 'inactive', label: t('catalog.dishes.filterInactive') },
            ]}
          />
        </Flex>
        {editCatalog ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate(`/menu/dishes/new${categoryId ? `?categoryId=${categoryId}` : ''}`)}>
            {t('catalog.dishes.create')}
          </Button>
        ) : null}
      </Flex>
      {dishes.error ? <ErrorAlert error={dishes.error} onRetry={() => void dishes.refetch()} /> : null}
      <PaginatedTable<Dish>
        rowKey="id"
        data={dishes.data}
        loading={dishes.isLoading || dishes.isPlaceholderData}
        page={page}
        perPage={perPage}
        onPageChange={(p, pp) => update({ page: String(p), perPage: String(pp) })}
        columns={[
          {
            title: t('catalog.fields.name'),
            key: 'name',
            render: (_, d) => (
              <Flex gap={12} align="center">
                <CatalogThumb image={d.photos[0]} size={44} />
                <div>
                  <Link to={`/menu/dishes/${d.id}`}>
                    <Typography.Text strong>{translate(d.name, i18n.language)}</Typography.Text>
                  </Link>{' '}
                  {!d.isActive ? <Tag>{t('common.inactive')}</Tag> : null}
                  <br />
                  <Typography.Text type="secondary" code>
                    {d.slug}
                  </Typography.Text>
                  <div>
                    <MissingTranslationsTag items={d.missingTranslations} />
                  </div>
                </div>
              </Flex>
            ),
          },
          { title: t('catalog.fields.category'), dataIndex: 'categoryId', render: (id: string) => categoryName(id) },
          {
            title: t('catalog.dishes.attributes'),
            key: 'attributes',
            render: (_, d) => (
              <Space size={4} wrap>
                {d.weightGrams ? <Typography.Text type="secondary">{t('catalog.dishes.grams', { value: d.weightGrams })}</Typography.Text> : null}
                <SpicyLevel level={d.spicyLevel} />
                {d.isVegetarian ? <Tag color="green">{t('catalog.fields.isVegetarian')}</Tag> : null}
                {d.isHalal ? <Tag color="gold">{t('catalog.fields.isHalal')}</Tag> : null}
                {d.photos.length === 0 ? <Tag color="warning">{t('catalog.dishes.noPhoto')}</Tag> : null}
              </Space>
            ),
          },
          {
            title: t('catalog.fields.sku'),
            dataIndex: 'sku',
            render: (sku: string | null) => (sku ? <Typography.Text code>{sku}</Typography.Text> : <Typography.Text type="secondary">—</Typography.Text>),
          },
          {
            title: t('common.actions'),
            key: 'actions',
            render: (_, d) => (
              <Space size={4}>
                <Button size="small" icon={editCatalog ? <EditOutlined /> : <EyeOutlined />} onClick={() => navigate(`/menu/dishes/${d.id}`)}>
                  {editCatalog ? t('common.edit') : t('catalog.view')}
                </Button>
                {editCatalog ? (
                  <ConfirmAction
                    danger
                    title={t('catalog.dishes.deleteConfirm', { name: translate(d.name, i18n.language) })}
                    description={t('catalog.dishes.deleteDescription')}
                    buttonProps={{ size: 'small', icon: <DeleteOutlined /> }}
                    successMessage={t('catalog.deleted')}
                    onConfirm={async () => {
                      await catalogApi.deleteDish(d.id);
                      await queryClient.invalidateQueries({ queryKey: queryKeys.catalog });
                    }}
                  >
                    {t('common.delete')}
                  </ConfirmAction>
                ) : null}
              </Space>
            ),
          },
        ]}
      />
    </>
  );
}
