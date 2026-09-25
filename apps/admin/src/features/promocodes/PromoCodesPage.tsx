import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Flex, Input, Segmented, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney, Permission, translate } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useCan } from '@/shared/auth/useCan';
import { useBranch } from '@/shared/branch/BranchProvider';
import { formatDateTime } from '@/shared/lib/dates';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageHeader } from '@/shared/ui/PageHeader';
import { PaginatedTable } from '@/shared/ui/PaginatedTable';
import { promoApi, promoKeys, type PromoListQuery } from './api';
import { PromoCodeModal } from './PromoCodeModal';
import { bpToPercentText, promoListParams, promoToInput, type PromoCode, type PromoScopeFilter, type PromoStatusFilter } from './promo-form';

/** Срок действия для таблицы: истёк / ещё не начался — по часам сотрудника (только подсказка). */
function validityState(promo: PromoCode, now: number): 'expired' | 'notStarted' | null {
  if (promo.validTo && Date.parse(promo.validTo) <= now) return 'expired';
  if (promo.validFrom && Date.parse(promo.validFrom) > now) return 'notStarted';
  return null;
}

/**
 * Промокоды (promocodes.manage): список с поиском и статистикой использований, создание и изменение,
 * включение/выключение и удаление. Промокод сети меняет только глобальная роль (editable от сервера).
 */
export function PromoCodesPage() {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { branchesWith } = useCan();
  const { branches, branchName, selectedBranchId } = useBranch();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PromoStatusFilter>('all');
  const [scopeFilter, setScopeFilter] = useState<PromoScopeFilter>('all');
  const [branchFilter, setBranchFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [editing, setEditing] = useState<PromoCode | null>(null);
  const [creating, setCreating] = useState(false);
  const [now] = useState(() => Date.now());

  const scope = branchesWith(Permission.PromoCodesManage);
  const branchOptions = branches.filter((b) => scope === 'all' || scope.includes(b.id));

  const params: PromoListQuery = useMemo(
    () => promoListParams({ search, status, scope: scopeFilter, branchId: branchFilter, page, perPage }),
    [search, status, scopeFilter, branchFilter, page, perPage],
  );
  const list = useApiQuery(promoKeys.list(params), () => promoApi.list(params), { keepPrevious: true });
  const refresh = () => queryClient.invalidateQueries({ queryKey: promoKeys.all });
  const money = (value: PromoCode['fixedAmount']) => formatMoney(value, i18n.language);

  return (
    <>
      <PageHeader
        title={t('nav.promocodes')}
        subtitle={t('sections.promocodes')}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            {t('promoCodes.create')}
          </Button>
        }
      />
      <Flex gap={8} wrap style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          placeholder={t('promoCodes.search')}
          style={{ width: 240 }}
          onSearch={(value) => {
            setSearch(value.trim());
            setPage(1);
          }}
        />
        <Segmented<PromoStatusFilter>
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          options={(['all', 'active', 'inactive'] as const).map((value) => ({ value, label: t(`promoCodes.status.${value}`) }))}
        />
        <Segmented<PromoScopeFilter>
          value={scopeFilter}
          onChange={(value) => {
            setScopeFilter(value);
            setPage(1);
          }}
          options={(['all', 'network', 'branch'] as const).map((value) => ({ value, label: t(`promoCodes.scope.${value}`) }))}
        />
        <Select<string>
          allowClear
          disabled={scopeFilter === 'network'}
          placeholder={t('promoCodes.branchFilter')}
          style={{ width: 220 }}
          value={scopeFilter === 'network' ? undefined : branchFilter}
          onChange={(value) => {
            setBranchFilter(value);
            setPage(1);
          }}
          options={branchOptions.map((b) => ({ value: b.id, label: translate(b.name, i18n.language) }))}
        />
      </Flex>
      {list.error ? <ErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : null}
      <PaginatedTable<PromoCode>
        rowKey="id"
        data={list.data}
        loading={list.isLoading || list.isPlaceholderData}
        page={page}
        perPage={perPage}
        onPageChange={(p, pp) => {
          setPage(p);
          setPerPage(pp);
        }}
        columns={[
          {
            title: t('promoCodes.columns.code'),
            key: 'code',
            render: (_, promo) => (
              <div style={{ maxWidth: 260 }}>
                <Typography.Text strong code copyable>
                  {promo.code}
                </Typography.Text>
                {promo.description ? (
                  <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }} ellipsis={{ rows: 2 }}>
                    {promo.description}
                  </Typography.Paragraph>
                ) : null}
              </div>
            ),
          },
          {
            title: t('promoCodes.columns.discount'),
            key: 'discount',
            render: (_, promo) => (
              <div>
                {promo.kind === 'percent' ? (
                  <Typography.Text strong>{t('promoCodes.discountPercent', { value: bpToPercentText(promo.percentBp, i18n.language) })}</Typography.Text>
                ) : promo.kind === 'fixed' ? (
                  <Typography.Text strong>−{money(promo.fixedAmount)}</Typography.Text>
                ) : (
                  <Tag color="green">{t('promoCodes.discountFree')}</Tag>
                )}
                <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                  {t(`promoCodes.kinds.${promo.kind}`)}
                </Typography.Text>
              </div>
            ),
          },
          {
            title: t('promoCodes.columns.conditions'),
            key: 'conditions',
            render: (_, promo) =>
              promo.minSubtotal || promo.perPhoneLimit ? (
                <Space direction="vertical" size={0}>
                  {promo.minSubtotal ? <span>{t('promoCodes.minSubtotal', { amount: money(promo.minSubtotal) })}</span> : null}
                  {promo.perPhoneLimit ? <span>{t('promoCodes.perPhone', { count: promo.perPhoneLimit })}</span> : null}
                </Space>
              ) : (
                <Typography.Text type="secondary">{t('promoCodes.noConditions')}</Typography.Text>
              ),
          },
          {
            title: t('promoCodes.columns.validity'),
            key: 'validity',
            render: (_, promo) => {
              const state = validityState(promo, now);
              return (
                <Space direction="vertical" size={0}>
                  {promo.validFrom ? <span>{t('promoCodes.validity.from', { date: formatDateTime(promo.validFrom) })}</span> : null}
                  {promo.validTo ? <span>{t('promoCodes.validity.to', { date: formatDateTime(promo.validTo) })}</span> : null}
                  {!promo.validFrom && !promo.validTo ? <Typography.Text type="secondary">{t('promoCodes.validity.always')}</Typography.Text> : null}
                  {state ? <Tag color={state === 'expired' ? 'default' : 'blue'}>{t(`promoCodes.validity.${state}`)}</Tag> : null}
                </Space>
              );
            },
          },
          {
            title: t('promoCodes.columns.usage'),
            key: 'usage',
            render: (_, promo) => (
              <Space direction="vertical" size={0}>
                <Typography.Text strong>
                  {promo.totalLimit
                    ? t('promoCodes.usage.limit', { used: promo.usage.used, limit: promo.totalLimit })
                    : t('promoCodes.usage.used', { used: promo.usage.used })}
                </Typography.Text>
                {promo.usage.reserved > 0 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('promoCodes.usage.reserved', { count: promo.usage.reserved })}
                  </Typography.Text>
                ) : null}
                {promo.usage.released > 0 ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('promoCodes.usage.released', { count: promo.usage.released })}
                  </Typography.Text>
                ) : null}
              </Space>
            ),
          },
          {
            title: t('promoCodes.columns.branch'),
            key: 'branch',
            render: (_, promo) => (promo.branchId ? branchName(promo.branchId) : <Tag color="gold">{t('promoCodes.network')}</Tag>),
          },
          {
            title: t('promoCodes.columns.status'),
            key: 'status',
            render: (_, promo) => <Tag color={promo.isActive ? 'success' : 'default'}>{promo.isActive ? t('promoCodes.active') : t('promoCodes.inactive')}</Tag>,
          },
          {
            title: t('common.actions'),
            key: 'actions',
            render: (_, promo) =>
              promo.editable ? (
                <Space size={4} wrap>
                  <Tooltip title={t('common.edit')}>
                    <Button size="small" icon={<EditOutlined />} aria-label={t('common.edit')} onClick={() => setEditing(promo)} />
                  </Tooltip>
                  <ConfirmAction
                    title={promo.isActive ? t('promoCodes.deactivate') : t('promoCodes.activate')}
                    description={promo.code}
                    buttonProps={{ size: 'small' }}
                    successMessage={promo.isActive ? t('promoCodes.deactivated') : t('promoCodes.activated')}
                    onConfirm={async () => {
                      await promoApi.update(promo.id, promoToInput(promo, { isActive: !promo.isActive }));
                      await refresh();
                    }}
                  >
                    {promo.isActive ? t('promoCodes.deactivate') : t('promoCodes.activate')}
                  </ConfirmAction>
                  <ConfirmAction
                    danger
                    title={t('promoCodes.deleteConfirm', { code: promo.code })}
                    description={t('promoCodes.deleteHint')}
                    buttonProps={{ size: 'small' }}
                    successMessage={t('promoCodes.deleted')}
                    onConfirm={async () => {
                      await promoApi.remove(promo.id);
                      await refresh();
                    }}
                  >
                    {t('promoCodes.delete')}
                  </ConfirmAction>
                </Space>
              ) : (
                <Tooltip title={t('promoCodes.readOnly')}>
                  <Tag>{t('promoCodes.network')}</Tag>
                </Tooltip>
              ),
          },
        ]}
      />
      <PromoCodeModal
        key={editing?.id ?? (creating ? 'new' : 'closed')}
        open={creating || editing !== null}
        promo={editing}
        defaultBranchId={scopeFilter === 'network' ? null : (branchFilter ?? selectedBranchId)}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          void refresh();
          void message.success(t('promoCodes.saved'));
        }}
      />
    </>
  );
}
