import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toApiError, translate, type Dish } from '@aula/api-client';
import { branchMenuApi, catalogApi } from '@/shared/api/catalog';
import { errorMessage } from '@/shared/api/errors';
import { queryKeys } from '@/shared/api/query-keys';
import { CatalogThumb } from '@/shared/ui/CatalogThumb';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { MAX_MENU_PRICE_TIYN } from './PriceCell';

interface Draft {
  price: number | null;
  sku: string;
}

/**
 * Добавление блюд в меню филиала (menu.prices): только блюда, которых ещё нет в меню
 * (GET /dishes?notInBranchId=), цена обязательна (тиыны), код POS филиала — по желанию.
 * Каждое блюдо — отдельный запрос (у API нет пакетного добавления); ошибки — по строкам.
 */
export function AddDishesModal({ branchId, branchName, open, onClose }: { branchId: string; branchName: string; open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [dishes, setDishes] = useState<Record<string, Dish>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const params = useMemo(() => ({ q: q || undefined, notInBranchId: branchId, isActive: true, page, perPage: 20 }), [q, branchId, page]);
  const list = useQuery({
    queryKey: queryKeys.dishList(params),
    queryFn: () => catalogApi.dishes(params),
    enabled: open,
    placeholderData: keepPreviousData,
  });

  const draft = (id: string): Draft => drafts[id] ?? { price: null, sku: '' };
  const setDraft = (id: string, patch: Partial<Draft>) => setDrafts((prev) => ({ ...prev, [id]: { ...draft(id), ...patch } }));
  const missingPrice = selected.filter((id) => draft(id).price === null);

  const reset = () => {
    setSelected([]);
    setDrafts({});
    setDishes({});
    setErrors({});
    setQ('');
    setPage(1);
  };

  const submit = async () => {
    if (selected.length === 0 || missingPrice.length > 0) return;
    setSaving(true);
    const failed: Record<string, string> = {};
    let added = 0;
    for (const dishId of selected) {
      const { price, sku } = draft(dishId);
      try {
        await branchMenuApi.add(branchId, { dishId, price: { amount: price ?? 0 }, sku: sku.trim() || null });
        added++;
      } catch (error) {
        failed[dishId] = errorMessage(toApiError(error), i18n.language);
      }
    }
    setSaving(false);
    await queryClient.invalidateQueries({ queryKey: queryKeys.branchMenu(branchId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dishes });
    if (added > 0) void message.success(t('catalog.branchMenu.added', { count: added }));
    if (Object.keys(failed).length === 0) {
      reset();
      onClose();
    } else {
      setErrors(failed);
      setSelected(Object.keys(failed));
    }
  };

  return (
    <Modal
      open={open}
      width={900}
      title={t('catalog.branchMenu.addTitle', { branch: branchName })}
      okText={t('catalog.branchMenu.addSubmit', { count: selected.length })}
      okButtonProps={{ disabled: selected.length === 0 || missingPrice.length > 0, loading: saving }}
      cancelText={t('common.cancel')}
      onOk={() => void submit()}
      onCancel={() => {
        reset();
        onClose();
      }}
      destroyOnHidden
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Typography.Text type="secondary">{t('catalog.branchMenu.addHint')}</Typography.Text>
        <Input.Search
          allowClear
          placeholder={t('catalog.dishes.searchPlaceholder')}
          onSearch={(value) => {
            setQ(value.trim());
            setPage(1);
          }}
        />
        {Object.keys(errors).length > 0 ? <Alert type="error" showIcon message={t('catalog.branchMenu.addFailed')} /> : null}
        {missingPrice.length > 0 ? <Alert type="warning" showIcon message={t('catalog.branchMenu.priceRequired')} /> : null}
        <Table<Dish>
          rowKey="id"
          size="small"
          loading={list.isLoading || list.isPlaceholderData}
          dataSource={list.data?.items ?? []}
          scroll={{ x: 'max-content', y: 420 }}
          pagination={{
            current: page,
            pageSize: 20,
            total: list.data?.total ?? 0,
            showSizeChanger: false,
            onChange: setPage,
          }}
          locale={{ emptyText: t('catalog.branchMenu.nothingToAdd') }}
          rowSelection={{
            selectedRowKeys: selected,
            preserveSelectedRowKeys: true,
            onChange: (keys, rows) => {
              setSelected(keys as string[]);
              setDishes((prev) => ({ ...prev, ...Object.fromEntries(rows.filter(Boolean).map((d) => [d.id, d])) }));
            },
          }}
          columns={[
            {
              title: t('catalog.fields.name'),
              key: 'name',
              render: (_, d) => (
                <Space>
                  <CatalogThumb image={d.photos[0]} size={36} />
                  <div>
                    <Typography.Text strong>{translate(d.name, i18n.language)}</Typography.Text>
                    {d.sku ? (
                      <>
                        <br />
                        <Typography.Text type="secondary" code>
                          {d.sku}
                        </Typography.Text>
                      </>
                    ) : null}
                    {errors[d.id] ? (
                      <div>
                        <Tag color="error">{errors[d.id]}</Tag>
                      </div>
                    ) : null}
                  </div>
                </Space>
              ),
            },
            {
              title: t('catalog.branchMenu.price'),
              key: 'price',
              width: 170,
              render: (_, d) => (
                <MoneyInput
                  size="small"
                  disabled={!selected.includes(d.id)}
                  status={selected.includes(d.id) && draft(d.id).price === null ? 'warning' : undefined}
                  value={draft(d.id).price}
                  max={MAX_MENU_PRICE_TIYN}
                  onChange={(price) => setDraft(d.id, { price })}
                  aria-label={t('catalog.branchMenu.price')}
                />
              ),
            },
            {
              title: t('catalog.branchMenu.branchSku'),
              key: 'sku',
              width: 160,
              render: (_, d) => (
                <Input
                  size="small"
                  maxLength={64}
                  disabled={!selected.includes(d.id)}
                  placeholder={d.sku ?? undefined}
                  value={draft(d.id).sku}
                  onChange={(e) => setDraft(d.id, { sku: e.target.value })}
                />
              ),
            },
          ]}
        />
        {selected.length > 0 ? (
          <Typography.Text type="secondary">
            {t('catalog.branchMenu.selected', { count: selected.length })}: {selected.map((id) => (dishes[id] ? translate(dishes[id]!.name, i18n.language) : id)).join(', ')}
          </Typography.Text>
        ) : null}
      </Space>
    </Modal>
  );
}
