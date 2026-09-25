import { CheckOutlined, CloseOutlined, EditOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Space, Tooltip } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BranchMenuItem } from '@aula/api-client';
import { branchMenuApi } from '@/shared/api/catalog';
import { queryKeys } from '@/shared/api/query-keys';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { MoneyText } from '@/shared/ui/MoneyText';
import { parseMoneyInput } from '@/shared/ui/money-input';

/** Верхняя граница цены позиции меню: 10 млн ₸ (как MAX_MENU_PRICE_TIYN на сервере). */
export const MAX_MENU_PRICE_TIYN = 1_000_000_000;

/**
 * Цена в меню филиала с правкой на месте (menu.prices в филиале). Не оптимистично: деньги —
 * показываем цену только из ответа сервера (изменение пишется в журнал «было/стало»).
 */
export function PriceCell({ item, canEdit }: { item: BranchMenuItem; canEdit: boolean }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const notifyError = useNotifyError();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<number | null>(item.price.amount);
  const [saving, setSaving] = useState(false);
  // Текст с ошибкой формата не сохраняется (MoneyInput не меняет значение при ошибке).
  const [invalid, setInvalid] = useState(false);

  const start = () => {
    setValue(item.price.amount);
    setInvalid(false);
    setEditing(true);
  };

  const save = async () => {
    if (value === null || invalid) return;
    if (value === item.price.amount) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await branchMenuApi.setPrice(item.branchId, item.dishId, { price: { amount: value } });
      await queryClient.invalidateQueries({ queryKey: queryKeys.branchMenu(item.branchId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dish(item.dishId) });
      void message.success(t('catalog.branchMenu.priceSaved'));
      setEditing(false);
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <Space size={4}>
        <MoneyText value={item.price} strong />
        {canEdit ? (
          <Tooltip title={t('catalog.branchMenu.editPrice')}>
            <Button size="small" type="text" icon={<EditOutlined />} aria-label={t('catalog.branchMenu.editPrice')} onClick={start} />
          </Tooltip>
        ) : null}
      </Space>
    );
  }
  return (
    <Space size={4}>
      <MoneyInput
        autoFocus
        size="small"
        style={{ width: 140 }}
        value={value}
        max={MAX_MENU_PRICE_TIYN}
        onChange={setValue}
        onInput={(e) => {
          const parsed = parseMoneyInput(e.currentTarget.value, { max: MAX_MENU_PRICE_TIYN });
          setInvalid(Boolean(parsed.error) || parsed.value === null);
        }}
        onPressEnter={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false);
        }}
        aria-label={t('catalog.branchMenu.price')}
      />
      <Button size="small" type="primary" icon={<CheckOutlined />} loading={saving} disabled={value === null || invalid} aria-label={t('common.save')} onClick={() => void save()} />
      <Button size="small" icon={<CloseOutlined />} aria-label={t('common.cancel')} disabled={saving} onClick={() => setEditing(false)} />
    </Space>
  );
}
