import { Checkbox, Flex, InputNumber, Modal, Radio, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { translate } from '@aula/api-client';
import { MoneyText } from '@/shared/ui/MoneyText';
import type { OrderMenuDish, OrderMenuModifierGroup } from '../types';
import { defaultModifierSelection, MAX_LINE_QUANTITY, minSelectOf, modifierIssues, selectedOptions, type ModifierSelection } from './phone-order';

function GroupHint({ group }: { group: OrderMenuModifierGroup }) {
  const { t } = useTranslation();
  const min = minSelectOf(group);
  if (min > 0 && min === group.maxSelect) return <>{t('orders.phone.modifiers.exactly', { count: min })}</>;
  if (min > 0) return <>{t('orders.phone.modifiers.range', { min, max: group.maxSelect })}</>;
  return <>{t('orders.phone.modifiers.upTo', { max: group.maxSelect })}</>;
}

/** Выбор опций (форма живёт, пока открыт диалог конкретного блюда — ключ снаружи). */
function ModifiersForm({
  dish,
  touched,
  selection,
  quantity,
  onSelection,
  onQuantity,
}: {
  dish: OrderMenuDish;
  touched: boolean;
  selection: ModifierSelection;
  quantity: number;
  onSelection: (next: ModifierSelection) => void;
  onQuantity: (quantity: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const issues = modifierIssues(dish.modifierGroups, selection);

  const toggle = (group: OrderMenuModifierGroup, optionId: string, checked: boolean) => {
    const selected = selection[group.id] ?? [];
    const next =
      group.maxSelect === 1 ? (checked ? [optionId] : []) : checked ? [...selected.filter((id) => id !== optionId), optionId] : selected.filter((id) => id !== optionId);
    onSelection({ ...selection, [group.id]: next });
  };

  return (
    <>
      {dish.modifierGroups.map((group) => (
        <div key={group.id} style={{ marginBottom: 16 }}>
          <Flex gap={8} align="baseline" wrap>
            <Typography.Text strong style={{ fontSize: 15 }}>
              {translate(group.name, i18n.language)}
            </Typography.Text>
            {minSelectOf(group) > 0 ? <Tag color="red">{t('orders.phone.modifiers.required')}</Tag> : null}
            <Typography.Text type={touched && issues[group.id] ? 'danger' : 'secondary'} style={{ fontSize: 13 }}>
              <GroupHint group={group} />
            </Typography.Text>
          </Flex>
          <Space direction="vertical" style={{ width: '100%', marginTop: 6 }}>
            {group.options.map((option) => {
              const checked = selection[group.id]?.includes(option.id) ?? false;
              const label = (
                <Flex justify="space-between" gap={12} style={{ minWidth: 260 }}>
                  <span>{translate(option.name, i18n.language)}</span>
                  {option.price.amount > 0 ? (
                    <span>
                      +<MoneyText value={option.price} type="secondary" />
                    </span>
                  ) : null}
                </Flex>
              );
              return group.maxSelect === 1 ? (
                <Radio key={option.id} checked={checked} onChange={(e) => toggle(group, option.id, e.target.checked)} style={{ padding: '4px 0' }}>
                  {label}
                </Radio>
              ) : (
                <Checkbox key={option.id} checked={checked} onChange={(e) => toggle(group, option.id, e.target.checked)} style={{ padding: '4px 0' }}>
                  {label}
                </Checkbox>
              );
            })}
          </Space>
        </div>
      ))}
      <Flex align="center" gap={12}>
        <Typography.Text>{t('orders.detail.quantity')}</Typography.Text>
        <InputNumber size="large" min={1} max={MAX_LINE_QUANTITY} value={quantity} onChange={(value) => onQuantity(value ?? 1)} />
      </Flex>
      {touched && Object.keys(issues).length > 0 ? (
        <Typography.Paragraph type="danger" style={{ marginTop: 12, marginBottom: 0 }}>
          {t('orders.phone.modifiers.tooFew')}
        </Typography.Paragraph>
      ) : null}
    </>
  );
}

/**
 * Выбор опций блюда. Группы модификаторов уже есть в меню филиала (GET /admin/orders/menu), доплаты —
 * как пришли с сервера; итог позиции посчитает расчёт заказа.
 */
export function ModifiersModal({
  dish,
  onClose,
  onAdd,
}: {
  dish: OrderMenuDish | null;
  onClose: () => void;
  onAdd: (line: { optionIds: string[]; labels: string[]; quantity: number }) => void;
}) {
  const { t, i18n } = useTranslation();
  const [selection, setSelection] = useState<ModifierSelection>(() => (dish ? defaultModifierSelection(dish.modifierGroups) : {}));
  const [quantity, setQuantity] = useState(1);
  const [touched, setTouched] = useState(false);

  return (
    <Modal
      open={dish !== null}
      title={dish ? t('orders.phone.modifiers.title', { name: translate(dish.name, i18n.language) }) : ''}
      onCancel={onClose}
      okText={t('orders.phone.modifiers.add')}
      okButtonProps={{ size: 'large' }}
      cancelButtonProps={{ size: 'large' }}
      cancelText={t('common.cancel')}
      onOk={() => {
        if (!dish) return;
        setTouched(true);
        if (Object.keys(modifierIssues(dish.modifierGroups, selection)).length > 0) return;
        const { optionIds, labels } = selectedOptions(dish.modifierGroups, selection, (name) => translate(name, i18n.language));
        onAdd({ optionIds, labels, quantity });
      }}
      destroyOnHidden
      width={560}
    >
      {dish ? (
        <ModifiersForm dish={dish} touched={touched} selection={selection} quantity={quantity} onSelection={setSelection} onQuantity={setQuantity} />
      ) : null}
    </Modal>
  );
}
