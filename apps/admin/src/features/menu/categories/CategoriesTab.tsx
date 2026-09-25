import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Flex, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { translate, type ApiError, type Category } from '@aula/api-client';
import { catalogApi } from '@/shared/api/catalog';
import { queryKeys } from '@/shared/api/query-keys';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { CatalogThumb } from '@/shared/ui/CatalogThumb';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MissingTranslationsTag } from '@/shared/ui/MissingTranslationsTag';
import { ReorderButtons, useRowDrag } from '../ReorderButtons';
import { applyOrder, bySortOrder, moveBy, moveById, sameOrder } from '../reorder';
import { useCatalogAbilities } from '../useAbilities';
import { CategoryDrawer } from './CategoryDrawer';

/**
 * Категории меню (контент-менеджер, menu.content): порядок перетаскиванием или кнопками
 * (PUT /categories/order — полный список), создание и изменение, изображение, удаление пустой категории.
 */
export function CategoriesTab() {
  const { t, i18n } = useTranslation();
  const { editCatalog } = useCatalogAbilities();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const [params, setParams] = useSearchParams();
  const categories = useQuery({ queryKey: queryKeys.categories, queryFn: catalogApi.categories });
  const list = useMemo(() => bySortOrder(categories.data ?? []), [categories.data]);
  const [drawer, setDrawer] = useState<{ open: boolean; category: Category | null }>({ open: false, category: null });

  // Ссылка из отчёта о переводах: /menu/categories?edit=<id>.
  const editId = params.get('edit');
  useEffect(() => {
    if (!editId || !categories.data) return;
    const found = categories.data.find((c) => c.id === editId);
    if (found) setDrawer({ open: true, category: found });
  }, [editId, categories.data]);

  // Порядок меняется оптимистично: действие обратимо, при ошибке возвращаем прежний список.
  const reorder = useMutation<Category[], ApiError, string[], { previous?: Category[] }>({
    mutationFn: (ids) => catalogApi.reorderCategories(ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.categories });
      const previous = queryClient.getQueryData<Category[]>(queryKeys.categories);
      if (previous) {
        queryClient.setQueryData<Category[]>(
          queryKeys.categories,
          applyOrder(previous, ids).map((c, index) => ({ ...c, sortOrder: (index + 1) * 10 })),
        );
      }
      return { previous };
    },
    onError: (error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.categories, context.previous);
      notifyError(error);
    },
    onSuccess: (data) => queryClient.setQueryData(queryKeys.categories, data),
  });

  const submitOrder = (next: Category[]) => {
    const ids = next.map((c) => c.id);
    if (!sameOrder(ids, list.map((c) => c.id))) reorder.mutate(ids);
  };
  const dragRow = useRowDrag((dragId, overId) => submitOrder(moveById(list, dragId, overId)));
  const canReorder = editCatalog && !reorder.isPending && list.length > 1;

  const close = () => {
    setDrawer({ open: false, category: null });
    if (editId) {
      params.delete('edit');
      setParams(params, { replace: true });
    }
  };

  return (
    <>
      <Flex justify="space-between" align="center" gap={8} wrap style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">{editCatalog ? t('catalog.categories.orderHint') : t('catalog.readOnly')}</Typography.Text>
        {editCatalog ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawer({ open: true, category: null })}>
            {t('catalog.categories.create')}
          </Button>
        ) : null}
      </Flex>
      {categories.error ? <ErrorAlert error={categories.error} onRetry={() => void categories.refetch()} /> : null}
      {reorder.isPending ? <Alert type="info" showIcon message={t('catalog.categories.saving')} style={{ marginBottom: 12 }} /> : null}
      <Table<Category>
        rowKey="id"
        size="middle"
        loading={categories.isLoading}
        dataSource={list}
        pagination={false}
        scroll={{ x: 'max-content' }}
        onRow={(row) => dragRow(row.id, canReorder)}
        columns={[
          {
            title: '',
            key: 'order',
            width: 110,
            render: (_, _row, index) => (
              <ReorderButtons
                handle={canReorder}
                index={index}
                count={list.length}
                disabled={!canReorder}
                onMove={(delta) => submitOrder(moveBy(list, index, delta))}
              />
            ),
          },
          {
            title: t('catalog.fields.name'),
            key: 'name',
            render: (_, c) => (
              <Flex gap={12} align="center">
                <CatalogThumb image={c.image} size={44} />
                <div>
                  <Typography.Text strong>{translate(c.name, i18n.language)}</Typography.Text>
                  <br />
                  <Typography.Text type="secondary" code>
                    {c.slug}
                  </Typography.Text>
                  <div>
                    <MissingTranslationsTag items={c.missingTranslations} />
                  </div>
                </div>
              </Flex>
            ),
          },
          { title: t('catalog.categories.dishes'), dataIndex: 'dishCount', align: 'right' },
          {
            title: t('catalog.fields.status'),
            dataIndex: 'isActive',
            render: (active: boolean) => <Tag color={active ? 'success' : 'default'}>{active ? t('common.active') : t('common.inactive')}</Tag>,
          },
          {
            title: t('common.actions'),
            key: 'actions',
            render: (_, c) => (
              <Space size={4} wrap>
                <Button size="small" icon={<EditOutlined />} onClick={() => setDrawer({ open: true, category: c })}>
                  {editCatalog ? t('common.edit') : t('catalog.view')}
                </Button>
                {editCatalog ? (
                  c.dishCount > 0 ? (
                    <Tooltip title={t('catalog.categories.notEmpty', { count: c.dishCount })}>
                      <Button size="small" danger icon={<DeleteOutlined />} disabled>
                        {t('common.delete')}
                      </Button>
                    </Tooltip>
                  ) : (
                    <ConfirmAction
                      danger
                      title={t('catalog.categories.deleteConfirm', { name: translate(c.name, i18n.language) })}
                      description={t('catalog.auditNote')}
                      buttonProps={{ size: 'small', icon: <DeleteOutlined /> }}
                      successMessage={t('catalog.deleted')}
                      onConfirm={async () => {
                        await catalogApi.deleteCategory(c.id);
                        await queryClient.invalidateQueries({ queryKey: queryKeys.categories });
                      }}
                    >
                      {t('common.delete')}
                    </ConfirmAction>
                  )
                ) : null}
              </Space>
            ),
          },
        ]}
      />
      <CategoryDrawer
        open={drawer.open}
        category={drawer.category}
        canEdit={editCatalog}
        onClose={close}
        onSaved={(category, created) => {
          if (created) void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
          setDrawer({ open: true, category });
        }}
      />
    </>
  );
}
