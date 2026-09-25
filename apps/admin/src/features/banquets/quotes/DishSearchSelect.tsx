import { Select, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney, translate } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { banquetRefKeys, banquetsApi } from '../api';
import { useDebounced } from '../common/ui';
import type { DishOption } from '../types';


/** Поиск блюда в меню филиала заявки (GET /admin/banquets/menu/dishes): цена филиала сейчас — справочно. */
export function DishSearchSelect({ branchId, onPick, disabled }: { branchId: string; onPick: (dish: DishOption) => void; disabled?: boolean }) {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const dishes = useApiQuery(banquetRefKeys.dishes(branchId, q), () => banquetsApi.dishes(branchId, q, 20), { enabled: q.length > 0, staleTime: 60_000 });
  const byId = new Map((dishes.data ?? []).map((d) => [d.dishId, d]));

  return (
    <Select<string>
      showSearch
      value={null as unknown as string}
      disabled={disabled}
      placeholder={t('banquets.quote.editor.dishSearch')}
      filterOption={false}
      searchValue={search}
      onSearch={setSearch}
      loading={dishes.isFetching}
      notFoundContent={q && !dishes.isFetching ? t('banquets.quote.editor.dishSearchEmpty') : null}
      style={{ width: 360, maxWidth: '100%' }}
      onSelect={(dishId: string) => {
        const dish = byId.get(dishId);
        if (dish) onPick(dish);
        setSearch('');
      }}
      options={(dishes.data ?? []).map((d) => ({ value: d.dishId, label: translate(d.name, i18n.language), dish: d }))}
      optionRender={(option) => {
        const dish = (option.data as { dish: DishOption }).dish;
        return (
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <span>
              {translate(dish.name, i18n.language)}
              {dish.weightGrams ? <Typography.Text type="secondary"> · {t('catalog.dishes.grams', { value: dish.weightGrams })}</Typography.Text> : null}
            </span>
            <Space size={4}>
              {dish.availability !== 'available' ? <Tag color="red">{t('banquets.quote.editor.stopped')}</Tag> : null}
              <Typography.Text strong>{formatMoney(dish.price, i18n.language)}</Typography.Text>
            </Space>
          </Space>
        );
      }}
    />
  );
}
