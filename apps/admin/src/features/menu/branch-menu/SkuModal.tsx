import { useQueryClient } from '@tanstack/react-query';
import { App, Form, Input, Modal, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { translate, type BranchMenuItem } from '@aula/api-client';
import { branchMenuApi } from '@/shared/api/catalog';
import { queryKeys } from '@/shared/api/query-keys';
import { useNotifyError } from '@/shared/api/useNotifyError';

/**
 * Код POS филиала — переопределение общего кода блюда (у точки своя номенклатура POS).
 * Пусто — сбросить (в POS уйдёт общий код блюда). Цена передаётся текущая (перечитывается) — не меняется.
 */
export function SkuModal({ item, onClose }: { item: BranchMenuItem | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const notifyError = useNotifyError();
  const queryClient = useQueryClient();
  const [sku, setSku] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSku(item?.sku ?? '');
  }, [item]);

  const save = async () => {
    if (!item) return;
    setSaving(true);
    try {
      // API меняет код POS только вместе с ценой: берём актуальную цену прямо перед сохранением,
      // чтобы не вернуть старую, если её только что изменили в другом окне.
      const fresh = await branchMenuApi.item(item.branchId, item.dishId);
      await branchMenuApi.setPrice(item.branchId, item.dishId, { price: { amount: fresh.price.amount }, sku: sku.trim() || null });
      await queryClient.invalidateQueries({ queryKey: queryKeys.branchMenu(item.branchId) });
      void message.success(t('common.saved'));
      onClose();
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  const globalSku = item && item.sku ? null : item?.effectiveSku;
  return (
    <Modal
      open={item !== null}
      title={item ? t('catalog.branchMenu.skuTitle', { name: translate(item.dishName, i18n.language) }) : undefined}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      okButtonProps={{ loading: saving }}
      onOk={() => void save()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form layout="vertical">
        <Form.Item label={t('catalog.branchMenu.branchSku')} extra={t('catalog.branchMenu.skuHint')}>
          <Input autoFocus maxLength={64} value={sku} placeholder={globalSku ?? undefined} onChange={(e) => setSku(e.target.value)} onPressEnter={() => void save()} />
        </Form.Item>
      </Form>
      {item ? (
        <Typography.Text type="secondary">
          {t('catalog.branchMenu.effectiveSku')}: <Typography.Text code>{item.effectiveSku ?? '—'}</Typography.Text>
        </Typography.Text>
      ) : null}
    </Modal>
  );
}
