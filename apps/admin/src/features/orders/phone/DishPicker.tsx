import { PlusOutlined, SearchOutlined, SettingOutlined } from '@ant-design/icons';
import { Button, Empty, Flex, Input, Segmented, Spin, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/shared/api/hooks';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MoneyText } from '@/shared/ui/MoneyText';
import { phoneOrderKeys, storefrontApi } from '../api';
import type { PublicDishCard } from '../types';

type Locale = 'kk' | 'ru' | 'en';

/**
 * Меню филиала для оператора (GET /public/catalog/branches/{slug}/menu — цены филиала, стоп-лист):
 * поиск, категории, крупные кнопки «Добавить». Блюдо с модификаторами открывает выбор опций.
 */
export function DishPicker({
  branchSlug,
  locale,
  onPick,
}: {
  branchSlug: string;
  locale: Locale;
  onPick: (dish: PublicDishCard) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const menu = useApiQuery(phoneOrderKeys.menu(branchSlug, locale), () => storefrontApi.menu(branchSlug, locale), { staleTime: 60_000 });

  const categories = useMemo(() => menu.data?.categories.filter((c) => c.dishes.length > 0) ?? [], [menu.data]);
  const dishes = useMemo(() => {
    const text = search.trim().toLowerCase();
    return categories
      .filter((c) => category === 'all' || c.id === category)
      .flatMap((c) => c.dishes)
      .filter((d) => !text || d.name.toLowerCase().includes(text));
  }, [categories, category, search]);

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
          options={[{ value: 'all', label: t('orders.phone.allCategories') }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
        />
      </div>
      <div style={{ maxHeight: 440, overflowY: 'auto', paddingInlineEnd: 4 }}>
        {dishes.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('orders.phone.noDishes')} /> : null}
        {dishes.map((dish) => (
          <Flex
            key={dish.id}
            align="center"
            gap={8}
            style={{ padding: '8px 4px', borderBottom: '1px solid #f0e6da', minHeight: 56, opacity: dish.available ? 1 : 0.55 }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <Typography.Text strong style={{ display: 'block' }} ellipsis>
                {dish.name}
              </Typography.Text>
              <Flex gap={6} align="center" wrap>
                <MoneyText value={dish.price} type="secondary" />
                {dish.weightGrams ? <Typography.Text type="secondary">· {t('orders.phone.grams', { value: dish.weightGrams })}</Typography.Text> : null}
                {!dish.available ? <Tag color="error">{t('orders.phone.unavailable')}</Tag> : null}
              </Flex>
            </div>
            <Button
              size="large"
              type={dish.hasModifiers ? 'default' : 'primary'}
              icon={dish.hasModifiers ? <SettingOutlined /> : <PlusOutlined />}
              disabled={!dish.available}
              onClick={() => onPick(dish)}
              aria-label={`${dish.hasModifiers ? t('orders.phone.choose') : t('orders.phone.add')}: ${dish.name}`}
            >
              {dish.hasModifiers ? t('orders.phone.choose') : t('orders.phone.add')}
            </Button>
          </Flex>
        ))}
      </div>
    </div>
  );
}
