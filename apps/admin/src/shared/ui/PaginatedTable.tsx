import { Table, type TableProps } from 'antd';
import { useTranslation } from 'react-i18next';
import type { Page } from '@aula/api-client';

export interface PaginatedTableProps<T> extends Omit<TableProps<T>, 'dataSource' | 'pagination' | 'loading'> {
  data: Page<T> | undefined;
  loading?: boolean;
  page: number;
  perPage: number;
  onPageChange: (page: number, perPage: number) => void;
  pageSizeOptions?: number[];
}

/** Таблица для страниц API { items, total, page, perPage } с серверной пагинацией. */
export function PaginatedTable<T extends object>({
  data,
  loading,
  page,
  perPage,
  onPageChange,
  pageSizeOptions = [20, 50, 100, 200],
  scroll,
  ...rest
}: PaginatedTableProps<T>) {
  const { t } = useTranslation();
  return (
    <Table<T>
      {...rest}
      size={rest.size ?? 'middle'}
      scroll={scroll ?? { x: 'max-content' }}
      loading={loading}
      dataSource={data?.items ?? []}
      pagination={{
        current: page,
        pageSize: perPage,
        total: data?.total ?? 0,
        showSizeChanger: true,
        pageSizeOptions,
        showTotal: (total) => t('common.total', { count: total }),
        onChange: onPageChange,
      }}
    />
  );
}
