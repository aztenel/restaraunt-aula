import { PlusOutlined, SearchOutlined, SettingOutlined, StopOutlined } from '@ant-design/icons';
import { Button, Empty, Flex, Input, Segmented, Spin, Tag, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { translate } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { formatDateTime } from '@/shared/lib/dates';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MoneyText } from '@/shared/ui/MoneyText';
import { ordersApi, phoneOrderKeys } from '../api';
import type { OrderMenuDish } from '../types';
import { dishNeedsModifiers } from './phone-order';

/**
 * Меню филиала для оператора (GET /admin/orders/menu — цены филиала, модификаторы, стоп-лист):
 * поиск, категории, крупные кнопки «Добавить». Блюда из стоп-листа видны, но недоступны к заказу.
 * Изменения стоп-листа приходят лентой событий (entityType dish) — меню перезапрашивается.
 */
export function DishPicker({ branchId, onPick }: { branchId: string; onPick: (dish: OrderMenuDish) => void }) {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const menu = useApiQuery(phoneOrderKeys.menu(branchId), () => ordersApi.menu(branchId), { staleTime: 60_000 });
  const name = (value: OrderMenuDish['name']) => translate(value, i18n.language);

  const categories = useMemo(() => {
    const withDishes = new Set((menu.data?.dishes ?? []).map((d) => d.categoryId));
    return (menu.data?.categories ?? []).filter((c) => withDishes.has(c.id));
  }, [menu.data]);
  const dishes = useMemo(() => {
    const text = search.trim().toLowerCase();
    return (menu.data?.dishes ?? []).filter(
      (d) => (category === 'all' || d.categoryId === category) && (!text || translate(d.name, i18n.language).toLowerCase().includes(text) || d.sku?.toLowerCase() === text),
    );
  }, [menu.data, category, search, i18n.language]);

  if (menu.error) return <ErrorAlert error={menu.error} onRetry={() => void menu.refetch()} />;
  if (menu.isLoading) return <Spin style={{ display: 'block', margin: '24px auto' }} />;

  return (
    <div>
      <Input
        allowClear
        size="large"
        prefix={<SearchOutlined />}
        placeholder={t('orders.phone.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <div style={{ overflowX: 'auto', marginBottom: 8 }}>
        <Segmented
          value={category}
          onChange={(value) => setCategory(String(value))}
          options={[{ value: 'all', label: t('orders.phone.allCategories') }, ...categories.map((c) => ({ value: c.id, label: translate(c.name, i18n.language) }))]}
        />
      </div>
      <div style={{ maxHeight: 440, overflowY: 'auto', paddingInlineEnd: 4 }}>
        {dishes.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('orders.phone.noDishes')} /> : null}
        {dishes.map((dish) => {
          const withModifiers = dishNeedsModifiers(dish);
          const label = withModifiers ? t('orders.phone.choose') : t('orders.phone.add');
          return (
            <Flex
              key={dish.dishId}
              align="center"
              gap={8}
              style={{ padding: '8px 4px', borderBottom: '1px solid #f0e6da', minHeight: 56, opacity: dish.stopped ? 0.6 : 1 }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <Typography.Text strong style={{ display: 'block' }} ellipsis>
                  {name(dish.name)}
                </Typography.Text>
                <Flex gap={6} align="center" wrap>
                  <MoneyText value={dish.price} type="secondary" />
                  {dish.weightGrams ? <Typography.Text type="secondary">· {t('orders.phone.grams', { value: dish.weightGrams })}</Typography.Text> : null}
                  {dish.stopped ? (
                    <Tooltip title={dish.stopReason ?? undefined}>
                      <Tag color="error" icon={<StopOutlined />}>
                        {dish.stoppedUntil ? t('orders.phone.stoppedUntil', { time: formatDateTime(dish.stoppedUntil) }) : t('orders.phone.unavailable')}
                      </Tag>
                    </Tooltip>
                  ) : null}
                </Flex>
              </div>
              <Button
                size="large"
                type={withModifiers ? 'default' : 'primary'}
                icon={withModifiers ? <SettingOutlined /> : <PlusOutlined />}
                disabled={dish.stopped}
                onClick={() => onPick(dish)}
                aria-label={`${label}: ${name(dish.name)}`}
              >
                {label}
              </Button>
            </Flex>
          );
        })}
      </div>
    </div>
  );
}
