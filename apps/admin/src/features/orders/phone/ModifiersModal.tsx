import { Checkbox, Flex, InputNumber, Modal, Radio, Space, Spin, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/shared/api/hooks';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MoneyText } from '@/shared/ui/MoneyText';
import { phoneOrderKeys, storefrontApi } from '../api';
import type { PublicDishCard, PublicModifierGroup } from '../types';
import { defaultModifierSelection, MAX_LINE_QUANTITY, modifierIssues, selectedOptions, type ModifierSelection } from './phone-order';

type Locale = 'kk' | 'ru' | 'en';

function GroupHint({ group }: { group: PublicModifierGroup }) {
  const { t } = useTranslation();
  const min = Math.max(group.minSelect, group.isRequired ? 1 : 0);
  if (min > 0 && min === group.maxSelect) return <>{t('orders.phone.modifiers.exactly', { count: min })}</>;
  if (min > 0) return <>{t('orders.phone.modifiers.range', { min, max: group.maxSelect })}</>;
  return <>{t('orders.phone.modifiers.upTo', { max: group.maxSelect })}</>;
}

/**
 * Выбор опций блюда (карточка блюда витрины с группами модификаторов). Доплаты показываются как
 * пришли с сервера; итог позиции посчитает расчёт заказа.
 */
export function ModifiersModal({
  branchSlug,
  locale,
  dish,
  onClose,
  onAdd,
}: {
  branchSlug: string;
  locale: Locale;
  dish: PublicDishCard | null;
  onClose: () => void;
  onAdd: (line: { optionIds: string[]; labels: string[]; quantity: number }) => void;
}) {
  const { t } = useTranslation();
  const detail = useApiQuery(phoneOrderKeys.dish(branchSlug, dish?.slug ?? '', locale), () => storefrontApi.dish(branchSlug, dish?.slug ?? '', locale), {
    enabled: dish !== null,
    staleTime: 60_000,
  });
  const groups = dish ? (detail.data?.modifierGroups ?? []) : [];
  const [selection, setSelection] = useState<ModifierSelection>({});
  const [quantity, setQuantity] = useState(1);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (dish && detail.data && detail.data.id === dish.id) {
      setSelection(defaultModifierSelection(detail.data.modifierGroups));
      setQuantity(1);
      setTouched(false);
    }
  }, [dish, detail.data]);

  const issues = modifierIssues(groups, selection);
  const invalid = Object.keys(issues).length > 0;

  const toggle = (group: PublicModifierGroup, optionId: string, checked: boolean) => {
    setSelection((current) => {
      const selected = current[group.id] ?? [];
      if (group.maxSelect === 1) return { ...current, [group.id]: checked ? [optionId] : [] };
      return { ...current, [group.id]: checked ? [...selected.filter((id) => id !== optionId), optionId] : selected.filter((id) => id !== optionId) };
    });
  };

  return (
    <Modal
      open={dish !== null}
      title={dish ? t('orders.phone.modifiers.title', { name: dish.name }) : ''}
      onCancel={onClose}
      okText={t('orders.phone.modifiers.add')}
      okButtonProps={{ size: 'large', disabled: !detail.data }}
      cancelButtonProps={{ size: 'large' }}
      cancelText={t('common.cancel')}
      onOk={() => {
        setTouched(true);
        if (invalid) return;
        const { optionIds, labels } = selectedOptions(groups, selection);
        onAdd({ optionIds, labels, quantity });
      }}
      destroyOnHidden
      width={560}
    >
      {detail.isLoading ? <Spin style={{ display: 'block', margin: '24px auto' }} /> : null}
      {detail.error ? <ErrorAlert error={detail.error} onRetry={() => void detail.refetch()} /> : null}
      {groups.map((group) => (
        <div key={group.id} style={{ marginBottom: 16 }}>
          <Flex gap={8} align="baseline" wrap>
            <Typography.Text strong style={{ fontSize: 15 }}>
              {group.name}
            </Typography.Text>
            {group.isRequired || group.minSelect > 0 ? <Tag color="red">{t('orders.phone.modifiers.required')}</Tag> : null}
            <Typography.Text type={touched && issues[group.id] ? 'danger' : 'secondary'} style={{ fontSize: 13 }}>
              <GroupHint group={group} />
            </Typography.Text>
          </Flex>
          <Space direction="vertical" style={{ width: '100%', marginTop: 6 }}>
            {group.options.map((option) => {
              const checked = selection[group.id]?.includes(option.id) ?? false;
              const label = (
                <Flex justify="space-between" gap={12} style={{ minWidth: 260 }}>
                  <span>{option.name}</span>
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
      {detail.data ? (
        <Flex align="center" gap={12}>
          <Typography.Text>{t('orders.detail.quantity')}</Typography.Text>
          <InputNumber size="large" min={1} max={MAX_LINE_QUANTITY} value={quantity} onChange={(value) => setQuantity(value ?? 1)} />
        </Flex>
      ) : null}
      {touched && invalid ? (
        <Typography.Paragraph type="danger" style={{ marginTop: 12, marginBottom: 0 }}>
          {t('orders.phone.modifiers.tooFew')}
        </Typography.Paragraph>
      ) : null}
    </Modal>
  );
}
