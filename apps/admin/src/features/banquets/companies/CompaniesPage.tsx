import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Flex, Input, Space, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/shared/api/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PaginatedTable } from '@/shared/ui/PaginatedTable';
import { useSectionAbilities } from '../abilities';
import { banquetRefKeys, banquetsApi } from '../api';
import type { ClientCompany } from '../types';
import { CompanyFormModal } from './CompanyFormModal';

/** Справочник компаний-заказчиков: поиск по названию и БИН, реквизиты для договоров, счетов, актов и ЭСФ. */
export function CompaniesPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const abilities = useSectionAbilities();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [editing, setEditing] = useState<ClientCompany | 'new' | null>(null);
  const params = { q: q.trim() || undefined, page, perPage };
  const companies = useApiQuery(banquetRefKeys.companyList(params), () => banquetsApi.companies(params), { keepPrevious: true });

  const refresh = () => queryClient.invalidateQueries({ queryKey: banquetRefKeys.companies });

  const columns: ColumnsType<ClientCompany> = [
    {
      title: t('banquets.companies.fields.name'),
      dataIndex: 'name',
      render: (name: string, c) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {c.legalAddress}
          </Typography.Text>
        </Space>
      ),
    },
    { title: t('banquets.companies.fields.bin'), dataIndex: 'bin', render: (bin: string) => <Typography.Text copyable>{bin}</Typography.Text> },
    {
      title: t('banquets.companies.sections.bank'),
      key: 'bank',
      responsive: ['lg'],
      render: (_, c) =>
        c.iban ? (
          <Space direction="vertical" size={0}>
            <span>{c.bankName ?? '—'}</span>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {c.iban} · {c.bik ?? '—'} · {t('banquets.companies.fields.kbe')} {c.kbe ?? '—'}
            </Typography.Text>
          </Space>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: t('banquets.companies.sections.contact'),
      key: 'contact',
      responsive: ['md'],
      render: (_, c) => (
        <Space direction="vertical" size={0}>
          <span>{c.contactName ?? c.directorName ?? '—'}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {[c.contactPhone, c.contactEmail].filter(Boolean).join(' · ') || '—'}
          </Typography.Text>
        </Space>
      ),
    },
    ...(abilities.companiesEdit
      ? [
          {
            title: t('common.actions'),
            key: 'actions',
            width: 110,
            render: (_: unknown, c: ClientCompany) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(c)} aria-label={t('common.edit')} />
                <ConfirmAction
                  title={t('banquets.companies.deleteConfirm', { name: c.name })}
                  description={t('banquets.companies.deleteHint')}
                  danger
                  successMessage={t('banquets.companies.deleted')}
                  onConfirm={async () => {
                    await banquetsApi.deleteCompany(c.id);
                    await refresh();
                  }}
                  buttonProps={{ size: 'small', icon: <DeleteOutlined />, 'aria-label': t('common.delete') }}
                >
                  {null}
                </ConfirmAction>
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <Flex justify="space-between" gap={12} wrap style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={0}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t('banquets.companies.title')}
          </Typography.Title>
          <Typography.Text type="secondary">{t('banquets.companies.subtitle')}</Typography.Text>
        </Space>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder={t('banquets.companies.search')}
            onSearch={(value) => {
              setQ(value);
              setPage(1);
            }}
            style={{ width: 280 }}
          />
          {abilities.companiesEdit ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
              {t('banquets.companies.create')}
            </Button>
          ) : null}
        </Space>
      </Flex>
      {companies.error ? <ErrorAlert error={companies.error} onRetry={() => void companies.refetch()} /> : null}
      <PaginatedTable<ClientCompany>
        rowKey="id"
        columns={columns}
        data={companies.data}
        loading={companies.isFetching}
        page={page}
        perPage={perPage}
        onPageChange={(p, size) => {
          setPage(p);
          setPerPage(size);
        }}
        locale={{ emptyText: t('banquets.companies.empty') }}
        onRow={(c) => ({ onDoubleClick: () => abilities.companiesEdit && setEditing(c) })}
      />
      <CompanyFormModal
        open={editing !== null}
        company={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void message.success(t('banquets.companies.saved'));
          void refresh();
        }}
      />
    </>
  );
}
