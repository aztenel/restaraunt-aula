import { ReloadOutlined, SearchOutlined, StopOutlined, UndoOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Badge, Button, Card, Col, Empty, Flex, Grid, Input, Row, Segmented, Select, Space, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { translate, type BranchMenuItem } from '@aula/api-client';
import { branchMenuApi, catalogApi, type BranchMenuRow } from '@/shared/api/catalog';
import { queryKeys } from '@/shared/api/query-keys';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { useBranch } from '@/shared/branch/BranchProvider';
import { formatDateTime, toDisplay } from '@/shared/lib/dates';
import { CatalogThumb } from '@/shared/ui/CatalogThumb';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MoneyText } from '@/shared/ui/MoneyText';
import { useAdminFeed } from '@/shared/feed/FeedProvider';
import { PageHeader } from '@/shared/ui/PageHeader';
import { BranchRequired } from '../menu/BranchRequired';
import { bySortOrder } from '../menu/reorder';
import { useBranchMenuAbilities } from '../menu/useAbilities';
import { useUntilLabel } from './AvailabilityTag';
import { STOP_LIST_POLL_MS, stopListPollInterval } from './poll';
import { StopDialog, type StopDialogResult } from './StopDialog';


/**
 * Стоп-лист филиала для планшета на точке (menu.stoplist в филиале): поиск, крупные кнопки
 * «В стоп» / «Вернуть», срок стопа (до конца дня, на 1–2 часа, до ручного возврата, своё время), причина,
 * список того, что сейчас в стопе, с источником (вручную / POS) и сроком.
 */
export function StopListPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('nav.stopList')} subtitle={t('sections.stopList')} />
      <BranchRequired>{(branchId) => <StopListBoard key={branchId} branchId={branchId} />}</BranchRequired>
    </>
  );
}

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function matches(item: BranchMenuItem, needle: string): boolean {
  if (!needle) return true;
  return (
    Object.values(item.dishName).some((name) => name?.toLowerCase().includes(needle)) ||
    item.dishSlug.includes(needle) ||
    (item.effectiveSku?.toLowerCase().includes(needle) ?? false)
  );
}

function StopListBoard({ branchId }: { branchId: string }) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const notifyError = useNotifyError();
  const queryClient = useQueryClient();
  const screens = Grid.useBreakpoint();
  const { branchName, getBranch } = useBranch();
  const { editStopList } = useBranchMenuAbilities(branchId);
  const timeZone = getBranch(branchId)?.timezone;
  const now = useNow(STOP_LIST_POLL_MS);
  const untilLabel = useUntilLabel();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [view, setView] = useState<'stopped' | 'all'>('all');
  const [dialogItem, setDialogItem] = useState<BranchMenuItem | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const { status: feedStatus } = useAdminFeed();
  const pollMs = stopListPollInterval(feedStatus);
  const stopped = useQuery({
    queryKey: queryKeys.stopList(branchId),
    queryFn: () => branchMenuApi.stopList(branchId),
    refetchInterval: pollMs,
  });
  const menu = useQuery({
    queryKey: queryKeys.branchMenuAll(branchId),
    queryFn: () => branchMenuApi.all(branchId),
    refetchInterval: pollMs,
  });
  const categories = useQuery({ queryKey: queryKeys.categories, queryFn: catalogApi.categories, staleTime: 5 * 60_000 });

  const needle = search.trim().toLowerCase();
  const allItems = useMemo(
    () => (menu.data ?? []).filter((item) => (!categoryId || item.categoryId === categoryId) && matches(item, needle)),
    [menu.data, categoryId, needle],
  );
  const stoppedItems = useMemo(() => (stopped.data ?? []).filter((item) => matches(item, needle)), [stopped.data, needle]);
  const updatedAt = Math.max(stopped.dataUpdatedAt, menu.dataUpdatedAt);
  const twoColumns = Boolean(screens.lg);

  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.branchMenu(branchId) });

  /** Ответ сервера (позиция после изменения) сразу в список — без ожидания опроса. */
  const applyItem = (item: BranchMenuItem) => {
    queryClient.setQueryData<BranchMenuItem[]>(queryKeys.branchMenuAll(branchId), (list) => list?.map((i) => (i.dishId === item.dishId ? item : i)));
    queryClient.setQueryData<BranchMenuItem[]>(queryKeys.stopList(branchId), (list) => {
      if (!list) return list;
      const rest = list.filter((i) => i.dishId !== item.dishId);
      return item.availability === 'stopped' ? [item, ...rest] : rest;
    });
  };

  const setAvailability = async (item: BranchMenuItem, input: { available: boolean } & Partial<StopDialogResult>) => {
    setPending(item.dishId);
    try {
      const result = await branchMenuApi.setAvailability(branchId, item.dishId, input);
      applyItem(result.item);
      setDialogItem(null);
      const name = translate(item.dishName, i18n.language);
      if (!result.changed) void message.info(t('stopList.noChange'));
      else void message.success(input.available ? t('stopList.restored', { name }) : t('stopList.stoppedMessage', { name }));
      void refresh();
      void queryClient.invalidateQueries({ queryKey: queryKeys.dish(item.dishId) });
    } catch (error) {
      notifyError(error);
    } finally {
      setPending(null);
    }
  };

  const row = (item: BranchMenuRow) => {
    const isStopped = item.availability === 'stopped';
    return (
      <div key={item.dishId} className="aula-stop-row" style={isStopped ? { background: '#fff7f5' } : undefined}>
        <CatalogThumb image={item.photo} size={52} />
        <div className="aula-stop-main">
          <Typography.Text strong style={{ fontSize: 16 }}>
            {translate(item.dishName, i18n.language)}
          </Typography.Text>
          {!item.dishIsActive ? <Tag style={{ marginInlineStart: 6 }}>{t('catalog.branchMenu.dishInactive')}</Tag> : null}
          <div>
            {isStopped ? (
              <Space size={[6, 2]} wrap>
                <Tag color="error">{untilLabel(item.stoppedUntil, timeZone, now)}</Tag>
                <Tag color={item.stopSource === 'pos' ? 'purple' : 'default'}>{t(`stopList.source.${item.stopSource ?? 'manual'}`)}</Tag>
                {item.stopReason ? <Typography.Text type="secondary">{item.stopReason}</Typography.Text> : null}
                {item.stoppedAt ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('stopList.since', { time: toDisplay(item.stoppedAt)?.format('DD.MM HH:mm') ?? '' })}
                    {item.stopSource !== 'pos' && item.updatedByName ? ` · ${item.updatedByName}` : ''}
                  </Typography.Text>
                ) : null}
              </Space>
            ) : (
              <Typography.Text type="secondary">
                <MoneyText value={item.price} type="secondary" />
              </Typography.Text>
            )}
          </div>
        </div>
        {editStopList ? (
          isStopped ? (
            <Space wrap style={{ justifyContent: 'flex-end' }}>
              <Button size="large" onClick={() => setDialogItem(item)} disabled={pending === item.dishId}>
                {t('stopList.changeUntil')}
              </Button>
              <Button
                size="large"
                type="primary"
                icon={<UndoOutlined />}
                loading={pending === item.dishId}
                onClick={() => void setAvailability(item, { available: true })}
              >
                {t('stopList.restore')}
              </Button>
            </Space>
          ) : (
            <Button size="large" danger icon={<StopOutlined />} loading={pending === item.dishId} onClick={() => setDialogItem(item)}>
              {t('stopList.stop')}
            </Button>
          )
        ) : null}
      </div>
    );
  };

  const stoppedCard = (
    <Card
      title={
        <Space>
          {t('stopList.nowStopped')}
          <Badge count={stopped.data?.length ?? 0} showZero color={stopped.data?.length ? '#cf1322' : '#bfbfbf'} />
        </Space>
      }
      styles={{ body: { padding: 0 } }}
      style={{ marginBottom: 16 }}
    >
      {stopped.error ? <ErrorAlert error={stopped.error} onRetry={() => void stopped.refetch()} /> : null}
      {stoppedItems.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={stopped.isLoading ? t('stopList.loading') : t('stopList.emptyStopped')} style={{ padding: 24 }} />
      ) : (
        stoppedItems.map(row)
      )}
    </Card>
  );

  const allCard = (
    <Card title={t('stopList.allDishes', { count: allItems.length })} styles={{ body: { padding: 0 } }} style={{ marginBottom: 16 }}>
      {menu.error ? <ErrorAlert error={menu.error} onRetry={() => void menu.refetch()} /> : null}
      {allItems.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={menu.isLoading ? t('stopList.loading') : t('stopList.emptySearch')} style={{ padding: 24 }} />
      ) : (
        allItems.map(row)
      )}
    </Card>
  );

  return (
    <>
      <Flex gap={8} wrap align="center" style={{ marginBottom: 16 }}>
        <Input
          size="large"
          allowClear
          prefix={<SearchOutlined />}
          placeholder={t('stopList.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: '1 1 280px', maxWidth: 520 }}
        />
        <Select
          size="large"
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder={t('catalog.fields.category')}
          value={categoryId}
          onChange={(value?: string) => setCategoryId(value)}
          style={{ flex: '0 1 240px', minWidth: 180 }}
          options={bySortOrder(categories.data ?? []).map((c) => ({ value: c.id, label: translate(c.name, i18n.language) }))}
        />
        <Button size="large" icon={<ReloadOutlined />} loading={stopped.isFetching || menu.isFetching} onClick={() => void refresh()}>
          {t('common.refresh')}
        </Button>
        <Typography.Text type="secondary">
          {branchName(branchId)} · {t('stopList.updatedAt', { time: updatedAt ? formatDateTime(new Date(updatedAt)) : '—' })}
        </Typography.Text>
      </Flex>
      {!editStopList ? <Typography.Paragraph type="secondary">{t('stopList.readOnly')}</Typography.Paragraph> : null}
      {twoColumns ? (
        <Row gutter={16}>
          <Col lg={10}>{stoppedCard}</Col>
          <Col lg={14}>{allCard}</Col>
        </Row>
      ) : (
        <>
          <Segmented
            block
            size="large"
            value={view}
            onChange={(value) => setView(value as 'stopped' | 'all')}
            options={[
              { value: 'stopped', label: `${t('stopList.nowStopped')} (${stopped.data?.length ?? 0})` },
              { value: 'all', label: t('stopList.allDishesShort') },
            ]}
            style={{ marginBottom: 12 }}
          />
          {view === 'stopped' ? stoppedCard : allCard}
        </>
      )}
      <StopDialog
        item={dialogItem}
        loading={dialogItem !== null && pending === dialogItem.dishId}
        onCancel={() => setDialogItem(null)}
        onSubmit={(result) => dialogItem && void setAvailability(dialogItem, { available: false, ...result })}
      />
    </>
  );
}
