import { Select, type SelectProps } from 'antd';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/shared/api/hooks';
import { banquetsApi, banquetsKeys } from '../api';

export interface ManagerSelectProps extends Omit<SelectProps<string | null>, 'options' | 'value' | 'onChange'> {
  value?: string | null;
  onChange?: (value: string | null) => void;
  /** Показать нагрузку (открытых заявок) у каждого менеджера. */
  showLoad?: boolean;
}

/** Банкетные менеджеры (GET /admin/banquets/managers) с нагрузкой. Совместим с Form.Item. */
export function ManagerSelect({ value, onChange, showLoad = true, placeholder, ...rest }: ManagerSelectProps) {
  const { t } = useTranslation();
  const managers = useApiQuery(banquetsKeys.managers, banquetsApi.managers, { staleTime: 60_000 });
  const options = (managers.data ?? []).map((m) => ({
    value: m.id,
    label: showLoad ? `${m.name} · ${t('banquets.detail.openRequests', { count: m.openRequests })}` : m.name,
  }));
  return (
    <Select<string | null>
      {...rest}
      loading={managers.isLoading}
      value={value ?? undefined}
      onChange={(next) => onChange?.(next ?? null)}
      options={options}
      placeholder={placeholder ?? t('banquets.pipeline.filters.allManagers')}
      showSearch
      optionFilterProp="label"
    />
  );
}
