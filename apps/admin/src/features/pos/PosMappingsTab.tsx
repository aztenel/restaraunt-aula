/**
 * Сопоставления блюд филиала с товарами POS (integrations.manage): список, создание, правка, удаление;
 * автоподбор — несопоставленные товары POS и похожие блюда (score), массовое принятие подсказок.
 */
import { CheckOutlined, PlusOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Empty, Input, Progress, Select, Slider, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Permission, translate } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { useBranch } from '@/shared/branch/BranchProvider';
import { formatDateTime } from '@/shared/lib/dates';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { SingleBranchGate } from '../reservations/SingleBranchGate';
import { posApi, posKeys, type MappingSuggestion, type ProductMapping } from './api';
import { MappingDrawer, type MappingPrefill } from './MappingDrawer';
import { chunk, DEFAULT_SCORE_THRESHOLD, defaultSelection, scorePercent, toBulkPlan, type SuggestionSelection } from './suggestions';

export function PosMappingsTab() {
  const { t } = useTranslation();
  return (
    <SingleBranchGate
      permissions={[Permission.IntegrationsManage]}
      title={t('pos.branchRequired.title')}
      text={t('pos.branchRequired.text')}
      none={t('pos.branchRequired.none')}
    >
      {(branchId) => <MappingsWorkspace key={branchId} branchId={branchId} />}
    </SingleBranchGate>
  );
}

type Editing = { mapping: ProductMapping | null; prefill?: MappingPrefill } | null;

function MappingsWorkspace({ branchId }: { branchId: string }) {
  const { t, i18n } = useTranslation();
  const { getBranch } = useBranch();
  const branchSlug = getBranch(branchId)?.slug ?? null;
  const [page, setPage] = useState({ page: 1, perPage: 50 });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const queryClient = useQueryClient();
  const query = { branchId, externalProductId: search.trim() || undefined, ...page };
  const list = useApiQuery(posKeys.mappings(query), () => posApi.mappings(query), { keepPrevious: true });

  return (
    <>
      <Card
        title={t('pos.mappings.title')}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ mapping: null })}>
            {t('pos.mappings.create')}
          </Button>
        }
      >
        <Input.Search
          allowClear
          placeholder={t('pos.mappings.searchPlaceholder')}
          onSearch={(value) => {
            setSearch(value);
            setPage((p) => ({ ...p, page: 1 }));
          }}
          style={{ width: 320, marginBottom: 12 }}
        />
        {list.error ? <ErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : null}
        <Table<ProductMapping>
          rowKey="id"
          size="small"
          loading={list.isFetching}
          dataSource={list.data?.items ?? []}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: t('pos.mappings.empty') }}
          pagination={{
            current: page.page,
            pageSize: page.perPage,
            total: list.data?.total ?? 0,
            onChange: (p, perPage) => setPage({ page: perPage === page.perPage ? p : 1, perPage }),
          }}
          columns={[
            {
              title: t('pos.fields.dish'),
              key: 'dish',
              render: (_, m) =>
                m.dishName ? (
                  translate(m.dishName, i18n.language)
                ) : (
                  <Typography.Text type="warning">{t('pos.mappings.dishRemoved')}</Typography.Text>
                ),
            },
            {
              title: t('pos.fields.product'),
              key: 'product',
              render: (_, m) => (
                <Space direction="vertical" size={0}>
                  <span>{m.externalName ?? '—'}</span>
                  <Typography.Text type="secondary" code style={{ fontSize: 12 }}>
                    {m.externalProductId}
                  </Typography.Text>
                </Space>
              ),
            },
            { title: t('pos.fields.provider'), dataIndex: 'provider' },
            { title: t('pos.mappings.modifiers'), key: 'mods', align: 'right', render: (_, m) => m.modifiers.length },
            { title: t('pos.mappings.updatedAt'), key: 'updatedAt', render: (_, m) => formatDateTime(m.updatedAt) },
            {
              key: 'actions',
              render: (_, m) => (
                <Space>
                  <Button size="small" onClick={() => setEditing({ mapping: m })}>
                    {t('common.edit')}
                  </Button>
                  <ConfirmAction
                    title={t('pos.mappings.deleteConfirm')}
                    danger
                    okText={t('common.delete')}
                    successMessage={t('pos.mappings.deleted')}
                    buttonProps={{ size: 'small' }}
                    onConfirm={async () => {
                      await posApi.deleteMapping(m.id);
                      await queryClient.invalidateQueries({ queryKey: posKeys.all });
                    }}
                  >
                    {t('common.delete')}
                  </ConfirmAction>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <SuggestionsCard branchId={branchId} />
      <MappingDrawer
        open={editing !== null}
        branchId={branchId}
        branchSlug={branchSlug}
        mapping={editing?.mapping ?? null}
        prefill={editing?.prefill}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

/** Автоподбор: товары POS без сопоставления и кандидаты среди блюд меню; принять выбранные одной кнопкой. */
function SuggestionsCard({ branchId }: { branchId: string }) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const [page, setPage] = useState(1);
  const [threshold, setThreshold] = useState(DEFAULT_SCORE_THRESHOLD);
  const [selection, setSelection] = useState<SuggestionSelection>({});
  const [saving, setSaving] = useState(false);
  const query = { branchId, page, perPage: 25 };
  const suggestions = useApiQuery(posKeys.suggestions(query), () => posApi.suggestions(query), { keepPrevious: true });
  const items = useMemo(() => suggestions.data?.items ?? [], [suggestions.data]);

  useEffect(() => setSelection(defaultSelection(items, threshold)), [items, threshold]);

  const plan = toBulkPlan(items, selection);
  const conflictProducts = new Set(Object.values(plan.conflicts).flat());

  const accept = async () => {
    if (plan.items.length === 0) return;
    setSaving(true);
    let created = 0;
    let updated = 0;
    try {
      for (const part of chunk(plan.items)) {
        const result = await posApi.bulkMappings({ branchId, provider: suggestions.data?.provider, items: part });
        created += result.created;
        updated += result.updated;
      }
      void message.success(t('pos.suggestions.saved', { created, updated }));
      await queryClient.invalidateQueries({ queryKey: posKeys.all });
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      style={{ marginTop: 16 }}
      title={t('pos.suggestions.title')}
      extra={
        <Space wrap>
          <Typography.Text type="secondary">{t('pos.suggestions.threshold', { value: scorePercent(threshold) })}</Typography.Text>
          <Slider min={0.5} max={1} step={0.05} value={threshold} onChange={setThreshold} style={{ width: 140 }} />
          <Button type="primary" icon={<CheckOutlined />} disabled={plan.items.length === 0} loading={saving} onClick={() => void accept()}>
            {t('pos.suggestions.accept', { count: plan.items.length })}
          </Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">{t('pos.suggestions.hint')}</Typography.Paragraph>
      {suggestions.error ? <ErrorAlert error={suggestions.error} onRetry={() => void suggestions.refetch()} /> : null}
      {Object.keys(plan.conflicts).length > 0 ? <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t('pos.suggestions.conflicts')} /> : null}
      {suggestions.data && items.length === 0 ? (
        <Empty description={t('pos.suggestions.empty')} />
      ) : (
        <Table<MappingSuggestion>
          rowKey={(s) => s.product.externalProductId}
          size="small"
          loading={suggestions.isFetching}
          dataSource={items}
          scroll={{ x: 'max-content' }}
          pagination={{ current: page, pageSize: 25, total: suggestions.data?.total ?? 0, onChange: setPage, showSizeChanger: false }}
          rowClassName={(s) => (conflictProducts.has(s.product.externalProductId) ? 'aula-row-error' : '')}
          columns={[
            {
              title: t('pos.fields.product'),
              key: 'product',
              render: (_, s) => (
                <Space direction="vertical" size={0}>
                  <span>
                    {s.product.name} {s.product.sku ? <Tag>{s.product.sku}</Tag> : null}
                  </span>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {[s.product.groupName, s.product.externalProductId].filter(Boolean).join(' · ')}
                  </Typography.Text>
                </Space>
              ),
            },
            {
              title: t('pos.suggestions.dish'),
              key: 'dish',
              width: 360,
              render: (_, s) => (
                <Select<string | null>
                  allowClear
                  style={{ width: '100%' }}
                  placeholder={t('pos.suggestions.noCandidate')}
                  value={selection[s.product.externalProductId] ?? null}
                  onChange={(value) => setSelection((prev) => ({ ...prev, [s.product.externalProductId]: value ?? null }))}
                  status={conflictProducts.has(s.product.externalProductId) ? 'error' : undefined}
                  options={[...s.candidates]
                    .sort((a, b) => b.score - a.score)
                    .map((c) => ({
                      value: c.dishId,
                      label: (
                        <Space size={6}>
                          <span>{translate(c.dishName, i18n.language) || c.dishId}</span>
                          <Tag color={c.method === 'sku' ? 'green' : 'blue'}>
                            {c.method === 'sku' ? t('pos.suggestions.bySku') : `${scorePercent(c.score)}%`}
                          </Tag>
                        </Space>
                      ),
                    }))}
                />
              ),
            },
            {
              title: t('pos.suggestions.score'),
              key: 'score',
              width: 140,
              render: (_, s) => {
                const chosen = s.candidates.find((c) => c.dishId === selection[s.product.externalProductId]);
                return chosen ? <Progress percent={scorePercent(chosen.score)} size="small" /> : null;
              },
            },
          ]}
        />
      )}
    </Card>
  );
}
