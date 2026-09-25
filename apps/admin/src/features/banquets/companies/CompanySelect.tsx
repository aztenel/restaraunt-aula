import { PlusOutlined } from '@ant-design/icons';
import { Button, Select, Space, type SelectProps } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/shared/api/hooks';
import { banquetRefKeys, banquetsApi } from '../api';
import { useDebounced } from '../common/ui';
import type { ClientCompany } from '../types';
import { CompanyFormModal } from './CompanyFormModal';

export interface CompanySelectProps extends Omit<SelectProps<string | null>, 'options' | 'value' | 'onChange' | 'onSearch'> {
  value?: string | null;
  onChange?: (value: string | null, company: ClientCompany | null) => void;
  /** Уже известная компания (например, компания заявки) — чтобы показать название без поиска. */
  initialCompany?: ClientCompany | null;
  /** Кнопка «Новая компания» (права banquets.manage или banquets.invoice). */
  allowCreate?: boolean;
}


/** Выбор компании-заказчика: поиск по названию или БИН, создание новой прямо из формы. Совместим с Form.Item. */
export function CompanySelect({ value, onChange, initialCompany, allowCreate, placeholder, ...rest }: CompanySelectProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [known, setKnown] = useState<ClientCompany[]>(() => (initialCompany ? [initialCompany] : []));
  const q = useDebounced(search.trim(), 300);
  const params = { q: q || undefined, page: 1, perPage: 20 };
  const companies = useApiQuery(banquetRefKeys.companyList(params), () => banquetsApi.companies(params), { keepPrevious: true, staleTime: 30_000 });

  useEffect(() => {
    if (initialCompany) setKnown((list) => (list.some((c) => c.id === initialCompany.id) ? list : [initialCompany, ...list]));
  }, [initialCompany]);

  const all = useMemo(() => {
    const map = new Map<string, ClientCompany>();
    for (const c of [...known, ...(companies.data?.items ?? [])]) map.set(c.id, c);
    return map;
  }, [known, companies.data]);

  const options = [...all.values()].map((c) => ({ value: c.id, label: `${c.name} · ${c.bin}` }));

  return (
    <>
      <Space.Compact style={{ width: '100%' }}>
        <Select<string | null>
          {...rest}
          value={value ?? undefined}
          onChange={(next) => onChange?.(next ?? null, next ? (all.get(next) ?? null) : null)}
          options={options}
          loading={companies.isFetching}
          showSearch
          filterOption={false}
          onSearch={setSearch}
          placeholder={placeholder ?? t('banquets.companies.select.placeholder')}
          notFoundContent={companies.isFetching ? undefined : t('banquets.companies.empty')}
          style={{ width: '100%' }}
        />
        {allowCreate ? (
          <Button icon={<PlusOutlined />} onClick={() => setCreating(true)} title={t('banquets.companies.select.createNew')}>
            <span className="aula-hide-sm">{t('banquets.companies.select.createNew')}</span>
          </Button>
        ) : null}
      </Space.Compact>
      <CompanyFormModal
        open={creating}
        company={null}
        onClose={() => setCreating(false)}
        onSaved={(company) => {
          setCreating(false);
          setKnown((list) => [company, ...list.filter((c) => c.id !== company.id)]);
          void queryClient.invalidateQueries({ queryKey: banquetRefKeys.companies });
          onChange?.(company.id, company);
        }}
      />
    </>
  );
}
