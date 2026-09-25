import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Input, Modal, Space, Table, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toApiError, translate, type ApiError, type BranchMenuItem } from '@aula/api-client';
import { branchMenuApi } from '@/shared/api/catalog';
import { errorMessage } from '@/shared/api/errors';
import { queryKeys } from '@/shared/api/query-keys';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { MoneyText } from '@/shared/ui/MoneyText';
import { changedPrices, MAX_BULK_PRICES } from './bulk-prices';
import { MAX_MENU_PRICE_TIYN } from './PriceCell';

/** Всё меню филиала (страницами по 200 — максимум API). */
export async function fetchWholeBranchMenu(branchId: string): Promise<BranchMenuItem[]> {
  const items: BranchMenuItem[] = [];
  for (let page = 1; page < 100; page++) {
    const result = await branchMenuApi.list(branchId, { page, perPage: 200 });
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) break;
  }
  return items;
}

/**
 * Массовое изменение цен меню филиала: новая цена вводится по каждому блюду (фронт цены не считает),
 * отправляются только изменённые. Сервер применяет всё или ничего; ошибка — ни одна цена не меняется.
 */
export function BulkPricesModal({ branchId, branchName, open, onClose }: { branchId: string; branchName: string; open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const menu = useQuery({
    queryKey: [...queryKeys.branchMenu(branchId), 'all'],
    queryFn: () => fetchWholeBranchMenu(branchId),
    enabled: open,
    staleTime: 0,
  });
  const items = useMemo(() => menu.data ?? [], [menu.data]);
  const changes = useMemo(() => changedPrices(items, prices), [items, prices]);
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => Object.values(i.dishName).some((name) => name?.toLowerCase().includes(needle)) || i.dishSlug.includes(needle));
  }, [items, q]);
  const failedIds = new Set(Array.isArray(error?.details.dishIds) ? (error?.details.dishIds as string[]) : []);

  const close = () => {
    setPrices({});
    setError(null);
    setQ('');
    onClose();
  };

  const submit = async () => {
    if (changes.length === 0 || changes.length > MAX_BULK_PRICES) return;
    setSaving(true);
    setError(null);
    try {
      const result = await branchMenuApi.bulkPrices(branchId, changes);
      await queryClient.invalidateQueries({ queryKey: queryKeys.branchMenu(branchId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dishes });
      void message.success(t('catalog.branchMenu.bulkDone', { updated: result.updated, unchanged: result.unchanged }));
      close();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      width={860}
      title={t('catalog.branchMenu.bulkTitle', { branch: branchName })}
      okText={t('catalog.branchMenu.bulkSubmit', { count: changes.length })}
      okButtonProps={{ disabled: changes.length === 0 || changes.length > MAX_BULK_PRICES, loading: saving }}
      cancelText={t('common.cancel')}
      onOk={() => void submit()}
      onCancel={close}
      destroyOnHidden
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Alert type="info" showIcon message={t('catalog.branchMenu.bulkHint')} />
        {error ? (
          <Alert
            type="error"
            showIcon
            message={errorMessage(error, i18n.language)}
            description={
              error.fieldMessages.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {error.fieldMessages.slice(0, 8).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              ) : (
                t('catalog.branchMenu.bulkNothingChanged')
              )
            }
          />
        ) : null}
        {changes.length > MAX_BULK_PRICES ? <Alert type="warning" showIcon message={t('catalog.branchMenu.bulkTooMany', { max: MAX_BULK_PRICES })} /> : null}
        <Input.Search allowClear placeholder={t('catalog.dishes.searchPlaceholder')} onChange={(e) => setQ(e.target.value)} />
        <Table<BranchMenuItem>
          rowKey="dishId"
          size="small"
          loading={menu.isLoading}
          dataSource={visible}
          pagination={false}
          scroll={{ y: 440, x: 'max-content' }}
          rowClassName={(row) => (failedIds.has(row.dishId) ? 'aula-row-error' : '')}
          columns={[
            {
              title: t('catalog.fields.name'),
              key: 'name',
              render: (_, row) => (
                <div>
                  <Typography.Text strong>{translate(row.dishName, i18n.language)}</Typography.Text>
                  {failedIds.has(row.dishId) ? (
                    <>
                      {' '}
                      <Tag color="error">{t('catalog.branchMenu.notInMenu')}</Tag>
                    </>
                  ) : null}
                </div>
              ),
            },
            { title: t('catalog.branchMenu.currentPrice'), key: 'current', render: (_, row) => <MoneyText value={row.price} /> },
            {
              title: t('catalog.branchMenu.newPrice'),
              key: 'next',
              width: 180,
              render: (_, row) => (
                <MoneyInput
                  size="small"
                  max={MAX_MENU_PRICE_TIYN}
                  placeholder={t('catalog.branchMenu.keepPrice')}
                  value={prices[row.dishId] ?? null}
                  onChange={(value) => setPrices((prev) => ({ ...prev, [row.dishId]: value }))}
                  aria-label={t('catalog.branchMenu.newPrice')}
                />
              ),
            },
          ]}
        />
        <Typography.Text type="secondary">{t('catalog.branchMenu.bulkChanged', { count: changes.length })}</Typography.Text>
      </Space>
    </Modal>
  );
}
