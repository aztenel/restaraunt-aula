import { Select, type SelectProps } from 'antd';
import { useTranslation } from 'react-i18next';
import { translate } from '@aula/api-client';
import { useBranch } from '../branch/BranchProvider';

export interface BranchSelectProps extends Omit<SelectProps<string | null>, 'options' | 'value' | 'onChange'> {
  value?: string | null;
  onChange?: (value: string | null) => void;
  /** Показать пункт «Все филиалы» (значение null). */
  allowAll?: boolean;
  /** Ограничить списком id. */
  onlyIds?: readonly string[];
}

/** Выбор филиала из доступных сотруднику (GET /admin/branches). Совместим с Form.Item. */
export function BranchSelect({ value, onChange, allowAll, onlyIds, placeholder, ...rest }: BranchSelectProps) {
  const { t, i18n } = useTranslation();
  const { branches, loading } = useBranch();
  const options = [
    ...(allowAll ? [{ value: '__all__', label: t('layout.allBranches') }] : []),
    ...branches
      .filter((b) => !onlyIds || onlyIds.includes(b.id))
      .map((b) => ({ value: b.id, label: translate(b.name, i18n.language) + (b.isActive ? '' : ` (${t('common.inactive')})`) })),
  ];
  return (
    <Select<string | null>
      {...rest}
      loading={loading}
      placeholder={placeholder ?? t('layout.branchPlaceholder')}
      value={value === null && allowAll ? '__all__' : (value ?? undefined)}
      onChange={(next) => onChange?.(next === '__all__' || next === undefined ? null : next)}
      options={options}
      showSearch
      optionFilterProp="label"
    />
  );
}
