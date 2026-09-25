/**
 * Номенклатура POS филиала: поиск, тип, только несопоставленные, пропавшие из POS; импорт номенклатуры
 * (фоновая задача) и сопоставление товара с блюдом прямо из списка.
 */
import { CloudDownloadOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Flex, Input, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Permission } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { useBranch } from '@/shared/branch/BranchProvider';
import { formatDateTime } from '@/shared/lib/dates';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { SingleBranchGate } from '../reservations/SingleBranchGate';
import { POS_PRODUCT_KINDS, posApi, posKeys, type PosProduct, type PosProductKind } from './api';
import { MappingDrawer, type MappingPrefill } from './MappingDrawer';

export function PosProductsTab() {
  const { t } = useTranslation();
  return (
    <SingleBranchGate
      permissions={[Permission.IntegrationsManage]}
      title={t('pos.branchRequired.title')}
      text={t('pos.branchRequired.text')}
      none={t('pos.branchRequired.none')}
    >
      {(branchId) => <ProductsWorkspace key={branchId} branchId={branchId} />}
    </SingleBranchGate>
  );
}

function ProductsWorkspace({ branchId }: { branchId: string }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const { getBranch } = useBranch();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<PosProductKind | undefined>();
  const [unmappedOnly, setUnmappedOnly] = useState(true);
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const [page, setPage] = useState({ page: 1, perPage: 50 });
  const [importing, setImporting] = useState(false);
  const [prefill, setPrefill] = useState<MappingPrefill | null>(null);
  const query = { branchId, q: q.trim() || undefined, kind, unmappedOnly: unmappedOnly || undefined, includeRemoved: includeRemoved || undefined, ...page };
  const list = useApiQuery(posKeys.products(query), () => posApi.products(query), { keepPrevious: true });

  const update = (fn: () => void) => {
    fn();
    setPage((p) => ({ ...p, page: 1 }));
  };

  const runImport = async () => {
    setImporting(true);
    try {
      const job = await posApi.importProducts(branchId);
      void message.success(job.alreadyQueued ? t('pos.status.alreadyQueued') : t('pos.status.importQueued'));
      void queryClient.invalidateQueries({ queryKey: posKeys.all });
    } catch (error) {
      notifyError(error);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card
      title={
        <Space>
          {t('pos.products.title')}
          {list.data ? <Tag>{list.data.provider}</Tag> : null}
        </Space>
      }
      extra={
        <Button icon={<CloudDownloadOutlined />} loading={importing} onClick={() => void runImport()}>
          {t('pos.status.importProducts')}
        </Button>
      }
    >
      <Flex gap={8} wrap align="center" style={{ marginBottom: 12 }}>
        <Input.Search allowClear placeholder={t('pos.products.search')} onSearch={(value) => update(() => setQ(value))} style={{ width: 260 }} />
        <Select<PosProductKind | undefined>
          allowClear
          placeholder={t('pos.products.allKinds')}
          value={kind}
          onChange={(value) => update(() => setKind(value))}
          options={POS_PRODUCT_KINDS.map((k) => ({ value: k, label: t(`pos.products.kinds.${k}`) }))}
          style={{ width: 160 }}
        />
        <Space>
          <Switch checked={unmappedOnly} onChange={(value) => update(() => setUnmappedOnly(value))} />
          <span>{t('pos.products.unmappedOnly')}</span>
        </Space>
        <Space>
          <Switch checked={includeRemoved} onChange={(value) => update(() => setIncludeRemoved(value))} />
          <span>{t('pos.products.includeRemoved')}</span>
        </Space>
      </Flex>
      {list.error ? <ErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : null}
      <Table<PosProduct>
        rowKey="id"
        size="small"
        loading={list.isFetching}
        dataSource={list.data?.items ?? []}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('pos.products.empty') }}
        pagination={{
          current: page.page,
          pageSize: page.perPage,
          total: list.data?.total ?? 0,
          onChange: (p, perPage) => setPage({ page: perPage === page.perPage ? p : 1, perPage }),
        }}
        columns={[
          {
            title: t('pos.products.name'),
            key: 'name',
            render: (_, p) => (
              <Space direction="vertical" size={0}>
                <span>
                  {p.name} {p.removed ? <Tag color="error">{t('pos.products.removed')}</Tag> : null}
                </span>
                <Typography.Text type="secondary" code style={{ fontSize: 12 }}>
                  {p.externalProductId}
                </Typography.Text>
              </Space>
            ),
          },
          { title: t('pos.products.sku'), key: 'sku', render: (_, p) => p.sku ?? '—' },
          { title: t('pos.products.kind'), key: 'kind', render: (_, p) => t(`pos.products.kinds.${p.kind}`) },
          { title: t('pos.products.group'), key: 'group', render: (_, p) => p.groupName ?? '—' },
          {
            title: t('pos.products.mapped'),
            key: 'mapped',
            render: (_, p) => (p.mappedDishIds.length > 0 ? <Tag color="green">{t('pos.products.mappedCount', { count: p.mappedDishIds.length })}</Tag> : <Tag>{t('pos.products.notMapped')}</Tag>),
          },
          { title: t('pos.products.importedAt'), key: 'importedAt', render: (_, p) => formatDateTime(p.importedAt) },
          {
            key: 'actions',
            render: (_, p) =>
              p.removed ? null : (
                <Button size="small" onClick={() => setPrefill({ externalProductId: p.externalProductId, externalName: p.name })}>
                  {t('pos.products.map')}
                </Button>
              ),
          },
        ]}
      />
      <MappingDrawer
        open={prefill !== null}
        branchId={branchId}
        branchSlug={getBranch(branchId)?.slug ?? null}
        mapping={null}
        prefill={prefill ?? undefined}
        onClose={() => setPrefill(null)}
      />
    </Card>
  );
}
